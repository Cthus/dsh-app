/**
 * `ctx.taskbar` 的行为：状态、显隐、以及一次点击被翻译成哪个请求。
 *
 * 钉住三件事，每件都是契约：
 * - 点击只发请求，**不**写活动面板 —— 图标只有布局服务确认之后才亮；
 * - 显隐与运行期改写通过快照发布，引用稳定，订阅者不必自己做 diff；
 * - 图标只挂在内部启动项上，外部图标由 Host 从可执行文件里取。
 */
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LauncherRegistry } from '../src/client/app-registry.ts'
import { createTaskbarStore } from '../src/client/stores.ts'
import { TaskbarController } from '../src/client/service.ts'
import { detectPlatform, filterLauncherItems } from '../src/client/taskbar/platform.ts'
import { DEFAULT_LAUNCHER_DEFINITIONS } from '../src/client/apps/index.ts'
import type { ExternalAppItem, InternalAppItem, LauncherDefinition } from '../src/client/contract/taskbar.ts'

const MUSIC: InternalAppItem = {
  id: 'netease-music',
  label: '网易云音乐',
  kind: 'internal',
  panelId: 'netease-music',
}

const EXTERNAL: ExternalAppItem = {
  id: 'example-app',
  label: 'Example app',
  kind: 'external',
  executablePath: 'example-app',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** 启动栏的装配：注册表 + 状态 + 记录请求的端口。 */
function bench(definitions: readonly LauncherDefinition[] = [], platform = detectPlatform()) {
  const registry = new LauncherRegistry(new Context(), platform, filterLauncherItems)
  for (const definition of definitions) registry.register(definition)
  const store = createTaskbarStore().create()
  const calls: string[] = []
  const controller = new TaskbarController(registry, store, {
    openPanel: item => calls.push(`open:${item.panelId}`),
    closePanel: item => calls.push(`close:${item.panelId}`),
    launchExternal: item => calls.push(`launch:${item.id}`),
  })
  return { registry, store, controller, calls }
}

/** 用一块内存顶替 localStorage。 */
function stubLocalStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => { store.set(key, val) },
    removeItem: (key: string) => { store.delete(key) },
  })
  return store
}

it('starts without environment-specific launchers', () => {
  const { controller } = bench(DEFAULT_LAUNCHER_DEFINITIONS)
  expect(controller.getState().items).toEqual([])
  expect(controller.getState().activePanelId).toBeNull()
  expect(controller.getState().visible).toBe(true)
})

it('keeps the snapshot reference until something actually changes', () => {
  const { controller } = bench([{ item: MUSIC }])
  const first = controller.getState()

  expect(controller.getState()).toBe(first)

  controller.setVisible(false)
  const second = controller.getState()
  expect(second).not.toBe(first)
  expect(second.visible).toBe(false)

  // 同值写入早退：没有新快照，订阅者也不会被叫醒。
  controller.setVisible(false)
  expect(controller.getState()).toBe(second)
})

it('does not call the subscriber on subscribe, only on change', () => {
  const { controller } = bench([{ item: MUSIC }])
  // 回调不带参数：订阅者自己读快照。这正是 `ObservableSnapshot` 的形状。
  const seen: (string | null)[] = []

  const unsubscribe = controller.subscribe(() => seen.push(controller.getState().activePanelId))
  expect(seen).toEqual([])

  controller.setActivePanelId(MUSIC.panelId)
  expect(seen).toEqual([MUSIC.panelId])

  unsubscribe()
  controller.setActivePanelId(null)
  expect(seen).toEqual([MUSIC.panelId])
})

it('dispatches open then close on click, never guessing the result', () => {
  const { controller, calls } = bench([{ item: MUSIC }])

  // 第一次点击：只广播打开，图标保持 sleep 直到布局服务确认。
  controller.activate(MUSIC)
  expect(calls).toEqual(['open:netease-music'])
  expect(controller.getState().activePanelId).toBeNull()

  // 布局服务把 id 推回来之后，第二次点击才是收起。
  controller.setActivePanelId(MUSIC.panelId)
  controller.activate(MUSIC)
  expect(calls).toEqual(['open:netease-music', 'close:netease-music'])
})

it('opens a different panel while another one is in front', () => {
  const { controller, calls } = bench([{ item: MUSIC }])
  controller.setActivePanelId('edge-notes')

  controller.activate(MUSIC)

  expect(calls).toEqual(['open:netease-music'])
})

it('toggles by panelId even when that panel registered no launcher', () => {
  const { controller, calls } = bench()

  controller.togglePanel('ghost')
  expect(calls).toEqual(['open:ghost'])

  controller.setActivePanelId('ghost')
  controller.closePanel()
  expect(controller.getState().activePanelId).toBeNull()
  expect(calls).toEqual(['open:ghost', 'close:ghost'])
})

it('sends an external launcher to the launch port instead of a panel request', () => {
  const { controller, calls } = bench([{ item: EXTERNAL }])
  const external = controller.getState().items[0]

  expect(external?.kind).toBe('external')
  if (external !== undefined) controller.activate(external)

  expect(calls).toEqual(['launch:example-app'])
})

it('wakes the service behind a panel before asking for it', () => {
  const registry = new LauncherRegistry(new Context(), 'windows', filterLauncherItems)
  registry.register({ item: MUSIC })
  const order: string[] = []
  const controller = new TaskbarController(registry, createTaskbarStore().create(), {
    openPanel: () => order.push('open'),
    closePanel: () => order.push('close'),
    launchExternal: () => order.push('launch'),
    wakeService: () => order.push('wake'),
  })

  controller.activate(MUSIC)

  expect(order).toEqual(['wake', 'open'])
})

it('records availability without inventing a launcher', () => {
  const { controller } = bench([{ item: MUSIC }])

  controller.setItemAvailability(MUSIC.id, 'failed')
  const failed = controller.getState().items[0]
  expect(failed?.availability).toBe('failed')

  // 未注册的 id 不产生任何条目。
  controller.setItemAvailability('ghost', 'failed')
  expect(controller.getState().items).toHaveLength(1)
})

it('stores an MCP icon on the internal launcher that owns it', () => {
  const { controller } = bench([{ item: MUSIC }, { item: EXTERNAL }])

  controller.setItemIcon(MUSIC.id, 'data:image/png;base64,AAAA')
  const internal = controller.getState().items.find(item => item.id === MUSIC.id)
  expect(internal?.kind === 'internal' ? internal.iconUrl : undefined).toBe('data:image/png;base64,AAAA')

  // 外部图标来自 Host 的可执行文件提取，因此它不带 iconUrl。
  controller.setItemIcon(EXTERNAL.id, 'data:image/png;base64,BBBB')
  expect(controller.getState().items.find(item => item.id === EXTERNAL.id)).not.toHaveProperty('iconUrl')
})

it('registers a launcher through the face and drops it on the returned disposer', () => {
  const { controller } = bench()

  const dispose = controller.register({ item: MUSIC })
  expect(controller.getState().items.map(item => item.id)).toEqual(['netease-music'])

  dispose()
  expect(controller.getState().items).toEqual([])
})

it('persists the user choice and restores it in the next store instance', () => {
  const storage = stubLocalStorage()
  const first = createTaskbarStore().create()
  expect(first.getSnapshot().visible).toBe(true)

  first.actions.setVisible(false)
  expect(storage.get('dsh.sidebar-app.v1')).toBe(JSON.stringify({ visible: false }))

  // 新实例（等价于下次启动）读回落盘的选择。
  expect(createTaskbarStore().create().getSnapshot().visible).toBe(false)
})

it('reads the pre-registry preference once, so this rewrite keeps the user choice', () => {
  const storage = stubLocalStorage()
  storage.set('dsh.taskbar.visible', 'false')

  expect(createTaskbarStore().create().getSnapshot().visible).toBe(false)
})

it('ignores a corrupt stored preference instead of failing to boot', () => {
  const storage = stubLocalStorage()
  storage.set('dsh.sidebar-app.v1', '{"visible":"yes"}')

  const instance = createTaskbarStore().create()

  expect(instance.getSnapshot().visible).toBe(true)
  expect(storage.has('dsh.sidebar-app.v1')).toBe(false)
})
