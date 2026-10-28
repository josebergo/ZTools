import { nativeTheme } from 'electron'
import databaseAPI from '../api/shared/database'

/**
 * 插件页面需要的主题色状态。
 */
export interface PluginThemeState {
  isDark: boolean
  primaryColor: string
  customColor?: string
}

const PRIMARY_COLOR_MAP: Record<'light' | 'dark', Record<string, string>> = {
  light: {
    indigo: '#6366F1',
    blue: '#0284c7',
    purple: '#7c3aed',
    green: '#059669',
    orange: '#ea580c',
    red: '#dc2626',
    pink: '#db2777'
  },
  dark: {
    indigo: '#818CF8',
    blue: '#38bdf8',
    purple: '#a78bfa',
    green: '#34d399',
    orange: '#fb923c',
    red: '#f87171',
    pink: '#f472b6'
  }
}

/**
 * 读取宿主当前主题色状态，供插件页面初始化时使用。
 * @returns 当前主题色名称和自定义颜色。
 */
export function getCurrentPluginThemeState(): PluginThemeState {
  const settings = databaseAPI.dbGet('settings-general')
  return {
    isDark: nativeTheme.shouldUseDarkColors,
    primaryColor: settings?.primaryColor || 'green',
    customColor: settings?.customColor
  }
}

/**
 * 将主题色名称解析为插件页面可直接使用的颜色值。
 * @param themeState 宿主主题色状态。
 * @returns 规范化后的十六进制颜色值。
 */
export function resolvePluginPrimaryColor(themeState: PluginThemeState): string {
  if (themeState.primaryColor === 'custom' && /^#[\da-f]{6}$/i.test(themeState.customColor || '')) {
    return themeState.customColor as string
  }
  const colorMap = PRIMARY_COLOR_MAP[themeState.isDark ? 'dark' : 'light']
  return colorMap[themeState.primaryColor] || colorMap.indigo
}

/**
 * 构建插件页面首次加载时注入的主题 CSS。
 * @param themeState 宿主主题色状态。
 * @returns 设置插件主题色变量的 CSS 文本。
 */
export function buildPluginThemeCSS(themeState: PluginThemeState): string {
  const color = resolvePluginPrimaryColor(themeState)
  return `:root { --plugin-primary-color: ${color} !important; }`
}

/**
 * 构建主题切换时在插件页面执行的 JavaScript。
 * @param themeState 宿主主题色状态。
 * @returns 更新插件主题色变量的 JavaScript 文本。
 */
export function buildPluginThemeScript(themeState: PluginThemeState): string {
  const color = JSON.stringify(resolvePluginPrimaryColor(themeState))
  return `(() => {
    const root = document.documentElement
    if (!root) return
    root.style.setProperty('--plugin-primary-color', ${color}, 'important')
  })()`
}
