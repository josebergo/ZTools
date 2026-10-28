import { app, dialog, shell } from 'electron'
import type { ElectronUpdaterService } from '../electronUpdater'
import {
  getWindowsReleaseUrl,
  getWindowsInstallCompatibility,
  WINDOWS_RELEASE_URL,
  type WindowsInstallCompatibility
} from '../windowsInstallCompatibility'
import type {
  CreatePlatformUpdater,
  PlatformDownloadStatus,
  PlatformUpdateActionResult,
  PlatformUpdateInfo,
  PlatformUpdateResult,
  PlatformUpdaterCallbacks,
  PlatformUpdaterService
} from './types'

class WindowsPlatformUpdater implements PlatformUpdaterService {
  private updater: ElectronUpdaterService | null = null
  private compatibility: WindowsInstallCompatibility | null = null
  private migrationPromptShown = false

  /**
   * 创建 Windows 平台更新适配器。
   * @param callbacks 更新生命周期回调。
   * @returns 创建的 Windows 更新适配器实例。
   */
  constructor(private readonly callbacks: PlatformUpdaterCallbacks) {}

  /**
   * 校验 Windows 完整安装状态，并为兼容安装初始化共享标准更新器。
   * @returns 初始化完成后结束的 Promise。
   */
  public async initialize(): Promise<void> {
    // 先完成 NSIS 安装兼容校验，避免 portable 或 legacy 安装进入标准更新流程。
    this.compatibility = await getWindowsInstallCompatibility()
    if (this.compatibility.migrationRequired) {
      await this.showMigrationPrompt()
      return
    }
    if (!this.compatibility.compatible && !this.compatibility.portable) return

    // 安装版使用完整能力，便携版仅复用 electron-updater 的版本检查能力。
    const { ElectronUpdaterService } = await import('../electronUpdater')
    this.updater = new ElectronUpdaterService(this.callbacks)
  }

  /**
   * 向 legacy Windows 安装展示一次完整安装迁移提示。
   * @returns 提示处理完成后结束的 Promise。
   */
  private async showMigrationPrompt(): Promise<void> {
    if (this.migrationPromptShown) return
    this.migrationPromptShown = true

    const result = await dialog.showMessageBox({
      type: 'info',
      title: '需要更新 MaheTools',
      message: '请安装一次最新完整版本',
      detail:
        '当前版本使用的是较早的更新方式，无法直接完成本次升级。安装最新完整版本后，即可继续正常接收更新，您的数据、设置和插件都会保留。',
      buttons: ['下载最新版本', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })

    if (result.response === 0) await shell.openExternal(WINDOWS_RELEASE_URL)
  }

  /**
   * 检查 Windows 更新，并为便携版标记手动下载行为。
   * @param downloadWhenAvailable 安装版发现更新后是否立即下载；便携版始终忽略该参数。
   * @returns 更新检查或迁移结果。
   */
  public async checkForUpdates(downloadWhenAvailable: boolean): Promise<PlatformUpdateResult> {
    if (this.updater) {
      const result = await this.updater.checkForUpdates(
        this.compatibility?.portable ? false : downloadWhenAvailable
      )

      // 便携版只展示可用版本和发布说明，下载与替换由用户在 Release 页面完成。
      if (this.compatibility?.portable && result.updateInfo) {
        return {
          ...result,
          updateInfo: {
            ...result.updateInfo,
            manualDownloadRequired: true,
            releaseUrl: getWindowsReleaseUrl(result.updateInfo.version)
          }
        }
      }
      return result
    }

    if (this.compatibility?.migrationRequired) {
      return {
        success: true,
        status: 'migration-required',
        hasUpdate: false,
        currentVersion: app.getVersion(),
        migrationRequired: true,
        migrationReasons: this.compatibility.reasons,
        releaseUrl: WINDOWS_RELEASE_URL
      }
    }

    return { success: true, status: 'not-available', hasUpdate: false }
  }

  /**
   * 启动 Windows 更新，便携版改为打开手动下载页面。
   * @param updateInfo 当前可用更新信息。
   * @returns 更新启动或下载页面打开结果。
   */
  public async startUpdate(updateInfo?: PlatformUpdateInfo): Promise<PlatformUpdateActionResult> {
    if (this.compatibility?.portable) {
      await shell.openExternal(updateInfo?.releaseUrl || WINDOWS_RELEASE_URL)
      return { success: true }
    }
    if (this.updater) return this.updater.downloadAndInstall(updateInfo)

    await shell.openExternal(updateInfo?.releaseUrl || WINDOWS_RELEASE_URL)
    return { success: true, migrationRequired: true }
  }

  /**
   * 取消当前 Windows 应用内更新下载。
   * @returns 下载请求完全结束后的取消结果。
   */
  public async cancelUpdate(): Promise<PlatformUpdateActionResult> {
    if (this.updater) return this.updater.cancelUpdate()
    return { success: false, error: '当前没有正在下载的更新' }
  }

  /**
   * 安装已经下载完成的 Windows 更新。
   * @returns 安装启动结果；便携版始终返回不支持安装。
   */
  public installDownloadedUpdate(): PlatformUpdateActionResult {
    if (this.compatibility?.portable) {
      return { success: false, error: 'Windows 便携版不支持应用内安装更新' }
    }
    if (this.updater) return this.updater.installDownloadedUpdate()
    return { success: false, error: '当前安装需要完整版本迁移' }
  }

  /**
   * 获取 Windows 更新下载状态。
   * @returns 当前下载状态。
   */
  public getDownloadStatus(): PlatformDownloadStatus {
    if (this.updater) return this.updater.getDownloadStatus()
    return {
      hasDownloaded: false,
      status: this.compatibility?.migrationRequired ? 'migration-required' : 'idle'
    }
  }

  /**
   * 清理 Windows 更新适配器持有的资源。
   * @returns 无返回值。
   */
  public cleanup(): void {
    return
  }
}

const createWindowsUpdater: CreatePlatformUpdater = (callbacks) =>
  new WindowsPlatformUpdater(callbacks)

export default createWindowsUpdater
