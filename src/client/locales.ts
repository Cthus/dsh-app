/**
 * `sidebarApp` 命名空间的字典。
 *
 * 启动栏几乎不自带文案 —— 一个图标叫什么由它的启动项决定 —— 所以这里只有它自己要说
 * 的几句话：这一列的读屏名称，以及图标为什么长成这样。`zh` 是键集的事实来源，
 * `en` 是语言回退（locale 包只内置这两种语言），因此没有自带字典的语言读英文。
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** 简体中文字典，也是键集的事实来源。 */
export const zh = {
  'dock.label': '应用',
  'wheel.open': '打开应用轮盘',
  'wheel.close': '关闭应用轮盘',
  'item.running': '运行中',
  'item.unsupported': '当前平台不支持',
  'item.failed': '启动失败，点击重试',
} satisfies Record<string, string>

/** 启动栏字典的键集。 */
export type SidebarAppKey = keyof typeof zh

/** 英文字典，按中文字典的键集校验。 */
export const en = {
  'dock.label': 'Apps',
  'wheel.open': 'Open app wheel',
  'wheel.close': 'Close app wheel',
  'item.running': 'Running',
  'item.unsupported': 'Unavailable on this platform',
  'item.failed': 'Failed to launch, click to retry',
} satisfies Record<SidebarAppKey, string>

/** 本包的文案命名空间。 */
export const NS = 'sidebarApp'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 启动栏自身的文案与图标状态说明。 */
    sidebarApp: SidebarAppKey
  }
}
