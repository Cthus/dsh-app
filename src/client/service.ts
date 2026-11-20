/**
 * `ctx.taskbar` 的实现：把「注册表 + 状态」合成一份快照，把点击翻译成请求。
 *
 * 这一层不做三件事，每一件都有它的归属：
 * - 不落盘：`stores.ts` 的 `create()` 负责读写偏好；
 * - 不直接改布局、不发请求：内部面板的开/收、外部应用的启动都由装配点提供的端口
 *   （{@link TaskbarPorts}）转出去，页面与 Host 各自决定怎么响应；
 * - 不猜结果：点击只发请求，`activePanelId` 的唯一真理来源是布局服务，它把新 id
 *   推回来之前，图标不会自己亮起来。
 *
 * 发布出去的 {@link TaskbarState} 由一份 `createSnapshotStore` 承载，因此引用稳定：
 * 状态或注册表没变，`getState()` 返回的还是同一个对象，渲染器的 `useTaskbar` 直接可用。
 */
import { createSnapshotStore, type EngineStoreInstance, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  ExternalAppItem, InternalAppItem, LauncherDefinition, LauncherItem, LauncherItemAvailability,
  TaskbarService, TaskbarState,
} from './contract/taskbar.ts'
import type { LauncherOverride, TaskbarStoreActions, TaskbarStoreState } from './stores.ts'

/**
 * 启动栏读启动项的地方。
 *
 * 声明成结构化的端口而不是直接吃 `LauncherRegistry`，是为了让本文件只依赖契约：
 * 装配点把注册表传进来，测试可以给一个数组，谁都不用 import 对方的实现。
 */
export interface LauncherSource {
  /** @returns 当前平台该显示的启动项，已排好序。 */
  entries(): readonly LauncherItem[]
  /** @param listener - 注册表变化回调。 @returns 取消订阅。 */
  subscribe(listener: () => void): () => void
  /** @param definition - 启动项定义。 @returns 注销函数。 */
  register(definition: LauncherDefinition | LauncherItem): () => void
}

/**
 * 点击向外发出的请求。
 *
 * 三个端口都由装配点实现：开/收接到 Cordis 事件上，外部启动接到 Host 与协议兜底上。
 * `wakeService` 留了可选位 —— 支撑某个面板的 MCP 服务目前没有归属方，接入后在这里
 * 拉起即可，点击路径不用改。
 */
export interface TaskbarPorts {
  /** @param item - 要放到前台的面板。 */
  readonly openPanel: (item: InternalAppItem) => void
  /** @param item - 要收起的面板。 */
  readonly closePanel: (item: InternalAppItem) => void
  /** 页面挂载前先喊一声，让支撑该面板的服务提前上路。 */
  readonly wakeService?: (item: InternalAppItem) => void
  /** @param item - 要交给系统启动的外部应用。 */
  readonly launchExternal: (item: ExternalAppItem) => void
}

/**
 * 把一条运行期改写叠到启动项上。
 *
 * 外部应用的图标由 Host 从可执行文件里提取，因此它只认可用性；内部应用的图标来自
 * MCP 服务，缺省时组件回落到 id 首字母。
 * @param item - 注册表里的启动项。
 * @param override - 该 id 的改写，可能没有。
 * @returns 原引用（没有改写时）或叠好改写的新对象。
 */
function withOverride(item: LauncherItem, override: LauncherOverride | undefined): LauncherItem {
  if (override === undefined) return item
  const { availability, iconUrl } = override
  if (item.kind === 'external') return availability === undefined ? item : { ...item, availability }
  return {
    ...item,
    ...(availability === undefined ? {} : { availability }),
    ...(iconUrl === undefined ? {} : { iconUrl }),
  }
}

/** 启动栏的导航与状态面；由装配点 `provide` 成 `ctx.taskbar`。 */
export class TaskbarController implements TaskbarService {
  private readonly published: SnapshotStore<TaskbarState>
  private readonly subscriptions: readonly (() => void)[]

  /**
   * @param launchers - 启动项来源，生产环境是 `LauncherRegistry`。
   * @param store - 本窗口唯一的启动栏状态。
   * @param ports - 点击向外的请求端口。
   */
  constructor(
    private readonly launchers: LauncherSource,
    private readonly store: EngineStoreInstance<TaskbarStoreState, TaskbarStoreActions>,
    private readonly ports: TaskbarPorts,
  ) {
    this.published = createSnapshotStore<TaskbarState>(this.compose())
    // 两个来源都只是「有变化」的信号，快照由 compose 重新算：状态与注册表谁动都算。
    this.subscriptions = [
      store.subscribe(() => { this.publish() }),
      launchers.subscribe(() => { this.publish() }),
    ]
  }

  /** @returns 当前快照；没变化时是同一个引用。 */
  getState(): TaskbarState {
    return this.published.getSnapshot()
  }

  /**
   * @param listener - 状态失效回调；回调不带快照，读 {@link getState} 取当前值。
   * @returns 取消订阅（订阅不回调当前状态）。
   */
  subscribe(listener: () => void): () => void {
    return this.published.subscribe(listener)
  }

  /** @param definition - 启动项定义。 @returns 注销函数。 */
  register(definition: LauncherDefinition | LauncherItem): () => void {
    return this.launchers.register(definition)
  }

  /** @param visible - 目标显隐；同值早退，保持快照引用不变。 */
  setVisible(visible: boolean): void {
    if (this.store.getSnapshot().visible === visible) return
    this.store.actions.setVisible(visible)
  }

  toggleVisible(): void {
    this.store.actions.toggleVisible()
  }

  /** @param panelId - 活动面板 id，null 表示没有面板在前台。 */
  setActivePanelId(panelId: string | null): void {
    if (this.store.getSnapshot().activePanelId === panelId) return
    this.store.actions.setActivePanelId(panelId)
  }

  /**
   * 点击一个图标：内部项按当前活动面板决定开还是收，外部项交给端口。
   * @param item - 被点击的启动项。
   */
  activate(item: LauncherItem): void {
    if (item.kind === 'internal') {
      this.toggleInternalApp(item)
      return
    }
    this.ports.launchExternal(item)
  }

  /**
   * 内部应用图标的点击：先喊服务，再按当前活动面板决定开或收。
   *
   * 只发请求、不写活动面板：页面真的挂载后，布局服务把新 id 推回来，图标到那时才
   * 进入 work 态；没人接管就保持 sleep，不会出现假高亮。
   * @param item - 被点击的内部应用启动项。
   */
  toggleInternalApp(item: InternalAppItem): void {
    this.ports.wakeService?.(item)
    if (this.store.getSnapshot().activePanelId === item.panelId) this.ports.closePanel(item)
    else this.ports.openPanel(item)
  }

  /**
   * 按 panelId 开/收，等价于点击该面板的图标。
   * @param panelId - 内部面板标识。
   */
  togglePanel(panelId: string): void {
    this.toggleInternalApp(this.internalOf(panelId))
  }

  /**
   * 程序化收起当前面板：清掉镜像再发收起请求。
   *
   * 与点击路径不同，这里会主动清 `activePanelId`，因为调用方已经决定了结果。
   */
  closePanel(): void {
    const { activePanelId } = this.store.getSnapshot()
    if (activePanelId === null) return
    const item = this.internalOf(activePanelId)
    this.setActivePanelId(null)
    this.ports.closePanel(item)
  }

  /**
   * 写入启动项可用性；注册表里没有这个 id 或值没变时早退。
   * @param id - 启动项 id。
   * @param availability - 目标可用性状态。
   */
  setItemAvailability(id: string, availability: LauncherItemAvailability): void {
    if (!this.launchers.entries().some(item => item.id === id)) return
    if (this.store.getSnapshot().overrides[id]?.availability === availability) return
    this.store.actions.setAvailability(id, availability)
  }

  /**
   * 写入内部应用的 MCP 图标；外部应用的图标走 Host 的可执行文件路由，不经过这里。
   * @param id - 启动项 id。
   * @param iconUrl - MCP 提供的 `data:` 或 `http(s):` 图标地址。
   */
  setItemIcon(id: string, iconUrl: string): void {
    const item = this.launchers.entries().find(candidate => candidate.id === id)
    if (item?.kind !== 'internal') return
    if (this.store.getSnapshot().overrides[id]?.iconUrl === iconUrl) return
    this.store.actions.setIcon(id, iconUrl)
  }

  /** 释放对状态与注册表的订阅；`ctx.provide` 的注销由装配点负责。 */
  dispose(): void {
    for (const unsubscribe of this.subscriptions) unsubscribe()
  }

  /** 重算快照并发布；变化与否由快照引擎判断引用。 */
  private publish(): void {
    this.published.set(this.compose())
  }

  /**
   * 把状态与注册表合成一份对外快照。
   * @returns 新的快照对象；`items` 的顺序即图标顺序。
   */
  private compose(): TaskbarState {
    const { visible, activePanelId, overrides } = this.store.getSnapshot()
    return {
      visible,
      activePanelId,
      items: this.launchers.entries().map(item => withOverride(item, overrides[item.id])),
    }
  }

  /**
   * 面板对应的启动项；未注册时按 panelId 合成一个最小契约，保证请求里字段齐全。
   * @param panelId - 内部面板标识。
   * @returns 对应的内部应用启动项。
   */
  private internalOf(panelId: string): InternalAppItem {
    return this.launchers.entries().find(
      (item): item is InternalAppItem => item.kind === 'internal' && item.panelId === panelId,
    ) ?? { id: panelId, label: panelId, kind: 'internal', panelId }
  }
}
