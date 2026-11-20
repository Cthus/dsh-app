/**
 * Browser half: the 48px App Dock.
 *
 * 一个插件、一份贡献：帧 `shell.overlay` 席位里的一列图标，外加它背后的
 * `ctx.taskbar` 服务。装配只发生在这里，每一块都按 ui-sidebar-right 的分法就位：
 *
 * - `contract/taskbar.ts` 是唯一跨边界的词汇（启动项、状态、注册定义、事件）；
 * - `app-registry.ts` 归并同一个 `id` 上的多条定义，`apps/` 提供空的默认清单；
 * - `taskbar/` 负责平台过滤、排序和外部应用启动；
 * - `stores.ts` 持有显隐与运行期改写，`persistence.ts` 只落盘显隐；
 * - `service.ts` 把两者合成快照并提供 `ctx.taskbar`；
 * - `shell/` 只画，订阅与 DOM 观察都在装配点接上。
 *
 * 一次点击只向外问一次：内部项广播 `taskbar/open-panel` / `taskbar/close-panel`
 * （以及兼容拼写），外部项交给 Host 或系统协议。启动栏不等待答案，也不猜答案 ——
 * `activePanelId` 来自布局服务，图标只有页面真的在前台时才进入 work 态。
 *
 * 每个副作用都在 `ctx.effect` 里，因此停用这一行 Loader 会把服务、镜像、桥、席位
 * 一次拆干净 —— 这是它能热插拔的全部原因。
 * @module @deepseek-ai/dsh-client-ui-sidebar-app/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ILayout, MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TaskbarState } from './contract/taskbar.ts'
import type {} from './contract/taskbar.ts'
import { LauncherRegistry } from './app-registry.ts'
import { createTaskbarStore } from './stores.ts'
import { TaskbarController } from './service.ts'
import { en, NS, zh } from './locales.ts'
import { TaskbarDock, type TaskbarDockInjected } from './shell/TaskbarDock.tsx'
import { observeRightbarCollapsed, readRightbarCollapsed } from './shell/rightbar-collapsed.ts'
import { detectPlatform, filterLauncherItems } from './taskbar/platform.ts'
import { DEFAULT_LAUNCHER_DEFINITIONS } from './apps/index.ts'
import { launchExternalApp } from './taskbar/launch.ts'

export type { TaskbarDockProps } from './shell/TaskbarDock.tsx'
export type { TaskbarItemMode, TaskbarItemProps } from './shell/TaskbarItem.tsx'
export type {
  ExternalAppItem, InternalAppItem, LauncherDefinition, LauncherItem, LauncherItemAvailability,
  LauncherItemKind, LauncherPlatform, LauncherPriority, TaskbarService, TaskbarState,
} from './contract/taskbar.ts'
export type { TaskbarPorts } from './service.ts'
export type { LauncherSelection } from './app-registry.ts'

/** 插槽注册表、帧的面板动作、文案、以及「当前会话是谁、它的工作区在哪」两个服务。 */
export const inject = ['slots', 'layout', 'locale', 'sessions', 'uiSession']

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 紧凑应用启动栏服务：启动项、显隐与活动面板的唯一入口。 */
    taskbar: TaskbarController
  }
}

/**
 * 当前会话的工作区目录，交给 Host 的 open-in-app 使用。
 *
 * 启动栏自己没有会话上下文，这一段只能由装配点提供：会话对象层给出目录，选中的
 * 是哪一个由 ui-session 的适配器决定。拿不到（没有选中会话、会话没有目录）时返回
 * undefined，启动路径会直接走启动项自己的协议兜底。
 * @param ctx - 客户端根上下文。
 * @returns 绝对路径，或 undefined。
 */
function currentWorkspaceDir(ctx: ClientContext): string | undefined {
  const sessionId = ctx.uiSession.adapter.current.getSnapshot().key as SessionId | undefined
  if (sessionId === undefined) return undefined
  return ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
}

/**
 * Client plugin body: 建注册表与状态，提供 `ctx.taskbar`，把布局、事件与席位接起来。
 * @param ctx - 客户端根上下文，携带插槽注册表、帧的面板动作与文案。
 */
export function apply(ctx: ClientContext): void {
  const layout: ILayout = ctx.layout

  // 注册表与状态在 apply 顶层建好，不放进 effect：`register()` 会往本 fiber 加 effect，
  // 从别的插件的 apply 里对「还没生效的 effect 作用域」做这件事会让浏览器启动静默卡住。
  const registry = new LauncherRegistry(ctx, detectPlatform(), filterLauncherItems)
  for (const definition of DEFAULT_LAUNCHER_DEFINITIONS) registry.register(definition)
  const store = createTaskbarStore().create()

  const controller = new TaskbarController(registry, store, {
    // 内部面板：只广播，不写活动面板。页面真的挂载后，布局服务会把新 id 推回来。
    openPanel: (item) => {
      ctx.emit('taskbar/open-panel', item)
      ctx.emit('taskbar/show-pannel', item)
    },
    closePanel: (item) => {
      ctx.emit('taskbar/close-panel', item)
      ctx.emit('taskbar/hide-pannel', item.panelId)
    },
    // 外部应用：工作区目录交给 Host，Host 拒绝或不可达时由启动项自己的协议地址兜底。
    launchExternal: (item) => {
      void launchExternalApp(item, {
        resolveWorkspaceDir: () => currentWorkspaceDir(ctx),
        setItemAvailability: (id, failed) => { store.actions.setAvailability(id, failed ? 'failed' : 'available') },
      })
    },
  })
  ctx.provide('taskbar', controller)
  // provide 的注销随 fiber 走；这里只收掉控制器对状态与注册表的订阅。
  ctx.effect(() => () => { controller.dispose() }, 'ui-sidebar-app: taskbar subscriptions')

  // 布局服务是「哪个面板在前」的唯一真理来源。启动栏只镜像它，从不写它：没人响应的
  // 点击会让图标停在 sleep，而不是显示一个并不存在的页面。
  ctx.effect(() => {
    const sync = (): void => { controller.setActivePanelId(layout.panelInfo.getSnapshot().activePanelId) }
    const unsubscribe = layout.panelInfo.subscribe(sync)
    sync()
    return unsubscribe
  }, 'ui-sidebar-app: active panel mirrors the layout service')

  // 别人发来的收起请求只丢掉镜像就停手：事件来自外部，再广播一次就是把同一次关闭说两遍。
  ctx.effect(() => ctx.on('taskbar/hide-pannel', (panelId: string) => {
    if (controller.getState().activePanelId === panelId) controller.setActivePanelId(null)
  }), 'ui-sidebar-app: honour outward hide requests')

  // 点击的页面半边：把点击点名的面板选到前台。`selectPanel` 会拒绝未注册的 id，
  // 那正好是「没有页面应答」的情况 —— 吞掉即可，启动栏的职责是问，不是逼。
  ctx.effect(() => {
    const disposeOpen = ctx.on('taskbar/open-panel', (item) => {
      try { layout.selectPanel(item.panelId as MainPanelId) } catch { /* 页面未注册：保持 sleep */ }
    })
    const disposeClose = ctx.on('taskbar/close-panel', () => {
      try {
        if (layout.panelInfo.getSnapshot().activePanelId !== null) layout.selectPanel(null)
      } catch { /* 面板已不在，无需处理 */ }
    })
    return () => {
      disposeOpen()
      disposeClose()
    }
  }, 'ui-sidebar-app: main panel bridge')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-app: dictionaries')

  // 右栏折叠状态是启动栏唯一的显隐判据，也是唯一一个要靠 DOM 读的事实：帧只把它画成
  // 标记，没有发布成服务。观察放在装配点，组件只拿到一个 observable。
  const collapsed = createSnapshotStore(
    typeof document === 'undefined' ? false : readRightbarCollapsed(document),
  )
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    return observeRightbarCollapsed(document, (value) => {
      if (collapsed.getSnapshot() !== value) collapsed.set(value)
    })
  }, 'ui-sidebar-app: right column gate')

  // 席位本身：帧浮层里的启动栏。右栏展开或切到全局主面板时它自己不画。
  const taskbarSource: HostObservable<TaskbarState> = {
    getSnapshot: () => controller.getState(),
    subscribe: listener => controller.subscribe(listener),
  }
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'ui-sidebar-app.taskbar-dock',
    locale: NS,
    inject: (): TaskbarDockInjected => ({
      hooks: { taskbar: taskbarSource, rightbarCollapsed: collapsed },
      activate: (item) => { controller.activate(item) },
    }),
  }, TaskbarDock)), 'ui-sidebar-app: dock in the overlay seat')
}
