/**
 * 启动栏自己持有的状态：显隐、镜像来的活动面板、以及运行期对单个启动项的改写。
 *
 * 状态写成 `defineStore` 的纯数据 + 动作表，理由与右侧栏同一套：动作是唯一的写入口，
 * 每次写只整体替换受影响的那一段，快照引用因此是可信的 —— UI 与外部订阅者都靠
 * 「引用没变就是没变」来决定要不要重渲染。
 *
 * 落盘只有一件事：显隐。`activePanelId` 由布局服务在下次启动时重新推回来，
 * 图标与可用性是运行期答案，都不该跨会话存活（见 `persistence.ts`）。
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { LauncherItemAvailability } from './contract/taskbar.ts'
import { clearDockPreferences, readDockPreferences, writeDockPreferences } from './persistence.ts'

/** 一条启动项在运行期被改写的那部分：可用性，以及 MCP 服务回传的图标。 */
export interface LauncherOverride {
  readonly availability?: LauncherItemAvailability
  readonly iconUrl?: string
}

/**
 * 启动栏的共享状态。
 *
 * 字段可写只因为动作拿到的是 immer draft；对外一律当只读看，动作只整体替换。
 */
export interface TaskbarStoreState {
  /** 用户是否把这一列打开。 */
  visible: boolean
  /** 布局服务推回来的、当前在前台的面板；null 表示回到会话。 */
  activePanelId: string | null
  /** 按启动项 id 记的运行期改写；注册表里没有的 id 留着也无害。 */
  overrides: Record<string, LauncherOverride>
}

/**
 * 完整写集：除了这五个动作，没有别的写法。
 *
 * 写成 `type` 而不是 `interface`：`defineStore` 的 `A extends Record<string, …>`
 * 只对**对象字面量类型别名**给隐式索引签名，接口不会拿到，约束过不去。
 */
export type TaskbarStoreActions = {
  /** @param visible - 目标显隐。 */
  setVisible(d: TaskbarStoreState, visible: boolean): void
  toggleVisible(d: TaskbarStoreState): void
  /** @param panelId - 活动面板 id，null 表示没有面板在前台。 */
  setActivePanelId(d: TaskbarStoreState, panelId: string | null): void
  /** @param id - 启动项 id。 @param availability - 目标可用性。 */
  setAvailability(d: TaskbarStoreState, id: string, availability: LauncherItemAvailability): void
  /** @param id - 启动项 id。 @param iconUrl - MCP 提供的 `data:` 或 `http(s):` 图标地址。 */
  setIcon(d: TaskbarStoreState, id: string, iconUrl: string): void
}

/**
 * 声明启动栏状态仓库。
 *
 * `create()` 把已存的显隐读进来，并在之后每次变化时写回 —— 落盘因此只有一处，
 * 不在动作里，也不在组件里。启动栏是窗口级单例，没有会话作用域，`scopeKey` 一律为空。
 * @returns 仓库句柄；生产代码只在装配点 `create()` 一次，测试按需多开。
 */
export function createTaskbarStore(): EngineStoreHandle<TaskbarStoreState, TaskbarStoreActions> {
  const handle = defineStore<TaskbarStoreState, TaskbarStoreActions>({
    init: (): TaskbarStoreState => ({ visible: true, activePanelId: null, overrides: {} }),
    actions: {
      setVisible: (d, visible: boolean) => { d.visible = visible },
      toggleVisible: (d) => { d.visible = !d.visible },
      setActivePanelId: (d, panelId: string | null) => { d.activePanelId = panelId },
      setAvailability: (d, id: string, availability: LauncherItemAvailability) => {
        d.overrides[id] = { ...d.overrides[id], availability }
      },
      setIcon: (d, id: string, iconUrl: string) => {
        d.overrides[id] = { ...d.overrides[id], iconUrl }
      },
    },
  })
  return {
    ...handle,
    create(scopeKey) {
      const instance = handle.create(scopeKey)
      const saved = readDockPreferences()
      if (saved !== undefined) instance.actions.setVisible(saved.visible)
      // 先读后订：初始化那一次写入不回灌，免得把默认值当成用户的选择存下来。
      instance.subscribe(() => { writeDockPreferences({ visible: instance.getSnapshot().visible }) })
      return { ...instance, clearPersisted: () => { clearDockPreferences() } }
    },
  }
}
