/**
 * 外部应用的启动：有工作区目录就先请 Host，Host 拒绝或不可达时用启动项自己的协议地址兜底。
 *
 * 判定失败的唯一可靠信号是「Host 明确拒绝且这一项没有 launchUrl」；协议兜底只表示
 * 「已交给浏览器」，因此不记成 failed。内部面板的开/收不在这里，它只是请求派发
 * （见 `taskbar.client.spec.ts`）。
 */
import { afterEach, expect, it, vi } from 'vitest'
import { OPEN_IN_APP_OPEN_ROUTE } from '@deepseek-ai/dsh-host-open-in-app/shared'
import { launchExternalApp, type ExternalLaunchPorts } from '../src/client/taskbar/launch.ts'
import type { ExternalAppItem } from '../src/client/contract/taskbar.ts'

const EDGE: ExternalAppItem = {
  id: 'edge',
  label: 'Microsoft Edge',
  kind: 'external',
  appId: 'edge',
  executablePath: 'msedge.exe',
  launchUrl: 'microsoft-edge:newtab',
}

/** 同一款应用，但没有浏览器侧兜底：Host 拒绝之后无处可去。 */
const EDGE_BARE: ExternalAppItem = {
  id: 'edge',
  label: 'Microsoft Edge',
  kind: 'external',
  appId: 'edge',
  executablePath: 'msedge.exe',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** 记录可用性写入的端口。 */
function portsOf(directory: string | undefined) {
  const marks: string[] = []
  const ports: ExternalLaunchPorts = {
    resolveWorkspaceDir: () => directory,
    setItemAvailability: (id, failed) => marks.push(`${id}:${failed ? 'failed' : 'available'}`),
  }
  return { marks, ports }
}

/** 用一块内存顶替 `window`，记录协议地址。 */
function stubWindow() {
  const open = vi.fn()
  vi.stubGlobal('window', { open })
  return open
}

it('asks the Host for the workspace before using a launcher protocol', async () => {
  const fetcher = vi.fn(async () => ({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  const open = stubWindow()
  const { marks, ports } = portsOf('/home/me/project')

  await expect(launchExternalApp(EDGE, ports)).resolves.toBe('host')

  expect(fetcher).toHaveBeenCalledWith(OPEN_IN_APP_OPEN_ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app: 'edge', path: '/home/me/project' }),
  })
  expect(open).not.toHaveBeenCalled()
  expect(marks).toEqual(['edge:available'])
})

it('falls back to the launcher protocol when the Host refuses', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
  const open = stubWindow()
  const { marks, ports } = portsOf('/home/me/project')

  await expect(launchExternalApp(EDGE, ports)).resolves.toBe('protocol')

  expect(open).toHaveBeenCalledWith(EDGE.launchUrl, '_self')
  // 协议兜底只说明请求发出去了，不是失败。
  expect(marks).toEqual(['edge:available'])
})

it('does not ask the Host at all without a workspace directory', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const open = stubWindow()
  const { ports } = portsOf(undefined)

  await expect(launchExternalApp(EDGE, ports)).resolves.toBe('protocol')

  expect(fetcher).not.toHaveBeenCalled()
  expect(open).toHaveBeenCalledTimes(1)
})

it('falls back to the protocol when the Host is unreachable', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
  const open = stubWindow()
  const { ports } = portsOf('/home/me/project')

  await expect(launchExternalApp(EDGE, ports)).resolves.toBe('protocol')

  expect(open).toHaveBeenCalledTimes(1)
})

it('records a failure when neither the Host nor a protocol address can answer', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
  stubWindow()
  const { marks, ports } = portsOf('/home/me/project')

  await expect(launchExternalApp(EDGE_BARE, ports)).resolves.toBe('failed')

  expect(marks).toEqual(['edge:failed'])
})

it('records a failure when there is no browser to hand a protocol address to', async () => {
  const { marks, ports } = portsOf(undefined)

  await expect(launchExternalApp(EDGE, ports)).resolves.toBe('failed')

  expect(marks).toEqual(['edge:failed'])
})
