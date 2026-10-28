/**
 * MaheTools 品牌图标生成脚本。
 * 使用 Electron 离屏渲染将 scripts/brand 下的 SVG 源文件栅格化为各尺寸 PNG，
 * 并组装 Windows ICO / macOS ICNS 容器，覆盖仓库内全部品牌图标资产。
 * 运行方式：./node_modules/.bin/electron scripts/brand/generate-icons.mjs
 */
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const brandDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(brandDir, '../..')

/**
 * 组装多尺寸 PNG-in-ICO 容器（Windows Vista+ 支持 PNG 载荷）。
 * @param entries 图标条目数组，每项包含尺寸与 PNG Buffer。
 * @returns 完整的 .ico 文件 Buffer。
 */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // 保留位
  header.writeUInt16LE(1, 2) // 类型：图标
  header.writeUInt16LE(entries.length, 4)

  let offset = 6 + 16 * entries.length
  const dirEntries = []
  const payloads = []
  for (const entry of entries) {
    const dir = Buffer.alloc(16)
    dir[0] = entry.size >= 256 ? 0 : entry.size
    dir[1] = entry.size >= 256 ? 0 : entry.size
    dir[2] = 0 // 调色板数
    dir[3] = 0 // 保留
    dir.writeUInt16LE(1, 4) // 平面数
    dir.writeUInt16LE(32, 6) // 位深
    dir.writeUInt32LE(entry.png.length, 8)
    dir.writeUInt32LE(offset, 12)
    dirEntries.push(dir)
    payloads.push(entry.png)
    offset += entry.png.length
  }
  return Buffer.concat([header, ...dirEntries, ...payloads])
}

/**
 * 组装 PNG-in-ICNS 容器（macOS 10.7+ 支持 PNG 载荷）。
 * @param entries 图标条目数组，每项包含 OSType 与 PNG Buffer。
 * @returns 完整的 .icns 文件 Buffer。
 */
function buildIcns(entries) {
  const chunks = entries.map((entry) => {
    const head = Buffer.alloc(8)
    head.write(entry.type, 0, 'ascii')
    head.writeUInt32BE(8 + entry.png.length, 4)
    return Buffer.concat([head, entry.png])
  })
  const total = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(total, 4)
  return Buffer.concat([head, ...chunks])
}

/**
 * 将 Buffer 写入项目相对路径的目标文件。
 * @param relPath 相对项目根目录的目标路径。
 * @param buffer 要写入的内容。
 * @returns 无返回值。
 */
function writeAsset(relPath, buffer) {
  const target = path.join(projectRoot, relPath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, buffer)
  console.log(`[icons] 写入 ${relPath} (${buffer.length} bytes)`)
}

/**
 * 读取品牌 SVG 源文件文本。
 * @param name 不含扩展名的源文件名。
 * @returns SVG 文本内容。
 */
function readSvg(name) {
  return fs.readFileSync(path.join(brandDir, `${name}.svg`), 'utf8')
}

/** 复用的渲染窗口；隐藏窗口加载 about:blank 后通过页面内 Canvas 完成栅格化。 */
let sharedWindow = null

/**
 * 获取（或懒创建）隐藏渲染窗口，页面仅作为 Canvas 光栅化执行环境。
 * @returns 就绪的 BrowserWindow 实例。
 */
function getRenderWindow() {
  if (!sharedWindow || sharedWindow.isDestroyed()) {
    sharedWindow = new BrowserWindow({
      show: false,
      width: 64,
      height: 64,
      webPreferences: { offscreen: true, backgroundThrottling: false, nodeIntegration: false }
    })
  }
  return sharedWindow
}

/**
 * 在隐藏页面内用 Canvas 将 SVG 栅格化为指定尺寸的 PNG Buffer。
 * 不依赖窗口绘制（capturePage），避免隐藏/离屏窗口在部分平台不产生帧的问题。
 * @param svg SVG 源码文本。
 * @param size 目标边长（正方形，单位像素）。
 * @returns 渲染完成的 PNG Buffer；加载或栅格化失败时抛错。
 */
async function renderSvgToPng(svg, size) {
  const win = getRenderWindow()
  if (win.webContents.getURL() !== 'about:blank') {
    await win.loadURL('about:blank')
  }

  // Chromium 要求 SVG 带显式宽高才能可靠 drawImage，此处注入目标尺寸
  const sizedSvg = svg.replace(/<svg([^>]*)>/, `<svg$1 width="${size}" height="${size}">`)
  const dataUrl = await win.webContents.executeJavaScript(`
    (async () => {
      const svg = ${JSON.stringify(sizedSvg)}
      const size = ${size}
      const img = new Image()
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, size, size)
      return canvas.toDataURL('image/png')
    })()
  `)
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error(`尺寸 ${size} 栅格化失败：页面未返回 PNG DataURL`)
  }
  return Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
}

/**
 * 生成一套指定 SVG 的多尺寸 PNG。
 * @param svg SVG 源码文本。
 * @param sizes 需要的边长列表。
 * @returns 尺寸到 PNG Buffer 的映射。
 */
async function renderSizes(svg, sizes) {
  const result = new Map()
  for (const size of sizes) {
    result.set(size, await renderSvgToPng(svg, size))
  }
  return result
}

/**
 * 校验 PNG 尺寸与透明通道是否符合预期。
 * @param png PNG Buffer。
 * @param expected 期望边长。
 * @returns 校验通过返回 true；尺寸不符时返回 false。
 */
function verifyPngSize(png, expected) {
  // IHDR 位于固定偏移：宽 16..20、高 20..24（大端）
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  return width === expected && height === expected
}

/**
 * 主流程：渲染全部源文件并输出品牌资产。
 * @returns 操作完成后结束的 Promise。
 */
async function main() {
  const iconSvg = readSvg('icon')
  const traySvg = readSvg('tray-template')
  const trayLightSvg = readSvg('tray-light')

  // 应用图标：一次渲染覆盖 ICO/ICNS/PNG/Logo 全部尺寸
  const iconSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
  const icons = await renderSizes(iconSvg, iconSizes)
  for (const [size, png] of icons) {
    if (!verifyPngSize(png, size)) throw new Error(`应用图标尺寸校验失败: ${size}`)
  }

  // Windows ICO：常用尺寸全集（256 用 0 表示）
  writeAsset(
    'build/icon.ico',
    buildIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: icons.get(size) })))
  )

  // macOS ICNS：现代 OSType 与小尺寸补充类型
  const icnsTypes = [
    { size: 16, type: 'icp4' },
    { size: 32, type: 'icp5' },
    { size: 64, type: 'icp6' },
    { size: 128, type: 'ic07' },
    { size: 256, type: 'ic08' },
    { size: 512, type: 'ic09' },
    { size: 1024, type: 'ic10' }
  ]
  writeAsset(
    'build/icon.icns',
    buildIcns(icnsTypes.map((t) => ({ type: t.type, png: icons.get(t.size) })))
  )

  // 通用 PNG 与各处 Logo
  writeAsset('build/icon.png', icons.get(1024))
  writeAsset('resources/icons/icon.png', icons.get(512))
  writeAsset('resources/icons/icon-ztools.png', icons.get(1024))
  writeAsset('resources/icons/windows-icon.png', icons.get(32))
  writeAsset('src/renderer/src/assets/logo.png', icons.get(1024))
  writeAsset('internal-plugins/setting/public/logo.png', icons.get(128))

  // 托盘模板图标（黑色字形 + 浅色变体，32px @2x）
  const tray = (await renderSizes(traySvg, [32])).get(32)
  const trayLight = (await renderSizes(trayLightSvg, [32])).get(32)
  if (!verifyPngSize(tray, 32) || !verifyPngSize(trayLight, 32)) {
    throw new Error('托盘图标尺寸校验失败')
  }
  writeAsset('resources/icons/trayTemplate@2x.png', tray)
  writeAsset('resources/icons/trayTemplate@2x-light.png', trayLight)

  // 默认头像（搜索框按钮 / 超级面板），圆形品牌底 + 白色 M 字形
  const avatarSvg = readSvg('avatar')
  const avatar = (await renderSizes(avatarSvg, [128])).get(128)
  if (!verifyPngSize(avatar, 128)) throw new Error('默认头像尺寸校验失败')
  writeAsset('src/renderer/src/assets/image/default.png', avatar)
  writeAsset('internal-plugins/setting/src/assets/image/default.png', avatar)

  console.log('[icons] 全部品牌图标生成完成')
  app.quit()
}

process.on('uncaughtException', (error) => {
  console.error('[icons] 生成失败:', error)
  app.exit(1)
})

app.whenReady().then(main)
