/**
 * 外部应用的启动：先请 Host，再用启动项自己的协议地址兜底。
 *
 * 启动栏只是一个 48px 的启动器，它不持有业务页面，也不持有 MCP 进程。内部面板的
 * 开/收是纯粹的请求派发，留在 `service.ts` 里；这里只剩真正要出进程的那一半 ——
 * 外部应用的启动。
 *
 * 两条路都在这里，不在组件里：组件只报告「点了谁」，不拼 `fetch`，也不做协议兜底。
 * 启动栏没有会话上下文，因此工作区目录由装配点通过 {@link ExternalLaunchPorts}
 * 提供；拿不到目录时**不发** `open-in-app/open`（Host 要求真实存在的绝对目录，
 * 编一个必然 404），直接走启动项自己的 `launchUrl`。
 */
import { OPEN_IN_APP_OPEN_ROUTE, type OpenInAppOpenPayload } from '@deepseek-ai/dsh-host-open-in-app/shared'
import type { ExternalAppItem } from '../contract/taskbar.ts'

/**
 * 外部应用侧端口：由装配点实现。
 *
 * `resolveWorkspaceDir` 是装配点给的只读探针，返回当前会话的绝对工作区目录，
 * 拿不到时返回 undefined —— 启动栏自身没有会话上下文，不猜路径。
 */
export interface ExternalLaunchPorts {
  /** @returns 当前会话的绝对工作区目录，或 undefined 表示无目录可交给 Host。 */
  readonly resolveWorkspaceDir: () => string | undefined
  /** @param id - 启动项 id。 @param failed - true 记为失败，false 复位为可用。 */
  readonly setItemAvailability: (id: string, failed: boolean) => void
}

/**
 * 把启动项交给系统协议处理器（`microsoft-edge:`、`orpheus://` 之类）。
 *
 * 浏览器无法得知自定义协议是否真的被接管：`window.open` 返回 null 既可能是
 * 被弹窗策略拦截，也可能是协议处理器正常接手。因此这里只负责发出请求，
 * 不谎称成功，也不据此判失败。
 * @param launchUrl - 启动项的 `launchUrl`。
 * @returns 是否发出了请求（无 `window` 时为 false）。
 */
function openProtocol(launchUrl: string): boolean {
  if (typeof window === 'undefined') return false
  window.open(launchUrl, '_self')
  return true
}

/**
 * 点击一个外部应用图标：有工作区目录就先请 Host 启动，否则或失败后走协议兜底。
 *
 * 判定失败的唯一可靠信号是 Host 明确拒绝（非 2xx）且启动项没有 `launchUrl`。
 * 协议兜底只表示「已交给浏览器」，因此不记成 `failed`；成功则把 `failed` 复位。
 * @param item - 被点击的外部应用启动项。
 * @param ports - 外部应用侧端口。
 * @returns 启动请求的去向，供调用方记录可用性。
 */
export async function launchExternalApp(
  item: ExternalAppItem,
  ports: ExternalLaunchPorts,
): Promise<'host' | 'protocol' | 'failed'> {
  if (item.protocolOnly) {
    if (item.launchUrl !== undefined && openProtocol(item.launchUrl)) {
      ports.setItemAvailability(item.id, false)
      return 'protocol'
    }
    ports.setItemAvailability(item.id, true)
    return 'failed'
  }

  const appId = item.appId ?? item.id
  const directory = ports.resolveWorkspaceDir()

  if (directory !== undefined) {
    const body: OpenInAppOpenPayload = { app: appId, path: directory }
    try {
      const response = await fetch(OPEN_IN_APP_OPEN_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (response.ok) {
        ports.setItemAvailability(item.id, false)
        return 'host'
      }
    } catch {
      // Host 不可达：落到下面的协议兜底。
    }
  }

  if (item.launchUrl !== undefined && openProtocol(item.launchUrl)) {
    ports.setItemAvailability(item.id, false)
    return 'protocol'
  }

  ports.setItemAvailability(item.id, true)
  return 'failed'
}
