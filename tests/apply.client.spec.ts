/**
 * 装配：`ctx.taskbar`、浮层里的那一列、以及通往主面板的桥 —— 还有「fiber 一停就全没」。
 *
 * 插槽注册表是真的（拆不干净的席位正是这份 spec 存在的理由），布局面是记录器
 * （这里关心的是桥选了哪个面板、镜像回了什么），文案与两个会话面同理。
 *
 * 外部启动走的是真的 `launchExternalApp`，因此这里同时钉住装配点交给它的两件事：
 * 当前会话的工作区目录，以及失败要写回哪一条启动项。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { OPEN_IN_APP_OPEN_ROUTE } from '@deepseek-ai/dsh-host-open-in-app/shared'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'
import type { TaskbarDockInjected } from '../src/client/shell/TaskbarDock.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { ExternalAppItem, InternalAppItem } from '../src/client/contract/taskbar.ts'

const SESSION = 's-test' as SessionId

const MUSIC: InternalAppItem = {
  id: 'netease-music',
  label: '网易云音乐',
  kind: 'internal',
  panelId: 'netease-music',
}

const GHOST: InternalAppItem = {
  id: 'ghost',
  label: '未注册的面板',
  kind: 'internal',
  panelId: 'ghost',
}

const EDGE: ExternalAppItem = {
  id: 'edge',
  label: 'Microsoft Edge',
  kind: 'external',
  appId: 'edge',
  executablePath: 'msedge.exe',
  launchUrl: 'microsoft-edge:newtab',
}

/** 布局有页面的面板；`selectPanel` 对别的 id 抛错，与真的一致。 */
const registered = new Set<string>([MUSIC.panelId])

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * 在一个声明了浮层列表的真实插槽树上启动浏览器半边。
 * @returns 上下文、fiber、以及布局面记录下来的面板选择。
 */
async function bench(): Promise<{
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  selected: (string | null)[]
  dictionaries: Map<string, unknown>
  current: ReturnType<typeof createSnapshotStore<{ key: SessionId | undefined }>>
}> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'shell.overlay': { kind: 'list', scope: 'root' } },
  } as never, () => null)

  const listeners = new Set<() => void>()
  let activePanelId: string | null = null
  const selected: (string | null)[] = []
  ctx.provide('layout', {
    panelInfo: {
      getSnapshot: () => ({ activePanelId }),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    selectPanel: (panelId: string | null) => {
      if (panelId !== null && !registered.has(panelId)) {
        throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`)
      }
      activePanelId = panelId
      selected.push(panelId)
      for (const listener of listeners) listener()
    },
  } as never)

  const dictionaries = new Map<string, unknown>()
  ctx.provide('locale', {
    // 文案是字典的契约；键本身就当译文用。
    bind: vi.fn(() => (key: string) => key),
    register: vi.fn((namespace: string, dicts: unknown) => {
      dictionaries.set(namespace, dicts)
      return () => { dictionaries.delete(namespace) }
    }),
  } as never)

  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ byId: { [SESSION]: { cwd: '/work/project' } } }) },
  } as never)
  const current = createSnapshotStore<{ key: SessionId | undefined }>({ key: undefined })
  ctx.provide('uiSession', { adapter: { current } } as never)

  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, selected, dictionaries, current }
}

/** 浮层席位里当前登记的行 id。 */
function overlayIds(ctx: Context): (string | undefined)[] {
  return ctx.slots.entries('shell.overlay').map(entry => entry.options.id)
}

/** 取浮层席位里那一行交出去的注入面。 */
function dockInjected(ctx: Context): TaskbarDockInjected {
  const entry = ctx.slots.entries('shell.overlay').find(candidate => candidate.options.id === 'ui-sidebar-app.taskbar-dock')
  if (entry?.inject === undefined) throw new Error('expected the dock row to inject')
  return entry.inject() as unknown as TaskbarDockInjected
}

describe('ui-sidebar-app browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'layout', 'locale', 'sessions', 'uiSession'])
  })

  it('provides the taskbar face over the shipped launchers', async () => {
    const { ctx } = await bench()
    const state = ctx.taskbar.getState()
    // 这一条测试环境里没有 `navigator`，平台探测答 windows，两条出厂启动项都留下。
    expect(state.items.map(item => item.id)).toEqual(['edge', 'netease-music'])
    expect(state.activePanelId).toBeNull()
    expect(state.visible).toBe(true)
  })

  it('mounts the dock in the overlay seat with its dictionary and injected faces', async () => {
    const { ctx, dictionaries } = await bench()
    const entry = ctx.slots.entries('shell.overlay').find(candidate => candidate.options.id === 'ui-sidebar-app.taskbar-dock')
    expect(entry?.locale).toBe('sidebarApp')
    expect(dictionaries.get('sidebarApp')).toEqual({ zh, en })

    const injected = dockInjected(ctx)
    expect(Object.keys(injected.hooks).sort()).toEqual(['rightbarCollapsed', 'taskbar'])
    // 两个 observable 都是装配点造的：状态与折叠事实各一份。
    expect(injected.hooks.taskbar.getSnapshot()).toBe(ctx.taskbar.getState())
    expect(typeof injected.hooks.rightbarCollapsed.getSnapshot()).toBe('boolean')
  })

  it('selects the clicked panel and lights the icon only once the layout reports it', async () => {
    const { ctx, selected } = await bench()

    ctx.emit('taskbar/open-panel', MUSIC)
    expect(selected).toEqual([MUSIC.panelId])
    expect(ctx.taskbar.getState().activePanelId).toBe(MUSIC.panelId)

    ctx.emit('taskbar/close-panel', MUSIC)
    expect(selected).toEqual([MUSIC.panelId, null])
    expect(ctx.taskbar.getState().activePanelId).toBeNull()
  })

  it('leaves the icon asleep when no page answers the click', async () => {
    const { ctx, selected } = await bench()

    // `selectPanel` 拒绝未注册的 id；桥把它吞掉，因此图标不会指向一个不存在的页面。
    expect(() => { ctx.emit('taskbar/open-panel', GHOST) }).not.toThrow()
    expect(selected).toEqual([])
    expect(ctx.taskbar.getState().activePanelId).toBeNull()
  })

  it('drops the mirror on an outward hide request without announcing the close twice', async () => {
    const { ctx, selected } = await bench()
    ctx.taskbar.setActivePanelId(MUSIC.panelId)

    ctx.emit('taskbar/hide-pannel', MUSIC.panelId)

    expect(ctx.taskbar.getState().activePanelId).toBeNull()
    // 收起请求来自别人：不再向外广播同一次关闭。
    expect(selected).toEqual([])
  })

  it('hands an external click to the Host with the selected Session\'s directory', async () => {
    const { ctx, current } = await bench()
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchSpy)
    current.set({ key: SESSION })

    dockInjected(ctx).activate(EDGE)

    await vi.waitFor(() => { expect(fetchSpy).toHaveBeenCalledOnce() })
    const [route, init] = fetchSpy.mock.calls[0]!
    expect(route).toBe(OPEN_IN_APP_OPEN_ROUTE)
    // 载荷是 `open-in-app/open` 的形状：app 走 `appId`，path 是会话的工作区目录。
    expect(init?.body).toBe(JSON.stringify({ app: 'edge', path: '/work/project' }))
    // Host 接下了：启动项复位成可用态（Host 提取的图标与可用性都归它管）。
    await vi.waitFor(() => {
      expect(ctx.taskbar.getState().items.find(item => item.id === 'edge')?.availability).toBe('available')
    })
  })

  it('marks an external click failed when no directory and no protocol handler answer', async () => {
    const { ctx } = await bench()
    const fetchSpy = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchSpy)

    // 没有选中会话：目录拿不到，不发 `open-in-app/open`；这一条 lane 里也没有 `window`，
    // 协议兜底无处可去，于是记成 failed。
    dockInjected(ctx).activate(EDGE)

    await vi.waitFor(() => {
      expect(ctx.taskbar.getState().items.find(item => item.id === 'edge')?.availability).toBe('failed')
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('removes the row, the dictionaries, and the face with the fiber (HMR safety)', async () => {
    const { ctx, fiber, selected, dictionaries } = await bench()
    expect(overlayIds(ctx)).toContain('ui-sidebar-app.taskbar-dock')

    await fiber.dispose()

    expect(overlayIds(ctx)).not.toContain('ui-sidebar-app.taskbar-dock')
    expect(dictionaries.size).toBe(0)
    expect(ctx.get('taskbar')).toBeUndefined()
    ctx.emit('taskbar/open-panel', MUSIC)
    expect(selected).toEqual([])
  })
})
