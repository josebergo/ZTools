<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useToast } from '@/components'
import { ACCOUNT_CHANGED_EVENT } from '@/composables/useZToolsAccount'
import { weightedSearch } from '@/utils'
import { AiProviderEditor, OfficialAiCredits } from './components'
import { useZtoolsSubInput } from '@/composables'
import type {
  AiInputModality,
  AiProvider,
  AiProviderInput,
  AiProviderStore,
  OfficialAiProviderStatus
} from '@shared/aiProviderShared'
import { AI_API_FORMAT_OPTIONS } from '@shared/aiProviderShared'
import type { OfficialAiModel } from '@shared/aiProviderShared'

const { success, error, confirm } = useToast()
const store = ref<AiProviderStore>({ version: 2, providers: [] })
const loading = ref(true)
const isWorking = ref(false)
const showEditor = ref(false)
const editingProvider = ref<AiProvider | null>(null)
const isCopyingProvider = ref(false)
const officialProvider = ref<OfficialAiProviderStatus | null>(null)
const officialError = ref('')
const officialModelsExpanded = ref(false)
let officialProviderRequestId = 0
const { value: searchQuery } = useZtoolsSubInput('', '搜索 AI 供应商或模型...')

const filteredProviders = computed(() =>
  weightedSearch(store.value.providers, searchQuery.value || '', [
    { value: (provider) => provider.name, weight: 10 },
    { value: (provider) => provider.apiUrl, weight: 6 },
    {
      value: (provider) => provider.selectedModels.map((model) => model.modelId).join(' '),
      weight: 4
    }
  ])
)

/**
 * 从主进程加载完整的 AI 供应商文档。
 * @returns 操作完成后结束的 Promise
 */
async function loadProviders(): Promise<void> {
  loading.value = true
  try {
    const [result] = await Promise.all([
      window.ztools.internal.aiProviders.getAll(),
      loadOfficialProvider()
    ])
    if (result.success && result.data) {
      store.value = result.data
    } else {
      error(result.error || '加载 AI 供应商失败')
    }
  } catch (cause) {
    console.error('加载 AI 供应商失败:', cause)
    error('加载 AI 供应商失败')
  } finally {
    loading.value = false
  }
}

/**
 * 从主进程刷新官方模型及当前账号登录状态。
 * @returns 官方模型状态刷新完成后结束的 Promise
 */
async function loadOfficialProvider(): Promise<void> {
  const requestId = ++officialProviderRequestId
  try {
    const result = await window.ztools.internal.aiProviders.getOfficial()
    // 账号快速切换时只允许最后一次请求更新页面状态。
    if (requestId !== officialProviderRequestId) return
    if (result.success && result.data) {
      officialProvider.value = result.data
      officialError.value = ''
    } else {
      officialProvider.value = null
      officialError.value = result.error || '官方模型暂不可用'
    }
  } catch (cause) {
    if (requestId !== officialProviderRequestId) return
    console.error('加载 MaheTools 官方模型失败:', cause)
    officialProvider.value = null
    officialError.value = '官方模型暂不可用'
  }
}

/**
 * 响应登录、退出或账号切换并刷新官方模型可用状态。
 * @returns 无返回值
 */
function handleAccountChanged(): void {
  void loadOfficialProvider()
}

/**
 * 打开新建供应商编辑面板。
 * @returns 无返回值
 */
function showAddEditor(): void {
  editingProvider.value = null
  isCopyingProvider.value = false
  showEditor.value = true
}

/**
 * 打开指定供应商的编辑面板。
 * @param provider 要编辑的供应商
 * @returns 无返回值
 */
function handleEdit(provider: AiProvider): void {
  editingProvider.value = provider
  isCopyingProvider.value = false
  showEditor.value = true
}

/**
 * 打开指定供应商的可编辑副本，并为副本生成不重名的名称。
 * @param provider 要复制的供应商
 * @returns 无返回值
 */
function handleCopy(provider: AiProvider): void {
  const existingNames = new Set(store.value.providers.map((item) => item.name.trim().toLowerCase()))
  const baseName = `${provider.name} 副本`
  let copyName = baseName
  let sequence = 2
  while (existingNames.has(copyName.trim().toLowerCase())) {
    copyName = `${baseName} ${sequence}`
    sequence += 1
  }

  // 复制时去掉内部 ID，保存时必须走新增接口；模型配置由编辑器重新建立响应式副本。
  editingProvider.value = {
    ...provider,
    id: '',
    name: copyName,
    selectedModels: provider.selectedModels.map((model) => ({ ...model }))
  }
  isCopyingProvider.value = true
  showEditor.value = true
}

/**
 * 关闭供应商编辑面板并清理编辑目标。
 * @returns 无返回值
 */
function closeEditor(): void {
  showEditor.value = false
  editingProvider.value = null
  isCopyingProvider.value = false
}

/**
 * 新建或更新供应商，并在成功后刷新列表。
 * @param provider 供应商连接信息和已选模型
 * @returns 操作完成后结束的 Promise
 */
async function handleSave(provider: AiProviderInput): Promise<void> {
  if (!provider.name.trim() || !provider.apiUrl.trim() || !provider.apiKey.trim()) {
    error('请填写供应商名称、API 地址和密钥')
    return
  }
  if (provider.selectedModels.length === 0) {
    error('请至少选择一个模型')
    return
  }

  isWorking.value = true
  try {
    const result = provider.id
      ? await window.ztools.internal.aiProviders.update(provider)
      : await window.ztools.internal.aiProviders.add(provider)
    if (!result.success) {
      error(result.error || '保存供应商失败')
      return
    }

    success(provider.id ? '供应商已更新' : '供应商已添加')
    await loadProviders()
    closeEditor()
  } catch (cause) {
    console.error('保存 AI 供应商失败:', cause)
    error('保存供应商失败')
  } finally {
    isWorking.value = false
  }
}

/**
 * 确认后删除供应商及其全部模型。
 * @param provider 要删除的供应商
 * @returns 操作完成后结束的 Promise
 */
async function handleDelete(provider: AiProvider): Promise<void> {
  const confirmed = await confirm({
    message: `确定删除“${provider.name}”及其 ${provider.selectedModels.length} 个模型吗？`,
    title: '删除供应商',
    type: 'warning'
  })
  if (!confirmed) return

  isWorking.value = true
  try {
    const result = await window.ztools.internal.aiProviders.delete(provider.id)
    if (!result.success) {
      error(result.error || '删除供应商失败')
      return
    }
    success('供应商已删除')
    await loadProviders()
  } catch (cause) {
    console.error('删除 AI 供应商失败:', cause)
    error('删除供应商失败')
  } finally {
    isWorking.value = false
  }
}

/**
 * 开启或关闭供应商，并同步主进程返回的最新配置。
 * @param provider 要修改状态的供应商
 * @param enabled 是否允许插件发现和调用该供应商
 * @returns 操作完成后结束的 Promise
 */
async function handleToggleProvider(provider: AiProvider, enabled: boolean): Promise<void> {
  if (provider.enabled === enabled) return

  isWorking.value = true
  try {
    const result = await window.ztools.internal.aiProviders.setEnabled(provider.id, enabled)
    if (!result.success) {
      error(result.error || '更新供应商状态失败')
      return
    }
    if (result.data) store.value = result.data
    success(enabled ? '供应商已开启' : '供应商已关闭')
  } catch (cause) {
    console.error('更新 AI 供应商状态失败:', cause)
    error('更新供应商状态失败')
  } finally {
    isWorking.value = false
  }
}

/**
 * 将 API 密钥转换为适合列表展示的掩码。
 * @param apiKey 完整 API 密钥
 * @returns 掩码后的密钥
 */
function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return '********'
  return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`
}

/**
 * 将接口格式枚举值转换为展示用标签。
 * @param apiFormat 供应商接口格式
 * @returns 格式标签
 */
function formatLabel(apiFormat: AiProvider['apiFormat']): string {
  return (
    AI_API_FORMAT_OPTIONS.find((option) => option.value === apiFormat)?.label ||
    'OpenAI Chat Completions'
  )
}

/**
 * 读取官方模型可展示的图标地址。
 * @param model 官方模型目录项
 * @returns 去除首尾空白后的图标地址
 */
function officialModelIcon(model: OfficialAiModel): string {
  return model.icon?.trim() || ''
}

/**
 * 判断官方模型是否支持指定输入模态，并为旧目录数据保留文本输入默认值。
 * @param model 官方模型目录项
 * @param modality 要检查的输入模态
 * @returns 模型是否支持该输入模态
 */
function officialModelSupportsModality(model: OfficialAiModel, modality: AiInputModality): boolean {
  const modalities = model.capabilities.inputModalities
  return modalities?.length ? modalities.includes(modality) : modality === 'text'
}

/**
 * 将上下文窗口 token 数格式化为紧凑文本。
 * @param value 上下文窗口 token 数
 * @returns 使用 K 或 M 单位的上下文窗口文本
 */
function formatContextWindow(value: number): string {
  if (value >= 1_048_576 && value % 1_048_576 === 0) return `${value / 1_048_576}M`
  if (value >= 1024 && value % 1024 === 0) return `${value / 1024}K`
  return `${Math.round(value / 1024)}K`
}

onMounted(() => {
  // 先订阅账号变化，避免首次加载期间完成登录时漏掉刷新事件。
  window.addEventListener(ACCOUNT_CHANGED_EVENT, handleAccountChanged)
  void loadProviders()
})

onBeforeUnmount(() => {
  window.removeEventListener(ACCOUNT_CHANGED_EVENT, handleAccountChanged)
  // 使卸载前仍在执行的请求失效，禁止回写已销毁页面。
  officialProviderRequestId += 1
})
</script>

<template>
  <div class="content-panel">
    <Transition name="list-slide">
      <div v-show="!showEditor" class="scrollable-content">
        <div class="panel-header">
          <div class="summary">
            <strong>{{ store.providers.length }}</strong>
            <span>个供应商</span>
            <span class="summary-divider" />
            <strong>{{
              store.providers.reduce((sum, item) => sum + item.selectedModels.length, 0)
            }}</strong>
            <span>个模型</span>
          </div>
          <button class="btn btn-solid" @click="showAddEditor">添加供应商</button>
        </div>

        <div class="provider-list">
          <article v-if="officialProvider" class="card provider-item official-provider">
            <header class="provider-header official-provider-header">
              <div class="provider-identity">
                <div class="official-title-row">
                  <h3>{{ officialProvider.catalog.provider.name }}</h3>
                  <span class="official-badge">官方</span>
                </div>
              </div>
              <div class="official-status-chips">
                <OfficialAiCredits v-if="officialProvider.loggedIn" />
                <span v-else class="official-login-status"> 登录 MaheTools 账号后可调用 </span>
              </div>
            </header>
            <div class="official-model-table-wrap">
              <div
                class="official-model-table-viewport"
                :class="{
                  collapsible: officialProvider.catalog.models.length > 3,
                  expanded: officialModelsExpanded
                }"
                :style="{
                  '--official-model-table-height': `${28 + officialProvider.catalog.models.length * 32}px`
                }"
              >
                <table class="official-model-table">
                  <colgroup>
                    <col class="official-model-column-name" />
                    <col class="official-model-column-context" />
                    <col class="official-model-column-price" />
                    <col class="official-model-column-price" />
                    <col class="official-model-column-cache" />
                    <col class="official-model-column-modalities" />
                    <col class="official-model-column-reasoning" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">模型</th>
                      <th scope="col">上下文</th>
                      <th scope="col">输入</th>
                      <th scope="col">输出</th>
                      <th scope="col">缓存读取</th>
                      <th scope="col">模态</th>
                      <th scope="col">思考</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="model in officialProvider.catalog.models" :key="model.id">
                      <td class="official-model-name-cell">
                        <span class="official-model-identity">
                          <img
                            v-if="officialModelIcon(model)"
                            class="official-model-icon"
                            :src="officialModelIcon(model)"
                            :alt="model.name || model.id"
                          />
                          <span v-else class="official-model-icon-placeholder">?</span>
                          <span class="official-model-name">
                            <strong>{{ model.name || model.id }}</strong>
                          </span>
                        </span>
                      </td>
                      <td>
                        <span class="official-context">{{
                          formatContextWindow(model.capabilities.contextWindow)
                        }}</span>
                      </td>
                      <td>{{ model.pricing?.input || '—' }}</td>
                      <td>{{ model.pricing?.output || '—' }}</td>
                      <td>{{ model.pricing?.cacheRead || '—' }}</td>
                      <td>
                        <span
                          class="official-model-modalities"
                          role="img"
                          :aria-label="
                            officialModelSupportsModality(model, 'image')
                              ? '支持文本和图片输入'
                              : '支持文本输入'
                          "
                        >
                          <span
                            v-if="officialModelSupportsModality(model, 'text')"
                            class="i-z-text official-model-modality-icon"
                            title="文本输入"
                            aria-hidden="true"
                          />
                          <span
                            v-if="officialModelSupportsModality(model, 'image')"
                            class="i-z-image official-model-modality-icon"
                            title="图片输入"
                            aria-hidden="true"
                          />
                        </span>
                      </td>
                      <td>
                        <span v-if="model.capabilities.reasoning.supported">
                          {{
                            model.capabilities.reasoning.efforts
                              .map((item) => item.label)
                              .join('、') || '—'
                          }}
                        </span>
                        <span v-else>—</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div
                v-if="officialProvider.catalog.models.length > 3"
                class="official-model-toggle"
                :class="{ expanded: officialModelsExpanded }"
              >
                <button
                  type="button"
                  :aria-expanded="officialModelsExpanded"
                  :title="officialModelsExpanded ? '收起模型列表' : '展开全部模型'"
                  @click="officialModelsExpanded = !officialModelsExpanded"
                >
                  <span class="official-model-toggle-chevron" aria-hidden="true" />
                  <span>{{ officialModelsExpanded ? '收起' : '展开全部' }}</span>
                </button>
              </div>
            </div>
          </article>

          <div v-else-if="officialError" class="official-error">
            MaheTools 官方模型：{{ officialError }}
          </div>

          <article
            v-for="provider in filteredProviders"
            :key="provider.id"
            class="card provider-item"
            :class="{ 'provider-disabled': !provider.enabled }"
          >
            <header class="provider-header">
              <div class="provider-identity">
                <h3>{{ provider.name }}</h3>
                <div class="provider-url">{{ provider.apiUrl }}</div>
              </div>
              <div class="provider-actions">
                <label
                  class="provider-toggle"
                  :title="provider.enabled ? '关闭供应商' : '开启供应商'"
                >
                  <span class="provider-status">{{ provider.enabled ? '已开启' : '未开启' }}</span>
                  <span class="toggle toggle-sm">
                    <input
                      type="checkbox"
                      :checked="provider.enabled"
                      :disabled="isWorking"
                      @change="
                        handleToggleProvider(provider, ($event.target as HTMLInputElement).checked)
                      "
                    />
                    <span class="toggle-slider" />
                  </span>
                </label>
                <button
                  class="icon-btn"
                  title="编辑供应商"
                  :disabled="isWorking"
                  @click="handleEdit(provider)"
                >
                  <div class="i-z-settings font-size-16px" />
                </button>
                <button
                  class="icon-btn"
                  title="复制供应商"
                  :disabled="isWorking"
                  @click="handleCopy(provider)"
                >
                  <div class="i-z-copy font-size-16px" />
                </button>
                <button
                  class="icon-btn delete-button"
                  title="删除供应商"
                  :disabled="isWorking"
                  @click="handleDelete(provider)"
                >
                  <div class="i-z-trash font-size-16px" />
                </button>
              </div>
            </header>

            <div class="provider-meta">
              <span>{{ provider.selectedModels.length }} 个模型</span>
              <span>{{ formatLabel(provider.apiFormat) }}</span>
              <span>{{ maskApiKey(provider.apiKey) }}</span>
            </div>

            <div class="model-tags">
              <code v-for="model in provider.selectedModels" :key="model.ref" class="model-tag">
                {{ model.modelId }}
              </code>
            </div>
          </article>

          <div
            v-if="!loading && !officialProvider && store.providers.length === 0"
            class="empty-state provider-empty"
          >
            <div class="i-z-brain empty-icon font-size-64px" />
            <div class="empty-text">暂无 AI 供应商</div>
            <div class="empty-hint">添加供应商后选择需要使用的模型</div>
          </div>

          <div
            v-else-if="
              !loading && filteredProviders.length === 0 && (searchQuery || !officialProvider)
            "
            class="empty-state compact-empty"
          >
            <div class="empty-text">没有匹配的供应商或模型</div>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="slide">
      <AiProviderEditor
        v-if="showEditor"
        :editing-provider="editingProvider"
        :is-copying="isCopyingProvider"
        @back="closeEditor"
        @save="handleSave"
      />
    </Transition>
  </div>
</template>

<style scoped>
.content-panel {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: var(--bg-color);
}

.scrollable-content {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.summary {
  display: flex;
  align-items: baseline;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 12px;
}

.summary strong {
  color: var(--text-color);
  font-size: 14px;
}

.summary-divider {
  width: 1px;
  height: 12px;
  margin: 0 5px;
  background: var(--divider-color);
}

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.provider-item {
  padding: 16px;
}

.provider-item:hover {
  border-color: color-mix(in srgb, var(--primary-color), transparent 35%);
}

.official-provider {
  padding: 8px;
  border-color: color-mix(in srgb, var(--primary-color), transparent 45%);
  background: transparent;
}

.official-provider-header {
  gap: 12px;
}

.official-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.official-badge {
  padding: 2px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--primary-color) 15%, transparent);
  color: var(--primary-color);
  font-size: 11px;
  font-weight: 600;
}

.official-login-status {
  color: var(--text-secondary);
  font-size: 12px;
}

.official-status-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.official-model-table-wrap {
  position: relative;
  margin-top: 8px;
  overflow-x: hidden;
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--card-bg) 72%, transparent);
}

.official-model-table-viewport {
  position: relative;
  max-height: var(--official-model-table-height);
  overflow: hidden;
  transition: max-height 0.28s ease;
}

.official-model-table-viewport.collapsible:not(.expanded) {
  max-height: 148px;
}

.official-model-table-viewport.collapsible::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 52px;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    color-mix(in srgb, var(--dialog-bg) 68%, transparent) 42%,
    var(--dialog-bg) 82%
  );
  content: '';
  pointer-events: none;
  transition: opacity 0.2s ease;
}

.official-model-table-viewport.expanded {
  max-height: var(--official-model-table-height);
}

.official-model-table-viewport.expanded::after {
  opacity: 0;
}

.official-model-table {
  width: 100%;
  min-width: 0;
  border-collapse: separate;
  border-spacing: 0;
  color: var(--text-color);
  font-size: 12px;
  table-layout: fixed;
}

.official-model-column-name {
  width: 29%;
}

.official-model-column-context {
  width: 11%;
}

.official-model-column-price {
  width: 9%;
}

.official-model-column-cache {
  width: 13%;
}

.official-model-column-modalities {
  width: 11%;
}

.official-model-column-reasoning {
  width: 18%;
}

.official-model-table th,
.official-model-table td {
  box-sizing: border-box;
  overflow: hidden;
  padding: 5px 8px;
  border-bottom: 1px solid var(--divider-color);
  text-align: right;
  white-space: nowrap;
}

.official-model-table thead th {
  height: 28px;
  padding-top: 6px;
  padding-bottom: 6px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
}

.official-model-table tbody td {
  height: 32px;
}

.official-model-table tbody tr:last-child th,
.official-model-table tbody tr:last-child td {
  border-bottom: 0;
}

.official-model-table th:first-child,
.official-model-table td:first-child {
  text-align: left;
}

.official-model-table tbody tr {
  transition: background-color 0.15s ease;
}

.official-model-table tbody tr:hover {
  background: color-mix(in srgb, var(--primary-color) 5%, transparent);
}

.official-model-name-cell {
  min-width: 0;
}

.official-model-identity {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 7px;
}

.official-model-icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  object-fit: contain;
}

.official-model-icon-placeholder {
  display: grid;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  place-items: center;
  color: var(--text-secondary);
  font-size: 12px;
}

.official-model-name {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.official-model-name strong {
  overflow: hidden;
  color: var(--text-color);
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.official-context {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  padding: 2px 5px;
  border: 1px solid color-mix(in srgb, var(--primary-color) 18%, var(--divider-color));
  border-radius: 8px;
  background: color-mix(in srgb, var(--primary-color) 5%, transparent);
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 11px;
}

.official-model-modalities {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 34px;
  gap: 5px;
  color: var(--text-secondary);
}

.official-model-modality-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.official-model-toggle {
  position: absolute;
  right: 0;
  bottom: 3px;
  left: 0;
  z-index: 2;
  display: flex;
  justify-content: center;
}

.official-model-toggle.expanded {
  position: static;
  padding: 2px 0 3px;
  border-top: 1px solid var(--divider-color);
}

.official-model-toggle button {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 22px;
  padding: 2px 6px;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 11px;
}

.official-model-toggle button:hover {
  color: var(--primary-color);
}

.official-model-toggle-chevron {
  width: 6px;
  height: 6px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg) translateY(-1px);
  transition: transform 0.2s ease;
}

.official-model-toggle.expanded .official-model-toggle-chevron {
  transform: rotate(225deg) translate(-1px, -1px);
}

.official-error {
  padding: 12px 14px;
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 12px;
}

.provider-disabled .provider-identity,
.provider-disabled .provider-meta,
.provider-disabled .model-tags {
  opacity: 0.52;
}

@media (max-width: 700px) {
  .official-status-chips {
    justify-content: flex-start;
  }

  .official-model-table-wrap {
    overflow-x: auto;
  }

  .official-model-table {
    min-width: 0;
  }

  .official-model-table-viewport {
    min-width: 560px;
  }

  .official-model-table th,
  .official-model-table td {
    padding: 5px 7px;
  }
}

.provider-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.provider-identity {
  flex: 1;
  min-width: 0;
}

.provider-identity h3 {
  margin: 0 0 4px;
  color: var(--text-color);
  font-size: 15px;
  font-weight: 600;
}

.provider-url {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.provider-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-right: 5px;
  cursor: pointer;
}

.provider-status {
  min-width: 36px;
  color: var(--text-secondary);
  font-size: 11px;
  text-align: right;
}

.toggle-sm {
  width: 36px;
  height: 20px;
  margin: 0;
}

.toggle-sm .toggle-slider {
  border-radius: 20px;
}

.toggle-sm .toggle-slider::before {
  width: 12px;
  height: 12px;
}

.toggle-sm input:checked + .toggle-slider::before {
  transform: translateX(16px);
}

.provider-actions .icon-btn:hover:not(:disabled) {
  background: var(--hover-bg);
  color: var(--primary-color);
}

.provider-actions .delete-button:hover:not(:disabled) {
  background: var(--danger-light-bg);
  color: var(--danger-color);
}

.provider-meta {
  display: flex;
  gap: 14px;
  margin: 13px 0 8px;
  color: var(--text-secondary);
  font-size: 11px;
}

.model-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  padding-top: 3px;
}

.model-tag {
  max-width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--control-border);
  border-radius: 4px;
  background: var(--control-bg);
  overflow-wrap: anywhere;
  color: var(--text-color);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.4;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.provider-empty {
  position: absolute;
  inset: 0;
  padding: 20px;
  pointer-events: none;
}

.empty-icon {
  margin-bottom: 16px;
  color: var(--text-secondary);
  opacity: 0.3;
}

.empty-text {
  margin-bottom: 8px;
  color: var(--text-color);
  font-size: 16px;
  font-weight: 500;
}

.empty-hint {
  color: var(--text-secondary);
  font-size: 14px;
}

.compact-empty {
  min-height: 180px;
}

.list-slide-enter-active,
.list-slide-leave-active {
  transition:
    transform 0.2s ease,
    opacity 0.15s ease;
}

.list-slide-enter-from,
.list-slide-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}

@media (max-width: 650px) {
  .scrollable-content {
    padding: 14px;
  }

  .provider-status {
    display: none;
  }
}
</style>
