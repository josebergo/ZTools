<script setup lang="ts">
import { onActivated, onMounted, onUnmounted, ref, computed } from 'vue'
import { useToast, DetailPanel } from '@/components'
import { ONLINE_SYNC_SERVER_URL } from '@/composables/useZToolsAccount'
import { normalizeSyncServerUrl } from '@shared/syncServerUrl'

const { success, error, warning, confirm } = useToast()
type DeploymentMode = 'official' | 'private'

// 同步配置
const syncEnabled = ref(false)
const config = ref({
  provider: 'official' as DeploymentMode,
  serverUrl: ONLINE_SYNC_SERVER_URL,
  syncInterval: 30,
  lastSyncTime: 0
})
const deploymentMode = ref<DeploymentMode>('official')
const deploymentSwitching = ref(false)
const privateFormDirty = ref(false)
const privateServerUrl = ref('')
const privateUsername = ref('')
const privatePassword = ref('')
const privateLoginLoading = ref(false)
const privateLogoutLoading = ref(false)
const privateConnectionTesting = ref(false)
const privateConnectionMessage = ref('')
const privateConnectionSucceeded = ref(false)
const officialAccountLoggedIn = ref(false)
const officialAccountUsername = ref('')
const privateSessionLoggedIn = ref(false)
const savedPrivateServerUrl = ref('')
const savedPrivateUsername = ref('')

// 是否已登录（有 token）
const loggedIn = ref(false)
const loggedUser = ref('')

// 状态
const syncState = ref<string>('disconnected')
const unsyncedCount = ref(0)
const conflictCount = ref(0)
const retryStatus = ref<{
  pendingPushBatches: number
  pendingUploads: number
  pendingDownloads: number
  failedPermanent: number
  authRequired: number
  lastError?: string
  nextRetryAt?: number
} | null>(null)
const currentLevel = ref<'main' | 'conflictList' | 'conflictDetail'>('main')
const conflictItems = ref<
  Array<{
    docId: string
    winningRev?: string
    conflictCount: number
    deleted: boolean
    lastModified?: number
  }>
>([])
const selectedConflictDocId = ref('')
const conflictDetail = ref<{
  docId: string
  winningRev?: string
  deleted: boolean
  winner: any
  conflicts: any[]
} | null>(null)
let conflictDiffCache = new WeakMap<object, ConflictDiffView>()

// 状态映射
const stateLabels: Record<string, string> = {
  disconnected: '未连接',
  connecting: '连接中...',
  authenticating: '认证中...',
  pulling: '拉取数据...',
  pushing: '推送数据...',
  live: '实时同步中',
  error: '连接异常'
}

const stateColors: Record<string, string> = {
  disconnected: 'var(--text-secondary)',
  connecting: 'var(--warning-color, #f0a020)',
  authenticating: 'var(--warning-color, #f0a020)',
  pulling: 'var(--primary-color)',
  pushing: 'var(--primary-color)',
  live: 'var(--success-color, #18a058)',
  error: 'var(--danger-color, #d03050)'
}

const stateLabel = computed(() => stateLabels[syncState.value] || syncState.value)
const stateColor = computed(() => stateColors[syncState.value] || 'var(--text-secondary)')
const isConnected = computed(() => syncState.value === 'live')
const isPrivateMode = computed(() => deploymentMode.value === 'private')
const retryPendingTotal = computed(() => {
  const status = retryStatus.value
  if (!status) return 0
  return status.pendingPushBatches + status.pendingUploads + status.pendingDownloads
})
const retryNextTime = computed(() => {
  const next = retryStatus.value?.nextRetryAt
  if (!next) return ''
  const diff = Math.max(0, next - Date.now())
  if (diff < 1000) return '即将重试'
  return `${Math.ceil(diff / 1000)} 秒后重试`
})

const lastSyncTime = computed(() => {
  if (!config.value.lastSyncTime) return '从未同步'
  const diff = Date.now() - config.value.lastSyncTime
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
})

/**
 * 将主进程持久化的同步状态映射到当前服务模式，并避免轮询覆盖用户正在填写的私服表单。
 * @param status 主进程返回的同步状态快照。
 * @returns 无返回值。
 */
function applySyncStatus(status: any): void {
  const nextConfig = status?.profile || status?.config || null
  const nextMode: DeploymentMode = nextConfig?.provider === 'private' ? 'private' : 'official'

  if (nextConfig) {
    deploymentMode.value = nextMode
  }
  const configMatchesSelection = Boolean(nextConfig && deploymentMode.value === nextMode)

  syncEnabled.value = Boolean(configMatchesSelection && nextConfig?.enabled)
  config.value.provider = nextMode
  config.value.serverUrl =
    nextMode === 'official' ? ONLINE_SYNC_SERVER_URL : nextConfig?.serverUrl || ''
  config.value.syncInterval = nextConfig?.syncInterval || 30
  config.value.lastSyncTime = status?.lastSyncTime || nextConfig?.lastSyncTime || 0
  syncState.value = status?.state || 'disconnected'
  unsyncedCount.value = status?.unsyncedCount || 0
  conflictCount.value = status?.conflictCount || 0
  retryStatus.value = status?.retryStatus || null

  officialAccountLoggedIn.value = Boolean(status?.officialAccount?.loggedIn)
  officialAccountUsername.value = status?.officialAccount?.username || ''
  privateSessionLoggedIn.value = Boolean(status?.privateSession?.loggedIn)
  savedPrivateServerUrl.value = status?.privateSession?.serverUrl || ''
  savedPrivateUsername.value = status?.privateSession?.username || ''

  if (!privateFormDirty.value) {
    privateServerUrl.value = savedPrivateServerUrl.value
    privateUsername.value = savedPrivateUsername.value
  }
  updateSelectedLoginState()
}

/**
 * 根据当前选择的服务类型展示对应且彼此独立的登录状态。
 * @returns 无返回值。
 */
function updateSelectedLoginState(): void {
  if (deploymentMode.value === 'official') {
    loggedIn.value = officialAccountLoggedIn.value
    loggedUser.value = officialAccountUsername.value
    return
  }
  loggedIn.value = privateSessionLoggedIn.value
  loggedUser.value = savedPrivateUsername.value
}

/**
 * 标记私服表单已被用户编辑，防止后台状态轮询覆盖输入。
 * @returns 无返回值。
 */
function markPrivateFormDirty(): void {
  privateFormDirty.value = true
  privateConnectionMessage.value = ''
  privateConnectionSucceeded.value = false
}

/**
 * 提示用户确认并持久化目标同步服务，成功后再切换页面状态。
 * @param mode 用户选择的同步服务类型。
 * @returns 服务模式切换完成后的 Promise。
 */
async function handleDeploymentModeChange(mode: DeploymentMode): Promise<void> {
  if (mode === deploymentMode.value || privateLoginLoading.value || deploymentSwitching.value) {
    return
  }

  deploymentSwitching.value = true
  try {
    const targetLabel = mode === 'private' ? '私有部署' : '官方服务'
    const confirmed = await confirm({
      title: '切换同步服务',
      message: syncEnabled.value
        ? `切换到${targetLabel}后，当前同步连接将停止。官方账号与私有服务账号相互独立，请确认目标服务已登录后重新开启同步。`
        : `确定切换到${targetLabel}吗？官方账号与私有服务账号相互独立，切换后请确认目标服务的登录状态。`,
      type: 'warning',
      confirmText: `切换到${targetLabel}`,
      cancelText: '取消'
    })
    if (!confirmed) return

    // 将服务选择和关闭状态一次性保存；主进程会在保存成功后停止旧同步客户端。
    const targetServerUrl =
      mode === 'official' ? ONLINE_SYNC_SERVER_URL : savedPrivateServerUrl.value
    const result = await window.ztools.internal.syncSaveConfig({
      provider: mode,
      enabled: false,
      serverUrl: targetServerUrl,
      syncInterval: config.value.syncInterval
    })
    if (!result.success) throw new Error(result.error || '保存同步服务失败')

    // 持久化成功后再更新界面，失败时保持原服务和开关状态。
    deploymentMode.value = mode
    syncEnabled.value = false
    config.value.provider = mode
    config.value.serverUrl = targetServerUrl
    syncState.value = 'disconnected'
    privateConnectionMessage.value = ''
    privateConnectionSucceeded.value = false
    privatePassword.value = ''

    if (mode === 'private' && !savedPrivateServerUrl.value) {
      privateServerUrl.value = ''
      privateUsername.value = ''
      privateFormDirty.value = false
    }
    updateSelectedLoginState()
    success(`已切换到${targetLabel}，同步保持关闭`)
  } catch (err: any) {
    error(`切换同步服务失败：${err.message}`)
  } finally {
    deploymentSwitching.value = false
  }
}

/**
 * 校验私服表单并返回规范化后的连接参数。
 * @returns 规范化的服务器地址和已去除首尾空格的用户名。
 * @throws 当服务器地址、用户名或密码缺失或不合法时抛出错误。
 */
function validatePrivateLoginForm(): { serverUrl: string; username: string } {
  const serverUrl = normalizeSyncServerUrl(privateServerUrl.value)
  const username = privateUsername.value.trim()
  if (!username) throw new Error('请填写用户名')
  if (!privatePassword.value) throw new Error('请填写密码')
  return { serverUrl, username }
}

/**
 * 测试当前私服地址是否能建立 WebSocket 连接。
 * @returns 连接测试完成后的 Promise。
 */
async function handlePrivateConnectionTest(): Promise<void> {
  privateConnectionTesting.value = true
  privateConnectionMessage.value = ''
  privateConnectionSucceeded.value = false
  try {
    const serverUrl = normalizeSyncServerUrl(privateServerUrl.value)
    const result = await window.ztools.internal.syncTestConnection({ serverUrl })
    if (!result.success) throw new Error(result.error || '无法连接服务器')
    privateServerUrl.value = serverUrl
    privateConnectionSucceeded.value = true
    privateConnectionMessage.value = '连接正常'
  } catch (err: any) {
    privateConnectionMessage.value = err.message
  } finally {
    privateConnectionTesting.value = false
  }
}

/**
 * 使用账号密码登录私有同步服务器，并保存不包含明文密码的同步配置。
 * @returns 私服登录和配置切换完成后的 Promise。
 */
async function handlePrivateLogin(): Promise<void> {
  privateLoginLoading.value = true
  privateConnectionMessage.value = ''
  try {
    const { serverUrl, username } = validatePrivateLoginForm()

    // 登录前先验证 WebSocket 入口，给地址或反向代理配置错误更明确的反馈。
    const connection = await window.ztools.internal.syncTestConnection({ serverUrl })
    if (!connection.success) throw new Error(connection.error || '无法连接服务器')

    const login = await window.ztools.internal.syncLoginPrivate({
      serverUrl,
      username,
      password: privatePassword.value
    })
    if (!login.success || !login.token) throw new Error(login.error || '登录失败')

    let previousServerUrl = savedPrivateServerUrl.value
    try {
      previousServerUrl = normalizeSyncServerUrl(previousServerUrl)
    } catch {
      // 历史配置无法规范化时按服务已切换处理，确保不会复用旧同步状态。
    }
    const serverChanged = previousServerUrl !== serverUrl
    const saved = await window.ztools.internal.syncSaveConfig({
      provider: 'private',
      enabled: false,
      serverUrl,
      syncInterval: config.value.syncInterval
    })
    if (!saved.success) throw new Error(saved.error || '保存登录状态失败')

    // 服务地址变化时自动重置本机进度，让文档和附件完整进入新服务的同步队列。
    if (serverChanged) {
      const reset = await window.ztools.internal.syncResetLocalSyncState()
      if (!reset.success) {
        warning(`已登录，但重置本机同步状态失败：${reset.error || '未知错误'}`)
      }
    }

    privateSessionLoggedIn.value = true
    savedPrivateServerUrl.value = serverUrl
    savedPrivateUsername.value = username
    privateServerUrl.value = serverUrl
    privateUsername.value = username
    privatePassword.value = ''
    privateFormDirty.value = false
    privateConnectionSucceeded.value = true
    privateConnectionMessage.value = '已登录'
    updateSelectedLoginState()
    success('私有同步服务器登录成功')
    await refreshSyncStatus()
  } catch (err: any) {
    error(`私有服务器登录失败：${err.message}`)
  } finally {
    // 密码只用于本次认证请求，成功或失败后都不继续保留在页面内存中。
    privatePassword.value = ''
    privateLoginLoading.value = false
  }
}

/**
 * 确认后注销当前私服会话，并保留服务器地址和用户名供再次登录。
 * @returns 私服注销和状态刷新完成后的 Promise。
 */
async function handlePrivateLogout(): Promise<void> {
  const confirmed = await confirm({
    title: '注销私有同步服务器',
    message: '注销会停止当前私服同步并清除登录令牌，但不会删除本地文档和附件。',
    type: 'danger',
    confirmText: '注销登录',
    cancelText: '取消'
  })
  if (!confirmed) return

  privateLogoutLoading.value = true
  try {
    const result = await window.ztools.internal.syncLogoutPrivate()
    if (!result.success) throw new Error(result.error || '注销失败')

    // 立即收敛本地界面状态，避免等待状态通知期间仍显示已连接。
    syncEnabled.value = false
    syncState.value = 'disconnected'
    privateSessionLoggedIn.value = false
    loggedIn.value = false
    privatePassword.value = ''
    privateConnectionMessage.value = ''
    privateConnectionSucceeded.value = false
    privateFormDirty.value = false
    privateServerUrl.value = savedPrivateServerUrl.value
    privateUsername.value = savedPrivateUsername.value

    await refreshSyncStatus()
    success('已注销私有同步服务器')
  } catch (err: any) {
    error(`注销失败：${err.message}`)
  } finally {
    privateLogoutLoading.value = false
  }
}

async function refreshSyncStatus(): Promise<void> {
  try {
    const result = await window.ztools.internal.syncGetStatus()
    if (result.success) {
      applySyncStatus(result.status || {})
      await refreshVisibleConflictPanel()
    }
  } catch (err) {
    console.error('加载同步状态失败:', err)
  }
}

async function refreshVisibleConflictPanel(): Promise<void> {
  if (currentLevel.value === 'conflictList') {
    await loadConflictList()
    return
  }
  if (currentLevel.value === 'conflictDetail' && selectedConflictDocId.value) {
    const result = await window.ztools.internal.syncGetConflictDetail(selectedConflictDocId.value)
    if (result.success) {
      conflictDiffCache = new WeakMap<object, ConflictDiffView>()
      conflictDetail.value = result.detail || null
    }
  }
}

async function loadConflictList(): Promise<void> {
  try {
    const result = await window.ztools.internal.syncListConflicts()
    if (result.success) {
      conflictItems.value = result.items || []
    }
  } catch (err) {
    console.error('加载冲突列表失败:', err)
  }
}

async function openConflictList(): Promise<void> {
  await loadConflictList()
  currentLevel.value = 'conflictList'
}

async function openConflictDetail(docId: string): Promise<void> {
  selectedConflictDocId.value = docId
  try {
    const result = await window.ztools.internal.syncGetConflictDetail(docId)
    if (result.success) {
      conflictDiffCache = new WeakMap<object, ConflictDiffView>()
      conflictDetail.value = result.detail || null
      currentLevel.value = 'conflictDetail'
    }
  } catch (err) {
    console.error('加载冲突详情失败:', err)
  }
}

function closeConflictList(): void {
  currentLevel.value = 'main'
}

function closeConflictDetail(): void {
  currentLevel.value = 'conflictList'
  conflictDetail.value = null
  selectedConflictDocId.value = ''
}

async function handleResolveConflict(
  sourceRev: string,
  mode: 'winner' | 'conflict' = 'conflict'
): Promise<void> {
  if (!selectedConflictDocId.value) return

  const keepWinner = mode === 'winner'
  const confirmed = await confirm({
    title: keepWinner ? '保留当前版本' : '使用冲突版本',
    message: keepWinner
      ? `确定保留当前 winner ${sourceRev} 并解决冲突吗？这会生成一个新的 resolve revision，并清理其他冲突版本。`
      : `确定要将 revision ${sourceRev} 设为当前结果吗？这会生成一个新的 resolve revision 并继续同步到其他设备。`,
    type: 'warning',
    confirmText: keepWinner ? '保留当前版本' : '确认切换',
    cancelText: '取消'
  })
  if (!confirmed) return

  try {
    const result = await window.ztools.internal.syncResolveConflict(
      selectedConflictDocId.value,
      sourceRev
    )
    if (!result.success) {
      error(`解决冲突失败：${result.error || '未知错误'}`)
      return
    }

    success(keepWinner ? '已保留当前版本并解决冲突' : '已生成新的当前版本')
    await refreshSyncStatus()
    await loadConflictList()
    await openConflictDetail(selectedConflictDocId.value)
  } catch (err: any) {
    error(`解决冲突失败：${err.message}`)
  }
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function sortForDisplay(value: any): any {
  if (Array.isArray(value)) {
    return value.map((item) => sortForDisplay(item))
  }

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, any>>((out, key) => {
        out[key] = sortForDisplay(value[key])
        return out
      }, {})
  }

  return value
}

function stringifyForDiff(value: any): string {
  return JSON.stringify(sortForDisplay(value), null, 2)
}

type DiffLineType = 'equal' | 'changed' | 'added' | 'removed' | 'empty'

interface DiffSideLine {
  lineNo: number | null
  text: string
  type: DiffLineType
}

interface DiffRow {
  left: DiffSideLine
  right: DiffSideLine
}

interface ConflictDiffView {
  rows: DiffRow[]
  changed: number
  added: number
  removed: number
}

function createDiffSideLine(lineNo: number | null, text: string, type: DiffLineType): DiffSideLine {
  return { lineNo, text, type }
}

function splitDiffLines(value: any): string[] {
  return stringifyForDiff(value).split('\n')
}

function alignChangedBlocks(leftBlock: string[], rightBlock: string[], rows: DiffRow[]): void {
  const max = Math.max(leftBlock.length, rightBlock.length)
  for (let index = 0; index < max; index += 1) {
    const leftText = leftBlock[index]
    const rightText = rightBlock[index]
    if (leftText !== undefined && rightText !== undefined) {
      rows.push({
        left: createDiffSideLine(null, leftText, 'changed'),
        right: createDiffSideLine(null, rightText, 'changed')
      })
    } else if (leftText !== undefined) {
      rows.push({
        left: createDiffSideLine(null, leftText, 'removed'),
        right: createDiffSideLine(null, '', 'empty')
      })
    } else if (rightText !== undefined) {
      rows.push({
        left: createDiffSideLine(null, '', 'empty'),
        right: createDiffSideLine(null, rightText, 'added')
      })
    }
  }
}

function numberDiffRows(rows: DiffRow[]): DiffRow[] {
  let leftLineNo = 1
  let rightLineNo = 1
  return rows.map((row) => {
    const left = { ...row.left }
    const right = { ...row.right }
    if (left.type !== 'empty') {
      left.lineNo = leftLineNo
      leftLineNo += 1
    }
    if (right.type !== 'empty') {
      right.lineNo = rightLineNo
      rightLineNo += 1
    }
    return { left, right }
  })
}

function buildJsonSideBySideDiff(winner: any, loser: any): ConflictDiffView {
  const leftLines = splitDiffLines(winner)
  const rightLines = splitDiffLines(loser)
  const leftLength = leftLines.length
  const rightLength = rightLines.length
  const lcs: number[][] = Array.from({ length: leftLength + 1 }, () =>
    Array(rightLength + 1).fill(0)
  )

  for (let i = leftLength - 1; i >= 0; i -= 1) {
    for (let j = rightLength - 1; j >= 0; j -= 1) {
      if (leftLines[i] === rightLines[j]) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1])
      }
    }
  }

  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  let leftBlock: string[] = []
  let rightBlock: string[] = []

  const flushBlocks = (): void => {
    if (leftBlock.length === 0 && rightBlock.length === 0) return
    alignChangedBlocks(leftBlock, rightBlock, rows)
    leftBlock = []
    rightBlock = []
  }

  while (i < leftLength || j < rightLength) {
    if (i < leftLength && j < rightLength && leftLines[i] === rightLines[j]) {
      flushBlocks()
      rows.push({
        left: createDiffSideLine(null, leftLines[i], 'equal'),
        right: createDiffSideLine(null, rightLines[j], 'equal')
      })
      i += 1
      j += 1
      continue
    }

    if (j >= rightLength || (i < leftLength && lcs[i + 1][j] >= lcs[i][j + 1])) {
      leftBlock.push(leftLines[i])
      i += 1
    } else {
      rightBlock.push(rightLines[j])
      j += 1
    }
  }
  flushBlocks()

  const numberedRows = numberDiffRows(rows)
  return {
    rows: numberedRows,
    changed: numberedRows.filter(
      (row) => row.left.type === 'changed' || row.right.type === 'changed'
    ).length,
    added: numberedRows.filter((row) => row.right.type === 'added').length,
    removed: numberedRows.filter((row) => row.left.type === 'removed').length
  }
}

function getConflictDiffView(conflict: any): ConflictDiffView {
  if (conflict && typeof conflict === 'object') {
    const cached = conflictDiffCache.get(conflict)
    if (cached) return cached
    const next = buildJsonSideBySideDiff(conflictDetail.value?.winner, conflict)
    conflictDiffCache.set(conflict, next)
    return next
  }
  return buildJsonSideBySideDiff(conflictDetail.value?.winner, conflict)
}

function getConflictDiffSummary(conflict: any): {
  changed: number
  added: number
  removed: number
} {
  const diff = getConflictDiffView(conflict)
  return {
    changed: diff.changed,
    added: diff.added,
    removed: diff.removed
  }
}

function shouldEmphasizeText(left: DiffSideLine, right: DiffSideLine): boolean {
  return (
    left.type === 'changed' && right.type === 'changed' && left.text.trim() !== right.text.trim()
  )
}

function splitComparableLine(line: string): { prefix: string; value: string } {
  const separatorIndex = line.indexOf(':')
  if (separatorIndex === -1) {
    return { prefix: '', value: line }
  }
  return {
    prefix: line.slice(0, separatorIndex + 1),
    value: line.slice(separatorIndex + 1)
  }
}

function getInlineParts(
  line: DiffSideLine,
  peer: DiffSideLine
): { prefix: string; value: string; changed: boolean } {
  if (!shouldEmphasizeText(line, peer)) {
    return { prefix: '', value: line.text, changed: false }
  }
  const current = splitComparableLine(line.text)
  const other = splitComparableLine(peer.text)
  if (current.prefix && current.prefix === other.prefix) {
    return { prefix: current.prefix, value: current.value, changed: true }
  }
  return { prefix: '', value: line.text, changed: true }
}

function lineClass(line: DiffSideLine): string {
  return `diff-line diff-line-${line.type}`
}

function sideLabel(type: DiffLineType): string {
  switch (type) {
    case 'added':
      return '+'
    case 'removed':
      return '-'
    case 'changed':
      return '~'
    default:
      return ''
  }
}

function summaryLabel(conflict: any): string {
  const summary = getConflictDiffSummary(conflict)
  return `修改 ${summary.changed} 行 · 新增 ${summary.added} 行 · 删除 ${summary.removed} 行`
}

/**
 * 保存当前服务的同步启停状态，并在未登录时阻止误开启。
 * @returns 配置保存和状态刷新完成后的 Promise。
 */
async function handleSyncToggle(): Promise<void> {
  try {
    if (!syncEnabled.value) {
      syncState.value = 'disconnected'
      await window.ztools.internal.syncStopAutoSync()
    }

    if (syncEnabled.value && !loggedIn.value) {
      warning(isPrivateMode.value ? '请先登录私有同步服务器' : '请先通过左下角登录 MaheTools 账号')
      syncEnabled.value = false
      return
    }

    if (syncEnabled.value) {
      syncState.value = 'connecting'
    }

    const result = await window.ztools.internal.syncSaveConfig({
      provider: deploymentMode.value,
      enabled: syncEnabled.value,
      serverUrl: isPrivateMode.value
        ? normalizeSyncServerUrl(privateServerUrl.value || savedPrivateServerUrl.value)
        : ONLINE_SYNC_SERVER_URL,
      syncInterval: config.value.syncInterval
    })
    if (!result.success) {
      error(`保存失败：${result.error}`)
      syncEnabled.value = !syncEnabled.value
      await refreshSyncStatus()
    }
  } catch (err: any) {
    error(`操作失败：${err.message}`)
    syncEnabled.value = !syncEnabled.value
    await refreshSyncStatus()
  }
}

// 立即同步
async function syncNow(): Promise<void> {
  try {
    const result = await window.ztools.internal.syncPerformSync()
    if (result.success) {
      success('已触发重新同步')
      setTimeout(() => {
        void refreshSyncStatus()
      }, 3000)
    } else {
      error(`同步失败：${result.error}`)
    }
  } catch (err: any) {
    error(`同步失败：${err.message}`)
  }
}

async function retryNow(): Promise<void> {
  try {
    const result = await window.ztools.internal.syncRetryNow()
    if (result.success) {
      success('已触发重试')
      await refreshSyncStatus()
    } else {
      error(`重试失败：${result.error}`)
    }
  } catch (err: any) {
    error(`重试失败：${err.message}`)
  }
}

// 强制全量推送
const forcePushing = ref(false)
async function forcePushAll(): Promise<void> {
  forcePushing.value = true
  try {
    const result = await window.ztools.internal.syncForcePushAll()
    if (result.success) {
      success('已触发全量推送，请等待完成')
      setTimeout(() => {
        void refreshSyncStatus()
      }, 5000)
    } else {
      error(`推送失败：${result.error}`)
    }
  } catch (err: any) {
    error(`推送失败：${err.message}`)
  } finally {
    forcePushing.value = false
  }
}

const resettingSyncState = ref(false)
/**
 * 重置当前服务的本地 checkpoint，并触发该目标重新同步本地快照。
 * @returns 操作和状态刷新完成后的 Promise。
 */
async function resetLocalSyncState(): Promise<void> {
  const confirmed = await confirm({
    title: '重置本机同步状态',
    message:
      '确定要重置当前服务的本机同步进度吗？这不会删除本地文档、附件或其他同步服务的进度；下次同步会重新上传当前数据。',
    type: 'warning',
    confirmText: '重置进度',
    cancelText: '取消'
  })
  if (!confirmed) return

  resettingSyncState.value = true
  try {
    const result = await window.ztools.internal.syncResetLocalSyncState()
    if (!result.success) {
      error(`重置失败：${result.error || '未知错误'}`)
      return
    }

    success(`已将 ${result.documentsQueued || 0} 个文档加入当前服务的同步队列`)
    await refreshSyncStatus()
  } catch (err: any) {
    error(`重置失败：${err.message}`)
  } finally {
    resettingSyncState.value = false
  }
}

// 轮询
let statePoller: ReturnType<typeof setInterval> | null = null
let statusRefreshTimer: ReturnType<typeof setTimeout> | null = null
let stopSyncStatusListener: (() => void) | null = null

function scheduleStatusRefresh(delay = 120): void {
  if (statusRefreshTimer) {
    clearTimeout(statusRefreshTimer)
  }
  statusRefreshTimer = setTimeout(() => {
    statusRefreshTimer = null
    void refreshSyncStatus()
  }, delay)
}

function startStatePolling(): void {
  statePoller = setInterval(() => {
    scheduleStatusRefresh(0)
  }, 5000)
}

function bindSyncStatusListener(): void {
  if (typeof window.ztools.internal.onSyncStatusChanged !== 'function') return
  stopSyncStatusListener =
    window.ztools.internal.onSyncStatusChanged((payload = {}) => {
      if ('state' in payload) {
        syncState.value = payload.state || 'disconnected'
      }
      if ('retryStatus' in payload) {
        retryStatus.value = payload.retryStatus || null
      }
      if ('lastSyncTime' in payload) {
        config.value.lastSyncTime = payload.lastSyncTime || 0
      }
      if (payload.refresh !== false) {
        scheduleStatusRefresh()
      }
    }) || null
}

onMounted(() => {
  void refreshSyncStatus()
  bindSyncStatusListener()
  startStatePolling()
})

onActivated(() => {
  scheduleStatusRefresh(0)
})

onUnmounted(() => {
  if (statePoller) clearInterval(statePoller)
  if (statusRefreshTimer) clearTimeout(statusRefreshTimer)
  stopSyncStatusListener?.()
})
</script>

<template>
  <div class="content-panel">
    <div v-show="currentLevel === 'main'" class="main-content">
      <div class="sync-toolbar">
        <div class="tab-group" role="tablist" aria-label="同步服务">
          <button
            type="button"
            role="tab"
            data-testid="sync-mode-official"
            class="tab-btn"
            :class="{ active: !isPrivateMode }"
            :aria-selected="!isPrivateMode"
            :disabled="deploymentSwitching || privateLoginLoading || privateLogoutLoading"
            @click="handleDeploymentModeChange('official')"
          >
            官方服务
          </button>
          <button
            type="button"
            role="tab"
            data-testid="sync-mode-private"
            class="tab-btn"
            :class="{ active: isPrivateMode }"
            :aria-selected="isPrivateMode"
            :disabled="deploymentSwitching || privateLoginLoading || privateLogoutLoading"
            @click="handleDeploymentModeChange('private')"
          >
            私有部署
          </button>
        </div>
        <div class="header-toggle">
          <span class="toggle-label">{{ syncEnabled ? '已启用' : '已禁用' }}</span>
          <label class="toggle">
            <input
              v-model="syncEnabled"
              type="checkbox"
              :disabled="!loggedIn || deploymentSwitching || privateLogoutLoading"
              @change="handleSyncToggle"
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div class="service-settings" data-testid="sync-service-settings">
        <div v-if="!isPrivateMode" class="service-description">
          <span>使用 MaheTools 官方同步服务</span>
          <span>{{
            loggedIn ? `当前账号：${loggedUser}` : '请通过左下角登录 MaheTools 账号'
          }}</span>
        </div>

        <div
          v-if="isPrivateMode && privateSessionLoggedIn"
          class="private-session-summary"
          data-testid="private-sync-session"
        >
          <div class="private-session-details">
            <div class="private-session-item">
              <span class="private-session-label">同步服务器</span>
              <span class="private-session-value" data-testid="private-sync-current-server">
                {{ savedPrivateServerUrl }}
              </span>
            </div>
            <div class="private-session-item">
              <span class="private-session-label">当前登录用户</span>
              <span class="private-session-value" data-testid="private-sync-current-user">
                {{ savedPrivateUsername }}
              </span>
            </div>
          </div>
          <button
            type="button"
            data-testid="private-sync-logout"
            class="btn btn-sm private-logout-button"
            :disabled="privateLogoutLoading"
            @click="handlePrivateLogout"
          >
            {{ privateLogoutLoading ? '注销中...' : '注销登录' }}
          </button>
        </div>

        <form
          v-else-if="isPrivateMode"
          class="private-login-form"
          @submit.prevent="handlePrivateLogin"
        >
          <div class="private-field private-server-field">
            <label for="private-sync-server">服务器地址</label>
            <div class="private-input-action">
              <input
                id="private-sync-server"
                v-model.trim="privateServerUrl"
                data-testid="private-sync-server"
                class="input"
                type="url"
                inputmode="url"
                autocomplete="url"
                placeholder="https://sync.example.com"
                @input="markPrivateFormDirty"
              />
              <button
                type="button"
                class="btn btn-sm"
                :disabled="privateConnectionTesting || !privateServerUrl"
                @click="handlePrivateConnectionTest"
              >
                {{ privateConnectionTesting ? '测试中...' : '测试连接' }}
              </button>
            </div>
          </div>
          <div class="private-field">
            <label for="private-sync-username">用户名</label>
            <input
              id="private-sync-username"
              v-model.trim="privateUsername"
              data-testid="private-sync-username"
              class="input"
              type="text"
              autocomplete="username"
              placeholder="同步服务器账号"
              @input="markPrivateFormDirty"
            />
          </div>
          <div class="private-field">
            <label for="private-sync-password">密码</label>
            <input
              id="private-sync-password"
              v-model="privatePassword"
              data-testid="private-sync-password"
              class="input"
              type="password"
              autocomplete="current-password"
              placeholder="输入密码"
              @input="markPrivateFormDirty"
            />
          </div>
          <div class="private-login-actions">
            <span
              v-if="privateConnectionMessage"
              class="connection-message"
              :class="{ success: privateConnectionSucceeded }"
            >
              {{ privateConnectionMessage }}
            </span>
            <button
              type="submit"
              data-testid="private-sync-login"
              class="btn btn-solid btn-sm"
              :disabled="privateLoginLoading"
            >
              {{ privateLoginLoading ? '登录中...' : '登录服务器' }}
            </button>
          </div>
        </form>
      </div>

      <!-- ==================== 同步 ==================== -->
      <div class="setting-group">
        <template v-if="syncEnabled">
          <div class="setting-item">
            <div class="setting-label">
              <span>同步状态</span>
              <span class="setting-desc">
                <span class="state-dot" :style="{ background: stateColor }"></span>
                <span :style="{ color: stateColor }">{{ stateLabel }}</span>
                <span v-if="unsyncedCount > 0" class="unsynced-badge"
                  >{{ unsyncedCount }} 待同步</span
                >
                <span v-if="conflictCount > 0" class="unsynced-badge conflict-badge"
                  >{{ conflictCount }} 冲突</span
                >
              </span>
            </div>
            <div class="setting-control">
              <button class="btn btn-primary btn-sm" :disabled="!isConnected" @click="syncNow">
                立即同步
              </button>
            </div>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span>最后同步</span>
            </div>
            <div class="setting-control">
              <span class="status-value">{{ lastSyncTime }}</span>
            </div>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span>待同步文档</span>
            </div>
            <div class="setting-control">
              <span class="status-value">{{ unsyncedCount }} 个</span>
            </div>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span>弱网重试</span>
              <span class="setting-desc">
                文档批次 {{ retryStatus?.pendingPushBatches || 0 }}，上传
                {{ retryStatus?.pendingUploads || 0 }}，下载
                {{ retryStatus?.pendingDownloads || 0 }}
                <template v-if="retryStatus?.authRequired">，需要重新登录</template>
                <template v-if="retryStatus?.failedPermanent"
                  >，{{ retryStatus.failedPermanent }} 个失败</template
                >
                <template v-if="retryNextTime">，{{ retryNextTime }}</template>
                <template v-if="retryStatus?.lastError">，{{ retryStatus.lastError }}</template>
              </span>
            </div>
            <div class="setting-control">
              <button class="btn btn-sm" :disabled="retryPendingTotal === 0" @click="retryNow">
                立即重试
              </button>
            </div>
          </div>

          <div class="setting-item clickable-item" @click="openConflictList">
            <div class="setting-label">
              <span>冲突文档</span>
              <span class="setting-desc">查看当前保留的冲突文档与 revisions</span>
            </div>
            <div class="setting-control">
              <span class="status-value">{{ conflictCount }} 个</span>
            </div>
          </div>

          <div v-if="unsyncedCount > 0" class="setting-item">
            <div class="setting-label">
              <span>全量推送</span>
              <span class="setting-desc"
                >将本地所有数据强制推送到云端（首次同步或数据不一致时使用）</span
              >
            </div>
            <div class="setting-control">
              <button
                class="btn btn-sm"
                :disabled="!isConnected || forcePushing"
                @click="forcePushAll"
              >
                {{ forcePushing ? '推送中...' : '强制推送' }}
              </button>
            </div>
          </div>
        </template>

        <div class="setting-item">
          <div class="setting-label">
            <span>重置同步状态</span>
            <span class="setting-desc"
              >重置当前服务的本机进度，保留本地数据和其他服务的同步进度</span
            >
          </div>
          <div class="setting-control">
            <button
              class="btn btn-sm btn-warning"
              :disabled="!loggedIn || resettingSyncState"
              @click="resetLocalSyncState"
            >
              {{ resettingSyncState ? '重置中...' : '重置进度' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <Transition name="slide">
      <DetailPanel
        v-if="currentLevel === 'conflictList'"
        title="冲突文档"
        @back="closeConflictList"
      >
        <div class="conflict-panel-content">
          <div v-if="conflictItems.length === 0" class="empty-state">当前没有冲突文档</div>
          <div v-else class="conflict-list">
            <div
              v-for="item in conflictItems"
              :key="item.docId"
              class="card conflict-card"
              @click="openConflictDetail(item.docId)"
            >
              <div class="conflict-card-main">
                <div class="conflict-doc-id">{{ item.docId }}</div>
                <div class="conflict-meta">
                  <span>当前 winner: {{ item.winningRev || '未知' }}</span>
                  <span>冲突 leaf: {{ item.conflictCount }}</span>
                  <span v-if="item.deleted">已删除</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DetailPanel>
    </Transition>

    <Transition name="slide">
      <DetailPanel
        v-if="currentLevel === 'conflictDetail'"
        :title="selectedConflictDocId || '冲突详情'"
        @back="closeConflictDetail"
      >
        <div class="conflict-panel-content">
          <div v-if="!conflictDetail" class="empty-state">暂无冲突详情</div>
          <template v-else>
            <div class="conflict-detail-block">
              <div class="conflict-detail-title">版本对比</div>
              <div class="conflict-meta single">
                <span>Winner: {{ conflictDetail.winningRev || '未知' }}</span>
                <span v-if="conflictDetail.deleted">当前 winner 为 tombstone</span>
              </div>
              <div class="winner-actions">
                <button
                  class="btn btn-primary btn-sm"
                  :disabled="!conflictDetail.winningRev"
                  @click="handleResolveConflict(conflictDetail.winningRev!, 'winner')"
                >
                  保留当前版本并解决冲突
                </button>
              </div>
              <div v-if="conflictDetail.conflicts.length === 0" class="empty-state">
                暂无 loser leaf
              </div>
              <div v-else class="conflict-revision-list">
                <div
                  v-for="(item, index) in conflictDetail.conflicts"
                  :key="item._rev || index"
                  class="card revision-card"
                >
                  <div class="revision-header">
                    <div>
                      <div class="revision-title">Conflict: {{ item._rev || '未知' }}</div>
                      <div class="conflict-meta single">
                        <span>{{ summaryLabel(item) }}</span>
                        <span v-if="item._deleted">tombstone</span>
                      </div>
                    </div>
                    <div class="revision-actions">
                      <button class="btn btn-sm" @click="handleResolveConflict(item._rev)">
                        使用此版本
                      </button>
                    </div>
                  </div>

                  <div class="side-by-side-diff">
                    <div class="diff-pane-header">
                      <div>Winner</div>
                      <div>Conflict</div>
                    </div>
                    <div class="diff-body">
                      <div
                        v-for="(row, rowIndex) in getConflictDiffView(item).rows"
                        :key="`${item._rev || index}-${rowIndex}`"
                        class="diff-row"
                      >
                        <div :class="lineClass(row.left)">
                          <span class="diff-marker">{{ sideLabel(row.left.type) }}</span>
                          <span class="diff-line-no">{{ row.left.lineNo || '' }}</span>
                          <code>
                            <template v-if="getInlineParts(row.left, row.right).prefix">
                              {{ getInlineParts(row.left, row.right).prefix
                              }}<mark>{{ getInlineParts(row.left, row.right).value }}</mark>
                            </template>
                            <template v-else-if="getInlineParts(row.left, row.right).changed">
                              <mark>{{ getInlineParts(row.left, row.right).value }}</mark>
                            </template>
                            <template v-else>{{ row.left.text }}</template>
                          </code>
                        </div>
                        <div :class="lineClass(row.right)">
                          <span class="diff-marker">{{ sideLabel(row.right.type) }}</span>
                          <span class="diff-line-no">{{ row.right.lineNo || '' }}</span>
                          <code>
                            <template v-if="getInlineParts(row.right, row.left).prefix">
                              {{ getInlineParts(row.right, row.left).prefix
                              }}<mark>{{ getInlineParts(row.right, row.left).value }}</mark>
                            </template>
                            <template v-else-if="getInlineParts(row.right, row.left).changed">
                              <mark>{{ getInlineParts(row.right, row.left).value }}</mark>
                            </template>
                            <template v-else>{{ row.right.text }}</template>
                          </code>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </DetailPanel>
    </Transition>
  </div>
</template>

<style scoped>
.content-panel {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-color);
}

.main-content {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
}

.sync-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  margin-bottom: 20px;
  flex-shrink: 0;
}

.header-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.tab-group {
  display: flex;
  gap: 6px;
  background: var(--control-bg);
  padding: 3px;
  border-radius: 8px;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 13px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 500;
}

.tab-btn:hover:not(:disabled) {
  background: var(--hover-bg);
  color: var(--text-color);
}

.tab-btn.active {
  background: var(--active-bg);
  color: var(--primary-color);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.tab-btn:disabled {
  cursor: default;
  opacity: 0.65;
}

.service-settings {
  padding: 0 0 20px;
  border-bottom: 1px solid var(--divider-color);
}

.service-description {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  color: var(--text-secondary);
  font-size: 12px;
}

.private-login-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(180px, 1fr));
  gap: 12px;
  margin-top: 14px;
  align-items: end;
}

.private-session-summary {
  display: flex;
  min-height: 64px;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.private-session-details {
  display: flex;
  min-width: 0;
  flex: 1;
  gap: 48px;
}

.private-session-item {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.private-session-item:first-child {
  flex: 1;
}

.private-session-label {
  color: var(--text-secondary);
  font-size: 12px;
}

.private-session-value {
  overflow-wrap: anywhere;
  color: var(--text-color);
  font-size: 13px;
  line-height: 1.4;
}

.private-logout-button {
  flex: 0 0 auto;
  color: var(--danger-color, #d03050);
}

.private-logout-button:hover:not(:disabled) {
  background: var(--danger-light-bg, rgba(208, 48, 80, 0.08));
  border-color: var(--danger-color, #d03050);
}

.private-server-field {
  grid-column: 1 / -1;
}

.private-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.private-field label {
  color: var(--text-secondary);
  font-size: 12px;
}

.private-input-action {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.private-login-actions {
  grid-column: 1 / -1;
  display: flex;
  min-height: 30px;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.connection-message {
  flex: 1;
  color: var(--danger-color, #d03050);
  font-size: 12px;
}

.connection-message.success {
  color: var(--success-color, #18a058);
}

@media (max-width: 780px) {
  .sync-toolbar {
    gap: 12px;
  }

  .private-login-form {
    grid-template-columns: 1fr;
  }

  .private-login-actions {
    grid-column: 1;
  }

  .private-session-summary,
  .private-session-details {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }

  .private-logout-button {
    align-self: flex-end;
  }
}

.toggle-label {
  font-size: 13px;
  color: var(--text-secondary);
}

/* 设置分组 */
.setting-group {
  margin-bottom: 28px;
}

.setting-group:last-child {
  margin-bottom: 0;
}

.setting-group-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--primary-color);
  margin: 0 0 4px 0;
  line-height: 1.4;
}

/* 设置项 */
.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 0;
  border-bottom: 1px solid var(--divider-color);
}

.setting-group .setting-item:last-child {
  border-bottom: none;
}

.setting-label {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.setting-label > span:first-child {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color);
}

.setting-desc {
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.setting-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.clickable-item {
  cursor: pointer;
}

.clickable-item:hover {
  background: var(--hover-bg);
}

/* 状态指示 */
.state-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.unsynced-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--warning-color, #f0a020);
  color: #fff;
}

.conflict-badge {
  background: var(--danger-color, #d03050);
}

.status-value {
  font-size: 13px;
  color: var(--text-secondary);
}

.conflict-panel-content {
  padding: 16px;
}

.empty-state {
  font-size: 13px;
  color: var(--text-secondary);
}

.conflict-list,
.conflict-revision-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.conflict-card,
.revision-card {
  padding: 12px;
  cursor: pointer;
}

.conflict-card-main {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conflict-doc-id,
.conflict-detail-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
}

.conflict-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.conflict-meta.single {
  margin-bottom: 8px;
}

.winner-actions {
  display: flex;
  justify-content: flex-start;
  margin: 8px 0 12px;
}

.conflict-detail-block {
  margin-bottom: 20px;
}

.revision-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.revision-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
}

.revision-actions {
  display: flex;
  justify-content: flex-end;
}

.side-by-side-diff {
  --diff-pane-min-width: 520px;
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-color);
}

.diff-pane-header {
  display: grid;
  grid-template-columns: minmax(var(--diff-pane-min-width), 1fr) minmax(
      var(--diff-pane-min-width),
      1fr
    );
  min-width: calc(var(--diff-pane-min-width) * 2);
  border-bottom: 1px solid var(--border-color);
  background: var(--card-bg);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.diff-pane-header > div {
  padding: 8px 12px;
}

.diff-pane-header > div:first-child {
  border-right: 1px solid var(--border-color);
}

.diff-body {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  line-height: 1.55;
}

.diff-row {
  display: grid;
  grid-template-columns: minmax(var(--diff-pane-min-width), 1fr) minmax(
      var(--diff-pane-min-width),
      1fr
    );
  min-width: calc(var(--diff-pane-min-width) * 2);
}

.diff-line {
  display: grid;
  grid-template-columns: 18px 42px minmax(0, 1fr);
  min-height: 22px;
  padding-right: 10px;
  white-space: pre;
}

.diff-line:first-child {
  border-right: 1px solid var(--border-color);
}

.diff-marker,
.diff-line-no {
  user-select: none;
  color: var(--text-secondary);
  text-align: right;
}

.diff-marker {
  padding-right: 4px;
  font-weight: 700;
}

.diff-line-no {
  padding-right: 8px;
  opacity: 0.72;
}

.diff-line code {
  overflow: visible;
  color: var(--text-color);
  font-family: inherit;
}

.diff-line mark {
  border-radius: 3px;
  background: color-mix(in srgb, var(--warning-color, #f0a020), transparent 70%);
  color: inherit;
}

.diff-line-changed {
  background: color-mix(in srgb, var(--warning-color, #f0a020), transparent 86%);
}

.diff-line-added {
  background: color-mix(in srgb, var(--success-color, #10b981), transparent 84%);
}

.diff-line-added .diff-marker {
  color: var(--success-color, #10b981);
}

.diff-line-removed {
  background: color-mix(in srgb, var(--danger-color, #d03050), transparent 86%);
}

.diff-line-removed .diff-marker {
  color: var(--danger-color, #d03050);
}

.diff-line-empty {
  background: color-mix(in srgb, var(--text-secondary), transparent 94%);
}

/* 说明 */
.sync-tips {
  padding: 4px 0;
}

.tip-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.8;
}
</style>
