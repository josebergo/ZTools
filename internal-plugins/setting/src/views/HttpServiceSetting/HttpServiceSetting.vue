<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useToast } from '@/components'

const { success, error, warning, confirm } = useToast()

const enabled = ref(false)
const port = ref(36578)
const apiKey = ref('')
const showKey = ref(false)
const running = ref(false)

const serviceAddress = computed(() => `http://127.0.0.1:${port.value}`)

const responseExample = JSON.stringify({ code: 0, message: '操作成功' }, null, 2)

interface ApiEndpoint {
  method: 'GET' | 'POST'
  path: string
  desc: string
  auth: boolean
  body?: unknown
}

const apiEndpoints: ApiEndpoint[] = [
  { method: 'GET', path: '/', desc: '服务状态检测，返回 Hello MaheTools（无需认证）', auth: false },
  {
    method: 'POST',
    path: '/api/window/show',
    desc: '显示主窗口，可传 text 参数填充搜索框',
    auth: true,
    body: { text: '设置' }
  },
  { method: 'POST', path: '/api/window/hide', desc: '隐藏 MaheTools 主窗口', auth: true },
  {
    method: 'POST',
    path: '/api/window/toggle',
    desc: '切换 MaheTools 主窗口显示/隐藏状态',
    auth: true
  },
  {
    method: 'POST',
    path: '/api/plugin/launch',
    desc: '启动插件，支持传参。pluginName 对应 plugin.json 中的 name，code 和 type（text、over 等）也保持和 plugin.json 一致。type=files 时 payload 可传文件路径数组',
    auth: true,
    body: {
      pluginName: '插件名称',
      code: '功能 code',
      type: 'text',
      payload: '传给插件的内容'
    }
  }
]

function buildCurl(item: ApiEndpoint): string {
  const url = `http://127.0.0.1:${port.value}${item.path}`
  if (item.method === 'GET') {
    return `curl ${url}`
  }
  let cmd = `curl -X POST ${url} -H "Authorization: Bearer ${apiKey.value}"`
  if (item.body) {
    cmd += ` -H "Content-Type: application/json" -d '${JSON.stringify(item.body)}'`
  }
  return cmd
}

async function copyCurl(item: ApiEndpoint): Promise<void> {
  try {
    await navigator.clipboard.writeText(buildCurl(item))
    success('curl 命令已复制')
  } catch {
    error('复制失败')
  }
}

async function loadConfig(): Promise<void> {
  try {
    const result = await window.ztools.internal.httpServerGetConfig()
    if (result.success && result.config) {
      enabled.value = result.config.enabled
      port.value = result.config.port
      apiKey.value = result.config.apiKey
    }
    const statusResult = await window.ztools.internal.httpServerStatus()
    if (statusResult.success) {
      running.value = statusResult.running ?? false
    }
  } catch (err) {
    console.error('加载 HTTP 服务配置失败:', err)
  }
}

async function saveConfig(): Promise<void> {
  try {
    const result = await window.ztools.internal.httpServerSaveConfig({
      enabled: enabled.value,
      port: port.value,
      apiKey: apiKey.value
    })
    if (result.success) {
      if (result.config) {
        apiKey.value = result.config.apiKey
      }
      const statusResult = await window.ztools.internal.httpServerStatus()
      running.value = statusResult.success ? (statusResult.running ?? false) : false
    } else {
      error(`保存失败：${result.error}`)
    }
  } catch (err: unknown) {
    error(`保存失败：${err instanceof Error ? err.message : '未知错误'}`)
  }
}

async function handleToggle(): Promise<void> {
  await saveConfig()
  if (enabled.value) {
    success('HTTP 服务已启动')
  }
}

async function handlePortChange(): Promise<void> {
  if (port.value < 1024 || port.value > 65535) {
    warning('端口号需在 1024 ~ 65535 之间')
    port.value = 36578
    return
  }
  if (enabled.value) {
    await saveConfig()
  }
}

async function copyAddress(): Promise<void> {
  try {
    await navigator.clipboard.writeText(serviceAddress.value)
    success('地址已复制')
  } catch {
    error('复制失败')
  }
}

async function copyKey(): Promise<void> {
  try {
    await navigator.clipboard.writeText(apiKey.value)
    success('密钥已复制')
  } catch {
    error('复制失败')
  }
}

async function regenerateKey(): Promise<void> {
  const confirmed = await confirm({
    title: '重新生成密钥',
    message: '重新生成后，使用旧密钥的第三方应用将无法访问。确定要继续吗？',
    type: 'danger',
    confirmText: '确定',
    cancelText: '取消'
  })
  if (!confirmed) return

  try {
    const result = await window.ztools.internal.httpServerRegenerateKey()
    if (result.success && result.apiKey) {
      apiKey.value = result.apiKey
      success('密钥已重新生成')
    } else {
      error(`生成失败：${result.error}`)
    }
  } catch (err: unknown) {
    error(`生成失败：${err instanceof Error ? err.message : '未知错误'}`)
  }
}

onMounted(() => {
  loadConfig()
})
</script>
<template>
  <div class="content-panel">
    <h2 class="section-title">HTTP 服务</h2>
    <p class="section-desc">为第三方应用提供 HTTP API，可远程控制 MaheTools</p>

    <!-- 启用开关 -->
    <div class="setting-item">
      <div class="setting-label">
        <span>启用 HTTP 服务</span>
        <span class="setting-desc">开启后第三方应用可通过 HTTP 接口调用 MaheTools 功能</span>
      </div>
      <label class="toggle">
        <input v-model="enabled" type="checkbox" @change="handleToggle" />
        <span class="toggle-slider"></span>
      </label>
    </div>

    <!-- 服务配置 -->
    <div v-if="enabled" class="service-config">
      <!-- 服务地址 -->
      <div class="setting-item">
        <label class="setting-label">服务地址</label>
        <div class="address-row">
          <input :value="serviceAddress" type="text" class="input" readonly />
          <button class="btn btn-primary btn-sm" @click="copyAddress">复制</button>
        </div>
      </div>

      <!-- 端口 -->
      <div class="setting-item">
        <label class="setting-label">端口号</label>
        <input
          v-model.number="port"
          type="number"
          class="input port-input"
          min="1024"
          max="65535"
          @blur="handlePortChange"
        />
      </div>

      <!-- API 密钥 -->
      <div class="setting-item">
        <label class="setting-label">API 访问密钥</label>
        <div class="key-row">
          <input
            :value="showKey ? apiKey : '••••••••••••••••'"
            type="text"
            class="input"
            readonly
          />
          <button class="btn btn-sm" @click="showKey = !showKey">
            {{ showKey ? '隐藏' : '显示' }}
          </button>
          <button class="btn btn-sm" @click="copyKey">复制</button>
          <button class="btn btn-sm btn-warning" @click="regenerateKey">重新生成</button>
        </div>
      </div>

      <!-- 状态 -->
      <div class="status-bar">
        <span class="status-dot" :class="{ active: running }"></span>
        <span class="status-text">{{ running ? '服务运行中' : '服务未启动' }}</span>
      </div>

      <!-- API 文档 -->
      <div class="api-docs">
        <h3 class="docs-title">API 文档</h3>
        <p class="docs-desc">业务接口均为 POST 请求，需在请求头中携带 API 密钥</p>

        <div class="docs-auth">
          <span class="docs-label">认证方式</span>
          <code class="docs-code">Authorization: Bearer &lt;API_KEY&gt;</code>
        </div>

        <div class="api-list">
          <div v-for="item in apiEndpoints" :key="item.path" class="api-item">
            <div class="api-header">
              <span class="api-method" :class="item.method === 'GET' ? 'method-get' : ''">{{
                item.method
              }}</span>
              <code class="api-path">{{ item.path }}</code>
              <button class="btn btn-sm copy-curl-btn" @click="copyCurl(item)">复制 curl</button>
            </div>
            <p class="api-desc">{{ item.desc }}</p>
            <pre v-if="item.body" class="api-body">{{ JSON.stringify(item.body, null, 2) }}</pre>
          </div>
        </div>

        <div class="docs-response">
          <span class="docs-label">统一返回格式</span>
          <pre class="docs-pre">{{ responseExample }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.content-panel {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
  background: var(--bg-color);
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-color);
  margin: 0 0 8px 0;
}

.section-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0 0 24px 0;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.setting-label {
  font-size: 14px;
  color: var(--text-color);
  font-weight: 500;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.setting-desc {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 400;
}

.service-config {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--divider-color);
}

.service-config .setting-item {
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.address-row,
.key-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.address-row .input,
.key-row .input {
  flex: 1;
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  font-size: 13px;
}

.port-input {
  width: 120px;
}

/* 状态 */
.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  margin-bottom: 24px;
  padding: 10px 14px;
  background: var(--hover-bg);
  border-radius: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-secondary);
  transition: background 0.3s;
}

.status-dot.active {
  background: var(--success-color, #34c759);
  box-shadow: 0 0 6px var(--success-color, #34c759);
}

.status-text {
  font-size: 13px;
  color: var(--text-secondary);
}

/* API 文档 */
.api-docs {
  padding: 20px;
  background: var(--hover-bg);
  border-radius: 10px;
}

.docs-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color);
  margin: 0 0 8px 0;
}

.docs-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0 0 16px 0;
}

.docs-auth {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--divider-color);
}

.docs-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
}

.docs-code {
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  font-size: 12px;
  padding: 6px 10px;
  background: var(--card-bg);
  border-radius: 6px;
  color: var(--primary-color);
  word-break: break-all;
}

.api-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.api-item {
  padding: 14px;
  background: var(--card-bg);
  border-radius: 8px;
}

.api-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.api-method {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-on-primary);
  background: var(--primary-color);
  padding: 2px 8px;
  border-radius: 4px;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.api-method.method-get {
  background: var(--success-color, #34c759);
}

.copy-curl-btn {
  margin-left: auto;
  flex-shrink: 0;
}

.api-path {
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  font-size: 13px;
  color: var(--text-color);
  font-weight: 500;
}

.api-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

.api-body {
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  font-size: 12px;
  padding: 10px 12px;
  background: var(--hover-bg);
  border-radius: 6px;
  color: var(--text-color);
  margin: 10px 0 0 0;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.docs-response {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.docs-pre {
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  font-size: 12px;
  padding: 10px 12px;
  background: var(--card-bg);
  border-radius: 6px;
  color: var(--text-color);
  margin: 0;
  line-height: 1.5;
}
</style>
