/**
 * 启动栏与外部交换的全部词汇。
 *
 * 三个方向的信息在这里碰头，而任何一方都不读另一方的实现：
 * - 启动栏：只知道「用户点了哪个图标」，不持有页面，也不持有 MCP 进程；
 * - 页面插件：监听开/收事件，把面板挂到 `main` 槽位，或提供返回入口；
 * - 启动项提供方：注册一条定义（{@link LauncherDefinition}），或连上服务后用
 *   `setItemIcon` 回传图标。
 *
 * 放在 `contract/` 而不是某个域目录，理由与 `scripts/verify-client-domain-graph.ts`
 * 的分层一致：contract 是包内唯一的共享 API 层（layer 0），域目录之间不得互相 import。
 * 外部插件注入启动项、监听事件时只依赖这一层，因此 `LauncherItem`、注册定义与事件声明都在这里。
 *
 * 事件的载荷就是「请求」本身：一个 {@link InternalAppItem} 说明要点哪个面板，
 * 监听方自行决定要不要响应、什么时候响应。启动栏不等待、不重试、不改自己的状态。
 *
 * {@link TaskbarService} 是 `ctx.taskbar` 的面：启动栏 UI 与外部插件都只通过它
 * 读写状态，因此它也属于这一层，而不属于实现所在的 `service.ts`。
 */

/** 应用类型：internal 打开内部面板，external 启动系统外部软件 */
export type LauncherItemKind = 'internal' | 'external'

/** 应用可用状态 */
export type LauncherItemAvailability = 'available' | 'unsupported' | 'failed'

/** 适用的操作系统平台 */
export type LauncherPlatform = 'windows' | 'macos' | 'linux'

/** 启动项基础属性（所有字段均为只读，严禁外部直接修改） */
export interface LauncherItemBase {
  /** 稳定唯一标识符，由启动项提供方定义。 */
  readonly id: string

  /** 本地化展示名称 */
  readonly label: string

  /** 应用类型：内部或外部 */
  readonly kind: LauncherItemKind

  /** 运行时可用性状态（默认 'available'） */
  readonly availability?: LauncherItemAvailability

  /** 排序权重（数值越小越靠前） */
  readonly order?: number

  /** 适用的操作系统平台列表（未指定则支持全平台） */
  readonly platforms?: readonly LauncherPlatform[]
}

/** 内部应用：配置其点击时激活的面板标识（不可直接修改） */
export interface InternalAppItem extends LauncherItemBase {
  readonly kind: 'internal'
  /** 内部面板唯一标识，由面板插件定义。 */
  readonly panelId: string
  /**
   * 面板图标的 MCP 来源：`data:image/png;base64,...` 的图标字节，
   * 或 MCP 服务的 `http(s):` 资源地址。缺省时启动栏兜底为 `id` 首字母。
   */
  readonly iconUrl?: string
}

/** 外部应用：配置其在 Host 层启动的命令或路径（不可直接修改） */
export interface ExternalAppItem extends LauncherItemBase {
  readonly kind: 'external'
  /** 本地可执行文件路径或启动命令。 */
  readonly executablePath: string
  /** 启动命令行参数 */
  readonly args?: readonly string[]
  /** 启动工作目录（本地绝对路径） */
  readonly cwd?: string
  /** 对应 Host open-in-app catalog 的应用 id。 */
  readonly appId?: string
  /**
   * 浏览器直接可用的启动地址或系统协议。
   *
   * 这是启动栏自己的兜底手段，不经过 Host：当没有工作区目录可交给
   * `open-in-app/open`、或 Host 拒绝时，用它把请求交给系统协议处理器。
   * 缺省时该启动项没有任何浏览器侧兜底，Host 失败即记为 `failed`。
   */
  readonly launchUrl?: string
  /** When true, use `launchUrl` directly and never pass the current workspace to Host. */
  readonly protocolOnly?: boolean
}

/** 统一启动项联合类型（只读不可变） */
export type LauncherItem = InternalAppItem | ExternalAppItem

/**
 * 一条定义想要某个 `id` 的强度，与标签页注册表的三个 band 同构。
 *
 * - `extension`：来自产品之外的包，也最高。同一个 `id` 上同时存在 `builtin`
 *   时由它接管，它卸载后 `builtin` 复位。
 * - `builtin`：产品自带的启动项（`apps/index.ts`）。
 * - `fallback`：不与其他任何定义共用 `id`，只在没有更具体的定义时存在。
 */
export type LauncherPriority = 'extension' | 'builtin' | 'fallback'

/**
 * 注册一条启动项：启动项本身 + 它所在的 band。
 *
 * 注册表按 `id` 归并定义，因此「给同一个应用换一个实现」不改产品代码：
 * 以 `extension` 注册同名 `id` 即可接管，卸载时自动复位。
 */
export interface LauncherDefinition {
  readonly item: LauncherItem
  /** 缺省为 `extension`：没写明来源的定义按产品之外的包对待。 */
  readonly priority?: LauncherPriority
}

/** 启动栏运行时状态（只读不可变） */
export interface TaskbarState {
  /** 启动栏是否可见 (默认 true，持久化到 localStorage) */
  readonly visible: boolean
  /** 当前正在打开的内部面板 ID，null 表示未打开任何面板 */
  readonly activePanelId: string | null
  /** 注册的所有启动项 */
  readonly items: readonly LauncherItem[]
}

/**
 * `ctx.taskbar` 的面，也是启动栏 UI（`shell/TaskbarDock.tsx`）的入参。
 *
 * 实现是 `service.ts` 的 `TaskbarController`。面声明在这里而不是
 * 实现旁边，因为两侧都不该读实现：UI 层（`shell/`）与外部插件都只依赖 contract，
 * 域目录之间不得互相 import（见 `scripts/verify-client-domain-graph.ts`）。
 */
export interface TaskbarService {
  /** @returns 当前状态快照；引用相等表示没有变化。 */
  getState(): TaskbarState
  /**
   * 订阅状态变化。
   *
   * 回调**不带参数**：调用方先读 {@link getState}，订阅只负责之后的变化。这是
   * `ObservableSnapshot` 的形状，也是渲染器把本对象当 observable 绑定成
   * `useTaskbar` 的前提（回调若带快照，`useSyncExternalStore` 的接线就会错位）。
   * @param listener - 状态失效回调。
   * @returns 取消订阅。
   */
  subscribe(listener: () => void): () => void
  /**
   * 注册一条启动项，并在调用方自己的 `ctx.effect` 里持有返回的注销函数。
   * @param definition - 启动项定义，或直接给一个启动项（按 `extension` 处理）。
   * @returns 幂等注销函数。
   * @throws 当 `id` 为空，或该 band 已被占用。
   */
  register(definition: LauncherDefinition | LauncherItem): () => void
  /** @param visible - 目标显隐状态，写入 `localStorage`。 */
  setVisible(visible: boolean): void
  toggleVisible(): void
  /** @param panelId - 活动面板 id；null 表示没有面板在前台。 */
  setActivePanelId(panelId: string | null): void
  /**
   * 点击任意启动项：内部项走开/收，外部项交给装配点的启动端口。
   *
   * 这是 UI 唯一需要的入口 —— 组件不再自己判断 kind、拼 fetch 或做协议兜底。
   * @param item - 被点击的启动项。
   */
  activate(item: LauncherItem): void
  /** @param item - 被点击的内部应用项。 */
  toggleInternalApp(item: InternalAppItem): void
  /** @param panelId - 内部面板标识。 */
  togglePanel(panelId: string): void
  closePanel(): void
  /** @param id - 启动项 id。 @param availability - 目标可用性状态。 */
  setItemAvailability(id: string, availability: LauncherItemAvailability): void
  /** @param id - 启动项 id。 @param iconUrl - MCP 提供的 `data:` 或 `http(s):` 图标地址。 */
  setItemIcon(id: string, iconUrl: string): void
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * 内部应用启动项被点击且当前没有面板在前台时广播，通知外部容器打开主视图。
     * @param item - 被请求打开的内部应用项
     * @mode emit
     */
    'taskbar/open-panel'(item: InternalAppItem): void

    /**
     * 同一个启动项被再次点击、或面板已在前台时广播，通知外部容器收起视图。
     * @param item - 被请求收起的内部应用项
     * @mode emit
     */
    'taskbar/close-panel'(item: InternalAppItem): void

    /** 兼容 dsh-taskbar-app-injection 指南命名 */
    'taskbar/show-pannel'(item: InternalAppItem): void
    'taskbar/hide-pannel'(panelId: string): void
  }
}
