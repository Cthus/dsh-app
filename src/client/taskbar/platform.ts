/**
 * 平台探测，以及「哪些启动项该出现、谁在前」这条纯规则。
 *
 * 规则留在这里而不是写进注册表：它一直是这个包对外的判定，注册表只负责把同一个 `id`
 * 上的多条定义归并成一条，再把它交出去过滤和排序。出厂的那张表在 `../apps/index.ts`。
 */
import type { LauncherItem, LauncherPlatform } from '../contract/taskbar.ts'

/**
 * 检测当前系统平台
 */
export function detectPlatform(): LauncherPlatform {
  if (typeof navigator === 'undefined') return 'windows'
  const runtime = navigator as Navigator & { readonly userAgentData?: { readonly platform?: string } }
  const value = `${runtime.userAgentData?.platform ?? ''} ${runtime.userAgent}`
  if (/mac|iphone|ipad|ipod/i.test(value)) return 'macos'
  if (/linux/i.test(value)) return 'linux'
  return 'windows'
}

/**
 * 根据平台过滤并排序启动项：
 * 有明确 order 的优先按权重排序，未指定 order 的保持在后并按配置顺序排列
 * @param items - 待过滤的启动项，通常是在用的定义，按注册顺序。
 * @param platform - 目标平台。
 * @returns 该平台上应展示的启动项，按 order 升序。
 */
export function filterLauncherItems(
  items: readonly LauncherItem[],
  platform: LauncherPlatform,
): readonly LauncherItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.platforms === undefined || item.platforms.includes(platform))
    .sort((a, b) => {
      const orderA = a.item.order ?? (1000 + a.index)
      const orderB = b.item.order ?? (1000 + b.index)
      return orderA - orderB
    })
    .map(({ item }) => item)
}
