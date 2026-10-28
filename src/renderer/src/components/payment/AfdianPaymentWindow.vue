<template>
  <main class="payment-shell">
    <div class="window-toolbar">
      <button class="window-close" type="button" aria-label="关闭支付窗口" @click="closeWindow">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7 7 10 10M17 7 7 17" />
        </svg>
      </button>
    </div>
    <section class="payment-card">
      <header class="brand-header">
        <div class="brand-mark">
          <img :src="logo" alt="MaheTools" />
        </div>
        <div class="brand-copy">
          <div class="eyebrow">MaheTools 安全支付</div>
          <h1>{{ state.productName || '赞助 MaheTools' }}</h1>
        </div>
        <div class="afdian-badge">爱发电提供支付</div>
      </header>

      <div class="amount-panel">
        <span>支付金额</span>
        <strong><small>¥</small>{{ state.amount || '--' }}</strong>
        <p>订单金额已锁定，支付时无法修改</p>
      </div>

      <section v-if="state.stage === 'loading'" class="status-panel">
        <div class="loading-orbit" aria-hidden="true"><i></i><i></i><i></i></div>
        <h2>正在准备支付页面</h2>
        <p>{{ state.message }}</p>
      </section>

      <section v-else-if="isLoginStage" class="login-section">
        <div class="login-heading">
          <div class="status-icon login-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M8 10V7a4 4 0 0 1 8 0v3M6 10h12v10H6z" />
            </svg>
          </div>
          <div>
            <h2>登录爱发电</h2>
            <p>登录状态会安全保存在本机，后续支付无需重复登录</p>
          </div>
        </div>

        <form class="login-form" @submit.prevent="submitLogin">
          <label for="afdian-phone">手机号</label>
          <div class="phone-row">
            <input
              id="afdian-phone"
              v-model="phone"
              inputmode="tel"
              maxlength="11"
              autocomplete="tel"
              placeholder="请输入手机号"
              :disabled="codeWasSent || loginBusy"
            />
            <button
              type="button"
              class="code-button"
              :disabled="!canSendCode"
              @click="sendLoginCode"
            >
              {{ sendCodeLabel }}
            </button>
          </div>

          <template v-if="codeWasSent">
            <label for="afdian-code">短信验证码</label>
            <input
              id="afdian-code"
              v-model="code"
              class="code-input"
              inputmode="numeric"
              maxlength="8"
              autocomplete="one-time-code"
              placeholder="请输入短信验证码"
              :disabled="state.stage === 'logging-in'"
            />
            <button
              class="primary-button"
              type="submit"
              :disabled="state.stage === 'logging-in' || !/^\d{4,8}$/.test(code)"
            >
              <span
                v-if="state.stage === 'logging-in'"
                class="button-spinner"
                aria-hidden="true"
              ></span>
              {{ state.stage === 'logging-in' ? '正在验证…' : '验证并继续支付' }}
            </button>
          </template>
        </form>

        <p class="login-message">{{ state.message }}</p>
        <button class="login-fallback" type="button" @click="openOriginal">
          无法接收验证码？打开爱发电原页面
        </button>
      </section>

      <template v-else-if="state.stage === 'ready' || state.stage === 'error'">
        <section class="method-section">
          <div class="section-title">
            <h2>选择支付方式</h2>
            <span>可随时切换</span>
          </div>
          <div class="method-grid">
            <button
              type="button"
              class="method-card wechat"
              :class="{ selected: state.method === 'wechat' }"
              @click="selectMethod('wechat')"
            >
              <span class="method-icon">
                <svg viewBox="0 0 1024 1024" aria-hidden="true">
                  <path
                    d="M395.846 603.585c-3.921 1.98-7.936 2.925-12.81 2.925-10.9 0-19.791-5.85-24.764-14.625l-2.006-3.864-78.106-167.913c-.956-1.98-.956-3.865-.956-5.845 0-7.83 5.928-13.68 13.863-13.68 2.965 0 5.928.944 8.893 2.924l91.965 64.43c6.884 3.864 14.82 6.79 23.708 6.79 4.972 0 9.85-.945 14.822-2.926L861.71 282.479c-77.149-89.804-204.684-148.384-349.135-148.384-235.371 0-427.242 157.158-427.242 351.294 0 105.368 57.361 201.017 147.323 265.447 6.88 4.905 11.852 13.68 11.852 22.45 0 2.925-.957 5.85-2.006 8.775-6.881 26.318-18.831 69.334-18.831 71.223-.958 2.92-2.013 6.79-2.013 10.75 0 7.83 5.929 13.68 13.865 13.68 2.963 0 5.928-.944 7.935-2.925l92.922-53.674c6.885-3.87 14.82-6.794 22.756-6.794 3.916 0 8.889.944 12.81 1.98 43.496 12.644 91.012 19.53 139.48 19.53 235.372 0 427.24-157.158 427.24-351.294 0-58.58-17.78-114.143-48.467-163.003l-491.39 280.07-2.963 1.98z"
                  />
                </svg>
              </span>
              <span><b>微信支付</b><small>推荐使用</small></span>
              <i class="selection-mark"></i>
            </button>

            <button
              type="button"
              class="method-card alipay"
              :class="{ selected: state.method === 'alipay' }"
              @click="selectMethod('alipay')"
            >
              <span class="method-icon">
                <svg viewBox="0 0 1024 1024" aria-hidden="true">
                  <path
                    d="M902.095 652.871l-250.96-84.392s19.287-28.87 39.874-85.472c20.59-56.606 23.539-87.689 23.539-87.689l-162.454-1.339v-55.487l196.739-1.387v-39.227H552.055v-89.29h-96.358v89.294H272.133v39.227l183.564-1.304v59.513h-147.24v31.079h303.064s-3.337 25.223-14.955 56.606c-11.615 31.38-23.58 58.862-23.58 58.862s-142.3-49.804-217.285-49.804c-74.985 0-166.182 30.123-175.024 117.55-8.8 87.383 42.481 134.716 114.728 152.139 72.256 17.513 138.962-.173 197.04-28.607 58.087-28.391 115.081-92.933 115.081-92.933l292.486 142.041c-11.932 69.3-72.067 119.914-142.387 119.844H266.37c-79.714.078-144.392-64.483-144.466-144.194V266.374c-.074-79.72 64.493-144.399 144.205-144.47h491.519c79.714-.073 144.396 64.49 144.466 144.203v386.764zM536.335 603.976s-91.302 115.262-198.879 115.262c-107.623 0-130.218-54.767-130.218-94.155 0-39.34 22.373-82.144 113.943-88.333 91.519-6.18 215.2 67.226 215.2 67.226h-.047z"
                  />
                </svg>
              </span>
              <span><b>支付宝</b><small>扫码或客户端支付</small></span>
              <i class="selection-mark"></i>
            </button>
          </div>
        </section>

        <div v-if="state.stage === 'error'" class="error-message">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v6m0 4h.01" />
          </svg>
          <span>{{ state.message }}</span>
        </div>

        <button class="primary-button pay-button" type="button" @click="submit">
          使用{{ state.method === 'wechat' ? '微信' : '支付宝' }}支付 ¥{{ state.amount }}
        </button>
      </template>

      <section v-else-if="state.stage === 'submitting'" class="status-panel">
        <div class="loading-orbit" aria-hidden="true"><i></i><i></i><i></i></div>
        <h2>正在获取支付二维码</h2>
        <p>{{ state.message }}</p>
      </section>

      <section v-else-if="state.stage === 'qr-ready'" class="qr-section">
        <div class="qr-heading">
          <span class="method-dot" :class="state.method"></span>
          <div>
            <h2>请使用{{ state.method === 'wechat' ? '微信' : '支付宝' }}扫码</h2>
            <p>支付完成后本窗口会自动关闭</p>
          </div>
        </div>
        <div class="qr-frame">
          <img v-if="state.qrDataUrl" :src="state.qrDataUrl" alt="支付二维码" />
        </div>
        <div class="qr-amount">
          需支付 <strong>¥{{ state.amount }}</strong>
        </div>
      </section>

      <footer class="payment-footer">
        <button type="button" class="link-button" @click="openOriginal">
          登录或支付遇到问题？打开爱发电原页面
        </button>
        <p>支付过程由爱发电处理，MaheTools 不会读取你的支付账号或密码</p>
      </footer>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import logo from '../../assets/logo.png'
import type { AfdianPaymentMethod, AfdianPaymentWindowState } from '@shared/afdianPaymentWindow'

const state = ref<AfdianPaymentWindowState>({
  title: 'MaheTools 支付',
  productName: '赞助 MaheTools',
  amount: '',
  method: 'wechat',
  stage: 'loading',
  message: '正在连接爱发电…'
})

let removeStateListener: (() => void) | undefined

const phone = ref('')
const code = ref('')
const isLoginStage = computed(() =>
  ['login-required', 'sending-code', 'code-sent', 'logging-in'].includes(state.value.stage)
)
const codeWasSent = computed(() => ['code-sent', 'logging-in'].includes(state.value.stage))
const loginBusy = computed(() => ['sending-code', 'logging-in'].includes(state.value.stage))
const canSendCode = computed(
  () =>
    /^1\d{10}$/.test(phone.value.trim()) &&
    !loginBusy.value &&
    (!codeWasSent.value || !state.value.resendSeconds)
)
const sendCodeLabel = computed(() => {
  if (state.value.stage === 'sending-code') return '发送中…'
  if (state.value.resendSeconds && state.value.resendSeconds > 0) {
    return `${state.value.resendSeconds}s 后重试`
  }
  return codeWasSent.value ? '重新发送' : '发送验证码'
})

/**
 * 请求主进程在隐藏爱发电页面发送短信验证码。
 * @returns 无返回值。
 */
function sendLoginCode(): void {
  code.value = ''
  window.afdianPayment.sendLoginCode(phone.value.trim())
}

/**
 * 请求主进程在隐藏爱发电页面提交短信验证码。
 * @returns 无返回值。
 */
function submitLogin(): void {
  window.afdianPayment.submitLoginCode(phone.value.trim(), code.value.trim())
}

/**
 * 切换支付方式，并通知隐藏的爱发电收银台保持一致。
 * @param method 微信或支付宝。
 * @returns 无返回值。
 */
function selectMethod(method: AfdianPaymentMethod): void {
  state.value = { ...state.value, method }
  window.afdianPayment.selectMethod(method)
}

/**
 * 请求真实收银台提交支付并等待二维码。
 * @returns 无返回值。
 */
function submit(): void {
  window.afdianPayment.submit()
}

/**
 * 显示真实爱发电页面作为登录和故障降级入口。
 * @returns 无返回值。
 */
function openOriginal(): void {
  window.afdianPayment.openOriginal()
}

/**
 * 关闭无边框支付窗口及其隐藏的爱发电页面。
 * @returns 无返回值。
 */
function closeWindow(): void {
  window.afdianPayment.close()
}

onMounted(() => {
  if (!window.afdianPayment) {
    state.value = {
      ...state.value,
      stage: 'error',
      message: '支付窗口通信初始化失败，请关闭后重试'
    }
    return
  }
  removeStateListener = window.afdianPayment.onState((nextState) => {
    state.value = nextState
    if (!phone.value && nextState.phone) phone.value = nextState.phone
  })
})

onBeforeUnmount(() => removeStateListener?.())
</script>

<style scoped>
:global(*) {
  box-sizing: border-box;
}

:global(html),
:global(body),
:global(#afdian-payment-app) {
  width: 100%;
  min-height: 100%;
  margin: 0;
}

:global(body) {
  overflow: auto;
  color: #17201c;
  background: #fff;
  font-family:
    Inter,
    ui-sans-serif,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    'PingFang SC',
    sans-serif;
}

button {
  font: inherit;
}

.payment-shell {
  position: relative;
  min-height: 100vh;
  background: #fff;
}

.payment-card {
  width: 100%;
  min-height: calc(100vh - 34px);
  padding: 4px 32px 22px;
  background: #fff;
  -webkit-app-region: no-drag;
}

.window-toolbar {
  display: flex;
  width: 100%;
  height: 34px;
  align-items: center;
  justify-content: flex-end;
  padding-right: 7px;
  user-select: none;
  -webkit-app-region: drag;
}

.window-close {
  display: grid;
  width: 26px;
  height: 26px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 50%;
  color: rgba(23, 32, 28, 0.58);
  background: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  opacity: 0.72;
  -webkit-app-region: no-drag;
  transition:
    color 0.16s ease,
    background 0.16s ease,
    opacity 0.16s ease;
}

.window-close:hover {
  color: #17201c;
  background: rgba(255, 255, 255, 0.96);
  opacity: 1;
}

.window-close:focus-visible {
  outline: 2px solid rgba(29, 142, 85, 0.45);
  outline-offset: 2px;
}

.window-close svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
}

.brand-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-mark {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 14px;
  background: #17201c;
}

.brand-mark img {
  width: 27px;
  height: 27px;
  object-fit: contain;
}

.brand-copy {
  min-width: 0;
  flex: 1;
}

.eyebrow {
  margin-bottom: 3px;
  color: #7b8881;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.brand-copy h1 {
  overflow: hidden;
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.afdian-badge {
  padding: 6px 9px;
  border-radius: 999px;
  color: #7256a8;
  background: rgba(132, 95, 191, 0.1);
  font-size: 11px;
  font-weight: 600;
}

.amount-panel {
  margin-top: 18px;
  padding: 16px 18px;
  border-radius: 16px;
  background: #17201c;
  color: white;
}

.amount-panel span {
  color: rgba(255, 255, 255, 0.65);
  font-size: 13px;
}

.amount-panel strong {
  display: block;
  margin: 6px 0 4px;
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
}

.amount-panel strong small {
  margin-right: 5px;
  font-size: 18px;
}

.amount-panel p {
  margin: 0;
  color: rgba(255, 255, 255, 0.52);
  font-size: 12px;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 18px 2px 10px;
}

.section-title h2,
.status-panel h2,
.qr-heading h2 {
  margin: 0;
  font-size: 16px;
}

.section-title span {
  color: #87938d;
  font-size: 12px;
}

.method-grid {
  display: grid;
  gap: 8px;
}

.method-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 11px 12px;
  border: 1px solid rgba(27, 56, 42, 0.11);
  border-radius: 14px;
  color: #26312c;
  background: white;
  text-align: left;
  cursor: pointer;
  transition: 0.18s ease;
}

.method-card:hover {
  background: rgba(70, 78, 74, 0.035);
}

.method-card.selected.wechat {
  border-color: rgba(7, 193, 96, 0.7);
  background: rgba(7, 193, 96, 0.055);
  box-shadow: 0 0 0 2px rgba(7, 193, 96, 0.08);
}

.method-card.selected.alipay {
  border-color: rgba(22, 119, 255, 0.65);
  background: rgba(22, 119, 255, 0.055);
  box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.07);
}

.method-icon {
  display: grid;
  width: 34px;
  height: 34px;
  flex: none;
  place-items: center;
  border-radius: 12px;
}

.wechat .method-icon {
  color: #07c160;
  background: rgba(7, 193, 96, 0.1);
}

.alipay .method-icon {
  color: #1677ff;
  background: rgba(22, 119, 255, 0.1);
}

.method-icon svg {
  width: 21px;
  height: 21px;
  fill: currentColor;
  stroke: none;
}

.method-card > span:nth-child(2) {
  display: grid;
  gap: 2px;
}

.method-card b {
  font-size: 15px;
}

.method-card small {
  color: #8a9690;
  font-size: 11px;
}

.selection-mark {
  width: 18px;
  height: 18px;
  margin-left: auto;
  border: 1.5px solid #cbd2ce;
  border-radius: 50%;
}

.method-card.selected .selection-mark {
  border: 5px solid currentColor;
}

.method-card.selected.wechat {
  color: #078b49;
}

.method-card.selected.alipay {
  color: #166ed8;
}

.primary-button {
  width: 100%;
  min-height: 44px;
  border: 0;
  border-radius: 14px;
  color: white;
  background: #17201c;
  font-weight: 650;
  cursor: pointer;
  box-shadow: 0 10px 24px rgba(23, 32, 28, 0.16);
}

.primary-button:hover {
  background: #26352e;
}

.pay-button {
  margin-top: 14px;
}

.status-panel {
  display: flex;
  min-height: 210px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px 10px 8px;
  text-align: center;
}

.status-panel p,
.qr-heading p {
  margin: 8px 0 20px;
  color: #849089;
  font-size: 13px;
}

.loading-orbit {
  position: relative;
  width: 54px;
  height: 54px;
  margin-bottom: 16px;
  animation: spin 1.8s linear infinite;
}

.loading-orbit::before {
  position: absolute;
  inset: 9px;
  border: 1px solid rgba(23, 32, 28, 0.1);
  border-radius: 50%;
  content: '';
}

.loading-orbit i {
  position: absolute;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #07c160;
}

.loading-orbit i:nth-child(1) {
  top: 3px;
  left: 21px;
}

.loading-orbit i:nth-child(2) {
  right: 6px;
  bottom: 10px;
  background: #1677ff;
}

.loading-orbit i:nth-child(3) {
  bottom: 10px;
  left: 6px;
  background: #8766bd;
}

.status-icon {
  display: grid;
  width: 62px;
  height: 62px;
  margin-bottom: 18px;
  place-items: center;
  border-radius: 20px;
  color: #7256a8;
  background: rgba(132, 95, 191, 0.1);
}

.status-icon svg {
  width: 30px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
}

.login-section {
  padding-top: 18px;
}

.login-heading {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}

.login-heading .status-icon {
  width: 52px;
  height: 52px;
  margin: 0;
  border-radius: 16px;
}

.login-heading .status-icon svg {
  width: 25px;
}

.login-heading h2 {
  margin: 0 0 5px;
  font-size: 17px;
}

.login-heading p,
.login-message {
  margin: 0;
  color: #849089;
  font-size: 12px;
  line-height: 1.55;
}

.login-form {
  display: grid;
  gap: 10px;
}

.login-form label {
  color: #4f5d56;
  font-size: 12px;
  font-weight: 650;
}

.phone-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 112px;
  gap: 10px;
  margin-bottom: 4px;
}

.login-form input {
  width: 100%;
  height: 44px;
  padding: 0 13px;
  border: 1px solid rgba(27, 56, 42, 0.13);
  border-radius: 12px;
  outline: none;
  color: #17201c;
  background: white;
  font: inherit;
  font-size: 14px;
  transition: 0.18s ease;
}

.login-form input:focus {
  border-color: rgba(29, 142, 85, 0.68);
  box-shadow: 0 0 0 3px rgba(29, 142, 85, 0.09);
}

.login-form input:disabled {
  color: #7f8984;
  background: rgba(70, 78, 74, 0.035);
}

.code-button {
  border: 1px solid rgba(29, 142, 85, 0.18);
  border-radius: 12px;
  color: #14824d;
  background: rgba(29, 142, 85, 0.07);
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
}

.code-button:disabled,
.primary-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.code-input {
  margin-bottom: 4px;
  letter-spacing: 0.16em;
}

.button-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  margin-right: 7px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: white;
  border-radius: 50%;
  vertical-align: -2px;
  animation: spin 0.8s linear infinite;
}

.login-message {
  min-height: 19px;
  margin-top: 12px;
  text-align: center;
}

.login-fallback {
  display: block;
  margin: 6px auto 0;
  border: 0;
  color: #738078;
  background: transparent;
  font-size: 12px;
  cursor: pointer;
}

.login-fallback:hover {
  color: #17201c;
}

.error-message {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 10px;
  color: #a7473d;
  background: rgba(205, 71, 57, 0.08);
  font-size: 12px;
}

.error-message svg {
  width: 17px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
}

.qr-section {
  padding-top: 16px;
}

.qr-heading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: left;
}

.qr-heading p {
  margin-bottom: 0;
}

.method-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.method-dot.wechat {
  background: #07c160;
}

.method-dot.alipay {
  background: #1677ff;
}

.qr-frame {
  display: grid;
  width: 210px;
  height: 210px;
  margin: 16px auto 10px;
  place-items: center;
  border: 1px solid rgba(27, 56, 42, 0.1);
  border-radius: 20px;
  background: white;
  box-shadow: 0 14px 36px rgba(34, 68, 51, 0.1);
}

.qr-frame img {
  width: 184px;
  height: 184px;
  object-fit: contain;
}

.qr-amount {
  color: #849089;
  text-align: center;
  font-size: 13px;
}

.qr-amount strong {
  margin-left: 4px;
  color: #17201c;
  font-size: 17px;
}

.payment-footer {
  margin-top: 16px;
  text-align: center;
}

.link-button {
  padding: 4px;
  border: 0;
  color: #68756e;
  background: transparent;
  font-size: 12px;
  cursor: pointer;
}

.link-button:hover {
  color: #17201c;
}

.payment-footer p {
  margin: 7px 0 0;
  color: #a1aaa5;
  font-size: 10px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-color-scheme: dark) {
  :global(body) {
    color: #edf3ef;
    background: #1f2622;
  }

  .payment-shell {
    background: #1f2622;
  }

  .payment-card {
    background: #1f2622;
  }

  .window-close {
    color: rgba(237, 243, 239, 0.65);
    background: rgba(31, 38, 34, 0.76);
  }

  .window-close:hover {
    color: #edf3ef;
    background: rgba(46, 56, 50, 0.96);
  }

  .brand-copy h1,
  .section-title h2,
  .status-panel h2,
  .qr-heading h2,
  .qr-amount strong {
    color: #edf3ef;
  }

  .method-card,
  .qr-frame {
    border-color: rgba(255, 255, 255, 0.09);
    background: rgba(255, 255, 255, 0.035);
  }

  .method-card {
    color: #dbe5df;
  }

  .method-card:hover {
    background: rgba(255, 255, 255, 0.06);
  }
}
</style>
