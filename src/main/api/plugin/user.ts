import { app } from 'electron'
import type { PluginManager } from '../../managers/pluginManager'
import pluginDeviceAPI from './device'
import {
  loadOfficialAccountSession,
  refreshOfficialAccountTokens
} from '../../core/account/officialAccountService'
import { getCurrentUserInfo } from '../../core/account/userProfileStore'
import { OFFICIAL_SERVER_HTTP_URL } from '../../../shared/syncServerUrl'
import { httpRequest, type HttpResponse } from '../../utils/httpRequest.js'
import { registerPluginApiServices } from './pluginApiDispatcher'

const PLUGIN_TOKEN_REFRESH_WINDOW_MS = 30_000
const PLUGIN_TOKEN_ENDPOINT = `${OFFICIAL_SERVER_HTTP_URL}/api/auth/plugin-token`

export interface PluginTemporaryToken {
  token: string
  expiredAt: number
}

/**
 * 插件用户 API，向插件提供公开资料和受控的服务端临时鉴权。
 */
export class PluginUserAPI {
  private pluginManager: PluginManager | null = null
  private tokenCache = new Map<string, PluginTemporaryToken>()
  private pendingRequests = new Map<string, Promise<PluginTemporaryToken>>()

  /**
   * 注册用户资料与临时令牌 API。
   * @param pluginManager 插件运行时管理器，用于确认 IPC 调用者身份。
   * @returns 无返回值。
   */
  public init(pluginManager: PluginManager): void {
    this.pluginManager = pluginManager
    registerPluginApiServices({
      getUser: this.handleGetUser,
      getUserTempToken: this.handleGetUserTempToken.bind(this)
    })
  }

  /**
   * 将当前用户公开资料写入同步 IPC 返回值。
   * @param event 插件发起的同步 IPC 事件。
   * @returns 无返回值。
   */
  private handleGetUser(event: Electron.IpcMainEvent): void {
    event.returnValue = getCurrentUserInfo()
  }

  /**
   * 为当前插件换取或复用短期服务端令牌。
   * @param event 插件发起的异步 IPC 事件。
   * @returns 仅包含临时令牌及其过期时间的 Promise。
   * @throws 未登录、调用者不是插件或服务端换取失败时抛出错误。
   */
  public async handleGetUserTempToken(
    event: Electron.IpcMainInvokeEvent
  ): Promise<PluginTemporaryToken> {
    const pluginId = this.pluginManager?.getPluginManifestNameByWebContents(event.sender)
    if (!pluginId) throw new Error('无法确认当前插件身份')

    // 每次先读取官方账号会话，退出登录后不得继续返回缓存令牌。
    const session = await loadOfficialAccountSession()
    if (!session?.token || !session.username) throw new Error('请先登录 MaheTools 账号')
    const cacheKey = `${session.username}\n${pluginId}`
    const cached = this.tokenCache.get(cacheKey)
    if (cached && cached.expiredAt - PLUGIN_TOKEN_REFRESH_WINDOW_MS > Date.now()) {
      return { token: cached.token, expiredAt: cached.expiredAt }
    }

    // 合并同一用户和插件的并发请求，避免同时触发多次账户 token 刷新。
    const pending = this.pendingRequests.get(cacheKey)
    const request = pending || this.fetchAndCacheTempToken(cacheKey, pluginId, session.token)
    if (!pending) this.pendingRequests.set(cacheKey, request)
    try {
      const token = await request
      // 换取令牌期间退出、换号或插件被卸载时，不把旧身份令牌交给新的页面。
      const current = await loadOfficialAccountSession()
      if (
        !current?.token ||
        current.username !== session.username ||
        this.pluginManager?.getPluginManifestNameByWebContents(event.sender) !== pluginId
      ) {
        this.tokenCache.delete(cacheKey)
        throw new Error('账号或插件状态已变化，请重试')
      }
      return token
    } finally {
      if (this.pendingRequests.get(cacheKey) === request) this.pendingRequests.delete(cacheKey)
    }
  }

  /**
   * 调用服务端换取临时令牌，并在账户令牌失效时刷新后重试一次。
   * @param cacheKey 用户与插件组成的缓存键。
   * @param pluginId 插件清单中的规范名称。
   * @param accessToken 当前官方账号访问令牌。
   * @returns 已校验并写入缓存的临时令牌。
   * @throws 账户失效或服务端响应不完整时抛出错误。
   */
  private async fetchAndCacheTempToken(
    cacheKey: string,
    pluginId: string,
    accessToken: string
  ): Promise<PluginTemporaryToken> {
    let response = await this.requestTempToken(pluginId, accessToken)
    if (response.status === 401) {
      // 账户令牌过期时复用统一刷新协调器，成功后只重试一次。
      const refreshResult = await refreshOfficialAccountTokens()
      if (
        (refreshResult.status === 'refreshed' || refreshResult.status === 'reused') &&
        refreshResult.session.token &&
        cacheKey === `${refreshResult.session.username}\n${pluginId}`
      ) {
        response = await this.requestTempToken(pluginId, refreshResult.session.token)
      }
    }
    if (response.status === 401) throw new Error('ZTools 账号登录已失效，请重新登录')
    if (response.status < 200 || response.status >= 300) {
      throw new Error(this.readServerError(response) || `临时鉴权请求失败（${response.status}）`)
    }

    const data =
      typeof response.data === 'string' ? this.safeParseJSON(response.data) : response.data
    if (
      !data ||
      typeof data.token !== 'string' ||
      !data.token ||
      typeof data.expiredAt !== 'number' ||
      data.expiredAt <= Date.now()
    ) {
      throw new Error('临时鉴权响应不完整')
    }
    const token = { token: data.token, expiredAt: data.expiredAt }
    this.tokenCache.set(cacheKey, token)
    return token
  }

  /**
   * 使用官方账号访问令牌请求插件临时鉴权。
   * @param pluginId 插件清单中的规范名称。
   * @param accessToken 官方账号访问令牌。
   * @returns 不自动拒绝 HTTP 状态码的服务端响应。
   */
  private requestTempToken(pluginId: string, accessToken: string): Promise<HttpResponse> {
    return httpRequest(PLUGIN_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pluginId,
        deviceId: pluginDeviceAPI.getDeviceIdPublic(),
        appVersion: app.getVersion()
      }),
      validateStatus: () => true
    })
  }

  /**
   * 从失败响应中提取可展示的服务端错误。
   * @param response 服务端 HTTP 响应。
   * @returns 服务端错误文本，不存在时返回空字符串。
   */
  private readServerError(response: HttpResponse): string {
    const data =
      typeof response.data === 'string' ? this.safeParseJSON(response.data) : response.data
    return typeof data?.error === 'string' ? data.error : ''
  }

  /**
   * 尝试解析 JSON 字符串。
   * @param value 待解析的字符串。
   * @returns 解析结果；格式无效时返回空对象。
   */
  private safeParseJSON(value: string): any {
    try {
      return JSON.parse(value)
    } catch {
      return {}
    }
  }
}

export default new PluginUserAPI()
