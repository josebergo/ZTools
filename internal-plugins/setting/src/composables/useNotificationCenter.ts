import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { ACCOUNT_CHANGED_EVENT } from './useZToolsAccount'

export interface NotificationItem {
  id: number
  type: string
  title: string
  content: string
  level: string
  payload: Record<string, unknown>
  read: boolean
  createdAt: number
}

type LocalNotificationState = {
  readIds: number[]
  archivedIds: number[]
}

export interface NotificationCenterState {
  items: Ref<NotificationItem[]>
  unreadCount: Ref<number>
  unreadLabel: ComputedRef<string>
  hasMore: Ref<boolean>
  loading: Ref<boolean>
  loadingMore: Ref<boolean>
  error: Ref<string>
  activeFilter: Ref<'all' | 'unread'>
  refreshSummary: () => Promise<void>
  loadNotifications: (filter?: 'all' | 'unread') => Promise<void>
  loadMoreNotifications: () => Promise<void>
  markNotificationRead: (item: NotificationItem) => Promise<boolean>
  markAllNotificationsRead: () => Promise<boolean>
  archiveNotification: (item: NotificationItem) => Promise<boolean>
}

const POLL_INTERVAL_MS = 5 * 60 * 1000
const POLL_JITTER_MS = 30 * 1000
const LOCAL_STATE_KEY = 'notification-public-state'

const items = ref<NotificationItem[]>([])
const unreadCount = ref(0)
const hasMoreUnread = ref(false)
const nextBeforeId = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const activeFilter = ref<'all' | 'unread'>('all')
let pollTimer: number | null = null
let pollingStarted = false

const unreadLabel = computed(() => {
  if (hasMoreUnread.value || unreadCount.value > 99) return '99+'
  return String(unreadCount.value)
})

/**
 * 提供设置插件消息中心的共享状态和操作。
 * @returns 消息中心状态与操作方法。
 */
export function useNotificationCenter(): NotificationCenterState {
  return {
    items,
    unreadCount,
    unreadLabel,
    hasMore,
    loading,
    loadingMore,
    error,
    activeFilter,
    refreshSummary,
    loadNotifications,
    loadMoreNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    archiveNotification
  }
}

/**
 * 启动仅在设置插件可见时运行的消息检查。
 * @returns 无返回值。
 */
export function startNotificationPolling(): void {
  if (pollingStarted) return
  pollingStarted = true
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener(ACCOUNT_CHANGED_EVENT, handleAccountChanged)
  void refreshSummary()
  scheduleNextPoll()
}

/**
 * 停止设置插件消息检查并释放监听器。
 * @returns 无返回值。
 */
export function stopNotificationPolling(): void {
  if (!pollingStarted) return
  pollingStarted = false
  if (pollTimer !== null) window.clearTimeout(pollTimer)
  pollTimer = null
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener(ACCOUNT_CHANGED_EVENT, handleAccountChanged)
}

/**
 * 刷新当前账号的消息摘要；未登录时根据本地已读记录计算公开公告未读数。
 * @returns 刷新完成后的 Promise。
 */
export async function refreshSummary(): Promise<void> {
  try {
    const loggedIn = await isOfficialAccountLoggedIn()
    if (loggedIn) {
      const result = await window.ztools.internal.notificationSummary()
      if (!result.success || !result.data) return
      unreadCount.value = result.data.unreadCount
      hasMoreUnread.value = result.data.hasMoreUnread
      return
    }
    const [result, localState] = await Promise.all([
      window.ztools.internal.notificationList(0, 50, false),
      loadLocalState()
    ])
    if (!result.success || !result.data) return
    const visible = applyLocalState(result.data.items, localState)
    unreadCount.value = visible.filter((item) => !item.read).length
    hasMoreUnread.value = result.data.hasMore && unreadCount.value >= 50
  } catch {
    // 摘要刷新失败不打断设置页其他功能。
  }
}

/**
 * 加载消息中心首页，并按当前筛选条件覆盖现有列表。
 * @param filter 要加载的消息范围。
 * @returns 加载完成后的 Promise。
 */
export async function loadNotifications(
  filter: 'all' | 'unread' = activeFilter.value
): Promise<void> {
  activeFilter.value = filter
  loading.value = true
  error.value = ''
  try {
    const loggedIn = await isOfficialAccountLoggedIn()
    const result = await window.ztools.internal.notificationList(
      0,
      20,
      loggedIn && filter === 'unread'
    )
    if (!result.success || !result.data) {
      error.value = result.error || '消息加载失败'
      return
    }
    const localState = loggedIn ? null : await loadLocalState()
    const nextItems = localState
      ? applyLocalState(result.data.items, localState)
      : result.data.items
    items.value = filter === 'unread' ? nextItems.filter((item) => !item.read) : nextItems
    nextBeforeId.value = result.data.nextBeforeId
    hasMore.value = result.data.hasMore
    unreadCount.value = loggedIn
      ? result.data.unreadCount
      : nextItems.filter((item) => !item.read).length
    hasMoreUnread.value = result.data.hasMoreUnread
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '消息加载失败'
  } finally {
    loading.value = false
  }
}

/**
 * 使用服务端游标追加下一页消息。
 * @returns 加载完成后的 Promise。
 */
async function loadMoreNotifications(): Promise<void> {
  if (!hasMore.value || loadingMore.value || nextBeforeId.value <= 0) return
  loadingMore.value = true
  try {
    const loggedIn = await isOfficialAccountLoggedIn()
    const result = await window.ztools.internal.notificationList(
      nextBeforeId.value,
      20,
      loggedIn && activeFilter.value === 'unread'
    )
    if (!result.success || !result.data) {
      error.value = result.error || '更多消息加载失败'
      return
    }
    const localState = loggedIn ? null : await loadLocalState()
    const nextItems = localState
      ? applyLocalState(result.data.items, localState)
      : result.data.items
    const visibleItems =
      activeFilter.value === 'unread' ? nextItems.filter((item) => !item.read) : nextItems
    const existingIDs = new Set(items.value.map((item) => item.id))
    items.value.push(...visibleItems.filter((item) => !existingIDs.has(item.id)))
    nextBeforeId.value = result.data.nextBeforeId
    hasMore.value = result.data.hasMore
  } finally {
    loadingMore.value = false
  }
}

/**
 * 标记一条消息已读，并同步更新列表和未读数。
 * @param item 需要标记的消息。
 * @returns 操作是否成功。
 */
async function markNotificationRead(item: NotificationItem): Promise<boolean> {
  if (item.read) return true
  const loggedIn = await isOfficialAccountLoggedIn()
  if (loggedIn) {
    const result = await window.ztools.internal.notificationMarkRead(item.id)
    if (!result.success) {
      error.value = result.error || '标记消息已读失败'
      return false
    }
  } else {
    const state = await loadLocalState()
    state.readIds = uniqueRecentIDs([...state.readIds, item.id])
    await saveLocalState(state)
  }
  item.read = true
  unreadCount.value = Math.max(0, unreadCount.value - 1)
  if (activeFilter.value === 'unread') {
    items.value = items.value.filter((entry) => entry.id !== item.id)
  }
  return true
}

/**
 * 将当前可见范围内的消息全部标记为已读。
 * @returns 操作是否成功。
 */
async function markAllNotificationsRead(): Promise<boolean> {
  const loggedIn = await isOfficialAccountLoggedIn()
  if (loggedIn) {
    const result = await window.ztools.internal.notificationMarkAllRead()
    if (!result.success) {
      error.value = result.error || '全部标记已读失败'
      return false
    }
  } else {
    const state = await loadLocalState()
    state.readIds = uniqueRecentIDs([...state.readIds, ...items.value.map((item) => item.id)])
    await saveLocalState(state)
  }
  items.value.forEach((item) => {
    item.read = true
  })
  unreadCount.value = 0
  hasMoreUnread.value = false
  if (activeFilter.value === 'unread') items.value = []
  return true
}

/**
 * 归档一条消息；公开公告在未登录状态下仅归档到本机。
 * @param item 需要归档的消息。
 * @returns 操作是否成功。
 */
async function archiveNotification(item: NotificationItem): Promise<boolean> {
  const loggedIn = await isOfficialAccountLoggedIn()
  if (loggedIn) {
    const result = await window.ztools.internal.notificationArchive(item.id)
    if (!result.success) {
      error.value = result.error || '归档消息失败'
      return false
    }
  } else {
    const state = await loadLocalState()
    state.readIds = uniqueRecentIDs([...state.readIds, item.id])
    state.archivedIds = uniqueRecentIDs([...state.archivedIds, item.id])
    await saveLocalState(state)
  }
  if (!item.read) unreadCount.value = Math.max(0, unreadCount.value - 1)
  items.value = items.value.filter((entry) => entry.id !== item.id)
  return true
}

/**
 * 判断当前是否登录官方 MaheTools 账号。
 * @returns 已登录官方账号时返回 true。
 */
async function isOfficialAccountLoggedIn(): Promise<boolean> {
  try {
    const result = await window.ztools.internal.accountGetSession()
    return Boolean(result.success && result.session?.token)
  } catch {
    return false
  }
}

/**
 * 读取未登录用户的公开公告本地状态。
 * @returns 本地已读和归档消息标识。
 */
async function loadLocalState(): Promise<LocalNotificationState> {
  try {
    const value = await window.ztools.internal.dbGet(LOCAL_STATE_KEY)
    return {
      readIds: Array.isArray(value?.readIds) ? value.readIds.map(Number).filter(Boolean) : [],
      archivedIds: Array.isArray(value?.archivedIds)
        ? value.archivedIds.map(Number).filter(Boolean)
        : []
    }
  } catch {
    return { readIds: [], archivedIds: [] }
  }
}

/**
 * 保存未登录用户的公开公告本地状态。
 * @param state 要保存的本地状态。
 * @returns 保存完成后的 Promise。
 */
async function saveLocalState(state: LocalNotificationState): Promise<void> {
  await window.ztools.internal.dbPut(LOCAL_STATE_KEY, state)
}

/**
 * 将本地已读和归档状态合并到公开公告列表。
 * @param source 服务端公告列表。
 * @param state 本地公告状态。
 * @returns 排除已归档公告并带已读状态的列表。
 */
function applyLocalState(
  source: NotificationItem[],
  state: LocalNotificationState
): NotificationItem[] {
  const readIDs = new Set(state.readIds)
  const archivedIDs = new Set(state.archivedIds)
  return source
    .filter((item) => !archivedIDs.has(item.id))
    .map((item) => ({ ...item, read: readIDs.has(item.id) }))
}

/**
 * 保留最近的本地消息标识，防止状态文档无限增长。
 * @param ids 原始消息标识列表。
 * @returns 去重并截断后的消息标识列表。
 */
function uniqueRecentIDs(ids: number[]): number[] {
  return [...new Set(ids.filter((id) => id > 0))].sort((a, b) => b - a).slice(0, 500)
}

/**
 * 安排下一次带随机抖动的消息摘要检查。
 * @returns 无返回值。
 */
function scheduleNextPoll(): void {
  if (!pollingStarted) return
  const delay = POLL_INTERVAL_MS + Math.floor(Math.random() * POLL_JITTER_MS)
  pollTimer = window.setTimeout(async () => {
    if (document.visibilityState === 'visible') await refreshSummary()
    scheduleNextPoll()
  }, delay)
}

/**
 * 设置插件重新可见时立即同步消息摘要。
 * @returns 无返回值。
 */
function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') void refreshSummary()
}

/**
 * 账号切换后清理旧列表并加载新账号摘要。
 * @returns 无返回值。
 */
function handleAccountChanged(): void {
  items.value = []
  unreadCount.value = 0
  nextBeforeId.value = 0
  hasMore.value = false
  void refreshSummary()
}
