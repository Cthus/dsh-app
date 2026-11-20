---
name: dsh-taskbar-app-injection
description: 在 DeepSeek Harness App Dock 中注册或审查扩展启动项时使用。说明 `LauncherDefinition` 注册表、internal/external 启动项、Host open-in-app 路由、Cordis 事件、显隐判据与验证命令。
---

# DSH Taskbar（App Dock）应用注入指南

本指南描述 `ui-sidebar-app` 中 App Dock 的**当前实现**，用于在右侧紧凑启动栏新增、修改或审查应用启动项。Taskbar 只是 48px 的启动器：它保存启动项、状态与事件，不持有业务页面，也不直接启动操作系统进程。

本插件不捆绑用户环境特有的应用。其他插件通过 `ctx.taskbar.register()` 注册启动项：

| 情况 | 走法 |
|---|---|
| 外部插件注册应用 | `ctx.taskbar.register({ priority: 'extension', item })` |

## 代码地图

改一个启动项时，按职责只动需要的文件：

| 位置 | 职责 |
|---|---|
| `packages/client/ui-sidebar-app/src/client/contract/taskbar.ts` | 与外部交换的全部词汇：`LauncherItem`、`InternalAppItem`、`ExternalAppItem`、`LauncherDefinition`、`LauncherPriority`、`TaskbarState`、`TaskbarService` 面，以及 Cordis `taskbar/*` 事件声明。外部插件只依赖这一层 |
| `packages/client/ui-sidebar-app/src/client/app-registry.ts` | `LauncherRegistry`：按 `id` 归并定义（`extension` > `builtin` > `fallback`），把在用的那批交给平台与次序规则 |
| `packages/client/ui-sidebar-app/src/client/apps/index.ts` | 空的默认启动项表；具体应用由扩展注册 |
| `packages/client/ui-sidebar-app/src/client/taskbar/platform.ts` | `detectPlatform()`、`filterLauncherItems()` |
| `packages/client/ui-sidebar-app/src/client/taskbar/launch.ts` | 外部应用启动：先请 Host，再用启动项自己的 `launchUrl` 兜底 |
| `packages/client/ui-sidebar-app/src/client/stores.ts` | 显隐、镜像来的活动面板、运行期改写（可用性/图标） |
| `packages/client/ui-sidebar-app/src/client/persistence.ts` | 唯一落盘的东西：显隐 |
| `packages/client/ui-sidebar-app/src/client/service.ts` | `TaskbarController`：合成快照、把点击翻译成请求（`TaskbarPorts`） |
| `packages/client/ui-sidebar-app/src/client/shell/TaskbarDock.tsx` | 渲染、显隐门、点击上报 |
| `packages/client/ui-sidebar-app/src/client/shell/TaskbarItem.tsx` | 图标来源、三态样式、tooltip、状态点 |
| `packages/client/ui-sidebar-app/src/client/shell/rightbar-collapsed.ts` | 显隐判据：读帧与面板的两个 DOM 标记 |
| `packages/client/ui-sidebar-app/src/client/locales.ts` | `sidebarApp` 命名空间的字典 |
| `packages/client/ui-sidebar-app/src/client/index.ts` | 装配点：提供 `ctx.taskbar`、镜像布局、接事件、观察右栏、挂载 `shell.overlay` 席位 |
| `packages/host/open-in-app/src/catalog.ts`、`shared.ts`、`resolver.ts`、`icons.ts` | Host 白名单、launcher 解析、图标提取与三个 HTTP 路由常量 |
| `packages/client/ui-open-in-app/src/client/applications.ts`、`locales.ts` | 应用 id 到展示名的映射（供菜单与客户端复用） |
| `packages/client/ui-sidebar-app/tests/` | `app-registry`（band 与次序）、`taskbar`（控制器）、`taskbar-launch`（外部启动）、`taskbar-item` / `taskbar-dock`（界面）、`rightbar-collapsed`（判据）、`apply`（装配） |

本文件有两份必须保持一致的副本：`.agents/skills/dsh-taskbar-app-injection/SKILL.md` 与 `packages/client/ui-sidebar-app/skills/dsh-taskbar-app-injection/SKILL.md`。包名 `files` 包含 `skills`，因此包内副本会随包发布。

## 一条定义，不是一次改代码

注册一条启动项就是交一个 `{ item, priority }`：

```ts
import type { LauncherDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-app/client'

const definition: LauncherDefinition = {
  priority: 'extension',
  item: { id: 'my-tool', label: '我的工具', kind: 'internal', panelId: 'my-tool', order: 15 },
}

ctx.effect(() => ctx.taskbar.register(definition))
```

`register()` 返回幂等注销函数，**必须**在调用方自己的 `ctx.effect` 里持有它：注册表把注册与注销挂在了它自己所属的那个 fiber 上，调用方不收回，插件卸载后这一项仍会留在启动栏里。

`priority` 缺省为 `extension`（没写明来源的定义按产品之外的包对待）。三个 band：

| band | 数值 | 用途 |
|---|---|---|
| `extension` | 3 | 产品之外的包，最高。同一个 `id` 上有 `builtin` 时由它接管，卸载后 `builtin` 复位 |
| `builtin` | 2 | 产品自带项（`apps/index.ts`） |
| `fallback` | 1 | 只在没有更具体的定义时存在，不与任何定义共用 `id` |

同一个 `id` 上至多两条定义共存，且必须是一条 `extension` 配一条 `builtin`；其余组合直接抛错，而不是悄悄覆盖：

- `sidebarApp: launcher "x" is already registered (extension)` —— 同 band 再注册一次；
- `sidebarApp: launcher "x" is already registered (builtin)` —— 槽位已被占满，或 `fallback` 撞上了别人；
- `sidebarApp: a launcher definition needs a non-empty id` —— `id` 为空。

## 真实契约

`contract/taskbar.ts` 中的字段就是全部可用字段，不存在 `icon`、`iconColor`、`onClick` 等字段：

```ts
interface LauncherItemBase {
  readonly id: string
  readonly label: string
  readonly kind: 'internal' | 'external'
  readonly availability?: 'available' | 'unsupported' | 'failed'
  readonly order?: number
  readonly platforms?: readonly ('windows' | 'macos' | 'linux')[]
}

interface InternalAppItem extends LauncherItemBase {
  readonly kind: 'internal'
  readonly panelId: string
  readonly iconUrl?: string // MCP 提供的 data: 或 http(s): 图标
}

interface ExternalAppItem extends LauncherItemBase {
  readonly kind: 'external'
  readonly executablePath: string
  readonly args?: readonly string[]
  readonly cwd?: string
  readonly appId?: string   // 对应 Host open-in-app catalog id
  readonly launchUrl?: string // 浏览器侧兜底：自定义协议地址
}

interface LauncherDefinition {
  readonly item: LauncherItem
  readonly priority?: 'extension' | 'builtin' | 'fallback' // 缺省 extension
}
```

`TaskbarState` 为 `{ visible, activePanelId, items }`，全部只读，引用稳定（没变化就是同一个对象）。改状态走 `ctx.taskbar` 的面：`register`、`activate`、`toggleInternalApp`、`togglePanel`、`closePanel`、`setVisible`、`toggleVisible`、`setActivePanelId`、`setItemAvailability`、`setItemIcon`。

`subscribe(listener)` 的回调**不带参数** —— 先读 `getState()`，订阅只负责之后的变化。这是 `ObservableSnapshot` 的形状，也是渲染器把它绑成 `useTaskbar` 的前提。

`DEFAULT_LAUNCHER_DEFINITIONS` 为空。安装方需要显示哪些应用，由安装方的扩展决定。

`filterLauncherItems(items, platform)` 两个参数都是必填：先按 `platforms` 过滤，再按 `order` 升序排序；未写 `order` 的项以 `1000 + 注册下标` 排在后面。`detectPlatform()` 读取 `navigator.userAgentData.platform` / `userAgent`，无 `navigator` 时返回 `windows`。

## 注册外部系统应用

外部应用的启动完全由 Host 代理；渲染进程只发 HTTP 请求，不调用 `child_process`，也不把任意可执行文件路径直接交给系统。

**1. Host 白名单。** 在 `packages/host/open-in-app/src/catalog.ts` 的 `OPEN_IN_APP_CATALOG` 中声明应用 id 与各平台 locator。只有 catalog 中的 id 才会被 Host 接受；启动项里的 `executablePath` 只是契约字段，真正解析由 `resolver.ts` 完成。

**2. 展示名。** 若应用会出现在 open-in-app 菜单，向 `packages/client/ui-open-in-app/src/client/applications.ts` 的 `APP_LABEL_KEY` 和 `locales.ts` 的 `PRODUCT_NAMES` 加同名映射。Taskbar 自身的 `label` 来自启动项，不走这里。

**3. 定义。** 由应用扩展调用 `ctx.taskbar.register()`；`appId` 必须与 catalog id 一致：

```ts
const externalApp: LauncherDefinition = {
  priority: 'extension',
  item: {
    id: 'my-app',
    label: 'My app',
    kind: 'external',
    appId: 'my-app',
    executablePath: 'my-app',
    launchUrl: 'my-app://',
    order: 10,
  },
}
```

`platforms` 控制启动栏是否展示该项。不要写 `availability`：它是运行期状态。

App Dock 挂在覆盖整个 AppFrame 的 `shell.overlay` 层，但只在 Session 主视图（`activePanelId === null`）且右栏收起时显示。最多四个应用直接显示图标；五个及以上切换为可展开的圆形轮盘，按应用数量均匀分布到同心环。轮盘由中心按钮开关，Escape、点击外部区域或启动应用都会收起它。定位、状态和动画留在 `ui-sidebar-app` 的 CSS Module，不要改全局 overlay 样式。

`protocolOnly: true` 表示启动项只打开自己的 `launchUrl`，不会把当前会话的工作区目录发送给 Host；未设置的启动项仍先请求 Host，失败后才尝试 `launchUrl`。

**4. 点击链路。** 组件只上报 `activate(item)`；`TaskbarController` 对 `kind === 'external'` 调装配点给的启动端口，落到 `taskbar/launch.ts` 的 `launchExternalApp(item, ports)`：

1. `appId = item.appId ?? item.id`；`ports.resolveWorkspaceDir()` 取当前会话的工作区目录（装配点用 `ctx.uiSession.adapter.current` + `ctx.sessions.list` 拼出来）；
2. 有目录才 POST Host 的 open 路由（`OPEN_IN_APP_OPEN_ROUTE`，浏览器相对形式 `open-in-app/open`），body 为 `{ app, path }`；没目录**不发**请求（Host 要求真实存在的绝对路径，编一个必然 404）；
3. Host 2xx → `setItemAvailability(id, false)`，记为可用；
4. Host 拒绝或不可达 → 用启动项自己的 `launchUrl` 交给系统协议处理器（`window.open(launchUrl, '_self')`）。协议是否真的被接管无从得知，因此只发请求、不判失败；
5. 两者都不成立 → `setItemAvailability(id, true)`，图标进入 `failed`。

启动项的 `launchUrl` 是这一层唯一的知识：不要回到「按 id 猜协议」的老路（见文末）。

**5. 图标链路。** `TaskbarItem` 对有 `appId` 的外部项取 `${OPEN_IN_APP_ICON_PREFIX_ROUTE}/${encodeURIComponent(item.appId ?? item.id)}`；图标从可执行文件提取，不经过 `setItemIcon`。图片加载失败或没有图标时显示 `id` 首字母大写；`id` 完全空白时显示 `?`。`iconUrl` 变化会复位失败态，MCP 先给坏图再换好图不会永久停在首字母。

## 注入内部面板应用

内部应用打开主工作区的沉浸式页面，不启动外部进程。

```ts
const panelApp: LauncherDefinition = {
  item: {
    id: 'my-tool',
    label: '我的工具',
    kind: 'internal',
    panelId: 'my-tool',
    iconUrl: 'data:image/png;base64,...', // 可选，来自 MCP 服务
    order: 15,
  },
}
```

`panelId` 必须与业务插件注册到 `main` 槽位的 key 相同；`ctx.layout.selectPanel()` 会校验该 key 已注册，未注册时抛错。

`TaskbarController.toggleInternalApp` 只做两件事：先调可选的 `ports.wakeService(item)`（支撑该面板的 MCP 服务上路，目前没有归属方，接入后填这个端口即可），再按当前 `activePanelId` 决定调 `openPanel` 还是 `closePanel`。

点击**不写本地状态**：`toggleInternalApp` / `togglePanel` 只发请求，`activePanelId` 的唯一真理来源是 `ctx.layout.panelInfo`（`client/index.ts` 的镜像 effect）。页面没注册时 `layout.selectPanel` 抛错被吞掉，图标保持 `sleep`，不会出现假高亮；页面挂载后布局服务把 id 推回来，第二次点击才变成收起。程序化收起（`closePanel`）例外，它由调用方决定结果，会主动清掉 `activePanelId`。

`ui-sidebar-app` 的 `apply()` 把两个端口接到 Cordis：打开时广播 `taskbar/open-panel` 与兼容事件 `taskbar/show-pannel`；关闭时广播 `taskbar/close-panel` 与兼容事件 `taskbar/hide-pannel(item.panelId)`。业务插件监听后切换面板，并提供返回入口：

```ts
ctx.on('taskbar/open-panel', (item) => {
  if (item.panelId === 'my-tool') ctx.layout.selectPanel('my-tool' as MainPanelId)
})
// 页面内的返回按钮
ctx.layout.selectPanel(null)
ctx.emit('taskbar/hide-pannel', 'my-tool')
```

`apply()` 同时订阅 `ctx.layout.panelInfo`，把外部（例如主面板返回按钮）造成的 `activePanelId` 变化同步回 Taskbar；`taskbar/hide-pannel` 也会反向清掉镜像，但**不再向外广播**同一次关闭（请求来自别人，说两遍就是把一次关闭当成两次）。因此不要绕过布局服务硬改 `activePanelId`。

## 事件契约

事件声明在 `contract/taskbar.ts`（与 `LauncherItem` 同一个文件，因为外部插件同时需要两者），payload 均为 `InternalAppItem` 或 `panelId`：

| 事件 | 载荷 | 用途 |
|---|---|---|
| `taskbar/open-panel` | `InternalAppItem` | 当前使用的打开事件，业务插件监听它切换主面板 |
| `taskbar/close-panel` | `InternalAppItem` | 当前使用的关闭事件 |
| `taskbar/show-pannel` | `InternalAppItem` | 旧指南兼容拼写，与 `open-panel` 同时广播 |
| `taskbar/hide-pannel` | `string`（panelId） | 旧指南兼容拼写，与 `close-panel` 同时广播；插件也监听它做反向同步 |

拼写 `pannel` 是历史兼容契约，不要"顺手修正"；新增消费者优先用没有拼写错误的 `open-panel` / `close-panel`。

## 挂载、可见性与状态

`apply()` 通过 `ctx.slots.inject('shell.overlay')` 注册 `ui-sidebar-app.taskbar-dock`（`locale: 'sidebarApp'`），注入面是 `{ hooks: { taskbar, rightbarCollapsed }, activate }`；DOM 根节点带 `data-taskbar-dock`、`role="toolbar"`。`ctx.provide('taskbar', controller)` 让其他插件可以通过 `ctx.taskbar` 读写启动栏。

显隐有两个输入，都在渲染时决定，组件不用 effect 去追：`useRightbarCollapsed()` 为真且 `state.visible` 为真，否则返回 `null` 什么都不画。右栏是否收起由 `shell/rightbar-collapsed.ts` 判定，**面板标记优先**：

- 文档里有 `[data-sidebar-right-open]`（面板自己展开）→ 不算收起；
- 否则有 `[data-rightbar-collapsed]`（帧的右栏宽度为 0）→ 收起。

顺序不能反：浮窗呈现时右栏宽度仍是 0、帧上的标记也还在，只看帧会把浮窗当成收起。判据只此一处，样式表不再重复隐藏。

显隐状态持久化在 `localStorage` 的 `dsh.sidebar-app.v1`（`{ visible }`），默认 `true`；新键不存在时读旧键 `dsh.taskbar.visible`，脏 JSON 读到即清掉并回退旧键。

单项三态由 `itemMode()` 推导：`availability === 'unsupported'` → `close`（按钮 `disabled`）；内部项 `panelId === activePanelId` → `work`（`aria-pressed`）；其余 → `sleep`。状态点只画需要用户注意的两种：`unsupported` 灰、`failed` 红；`available` 与未设置都不画点（否则满屏绿点）。

## 质量门禁

在仓库根目录执行，以下均针对当前代码验证过：

```bash
pnpm exec vitest run packages/client/ui-sidebar-app/tests --project thread-safe
pnpm exec tsx scripts/run-oxlint.ts packages/client/ui-sidebar-app
pnpm exec tsx scripts/verify-client-domain-graph.ts
```

类型检查用仓库既有入口（`pnpm run typecheck`，或对 `tsconfig.client.json` 做 `tsc -b`）；单独 `tsc -p packages/client/ui-sidebar-app/tsconfig.json` 不会带上项目引用，结果不可信。

提交前自查：

- [ ] 新启动项走 `LauncherDefinition`（`builtin` 在 `apps/<app-id>/index.ts` 定义，由 `apps/index.ts` 登记，外部包用 `ctx.taskbar.register` + 自己的 `ctx.effect`）。
- [ ] 同一个 `id` 上只留一对 `extension` / `builtin`；没有靠「悄悄覆盖」实现的替换。
- [ ] Taskbar 目录内没有 import 具体业务页面组件或领域实体；`contract/` 之外没有别的共享 API。
- [ ] 渲染进程没有 `spawn` / `exec`；外部启动只走 Host open 路由与启动项自己的 `launchUrl`。
- [ ] 外部项有 `appId`，值与 `OPEN_IN_APP_CATALOG` 的 id 一致；`platforms` 与预期平台一致；需要兜底时给了 `launchUrl`。
- [ ] 内部项有 `panelId` 与 `main` 槽位 key 一致，且提供返回入口并广播关闭事件。
- [ ] 新增/修改的启动项有对应测试；两份 skill 副本内容一致。

## 不要再沿用的旧说法

以下来自更早的指南草案，与当前代码不符：

- `DEFAULT_LAUNCHER_ITEMS`：已改名为 `DEFAULT_LAUNCHER_DEFINITIONS`，每项是 `{ priority, item }`。
- `src/client/taskbar/controller.ts`、`taskbar/index.ts`：已不存在；控制器在 `src/client/service.ts`，状态在 `src/client/stores.ts`。
- `launchInternalApp` / `requestMcpForPanel` / `showPanel` / `hidePanel` 钩子：已删除。开/收在 `TaskbarController.toggleInternalApp`，唤起服务的位置是 `TaskbarPorts.wakeService`。
- `taskbar/show-panel` / `taskbar/hide-panel`（拼写正确的那一对）：已从事件声明里删除，只剩 `pannel` 拼写。
- `icon: 'globe' | 'music' | 'layers'` 字段：类型中不存在；外部图标走 `open-in-app/icon/<appId>`，内部图标走 `iconUrl`。
- `ctx.remote.openInApp.launch(item.id)`：没有此调用；当前是 `fetch` 到 Host open 路由。
- `ctx.layout.closeSidebar?.()`：布局面没有这个方法；当前由 `selectPanel` 与右侧栏席位自行处理。
- 只写 `executablePath` 就能启动：Host 只认 catalog 中已声明且解析成功的 id。
- 按 id 猜协议：已改为读启动项自己的 `launchUrl`，启动栏不再认识具体应用。
- `ctx.reflect.provide('taskbar', …)`：现在是 `ctx.provide('taskbar', …)`。
- 显隐只看 `.frame` 的 `data-rightbar-collapsed`，并用 CSS `:has()` 补刀：判据已收进 `shell/rightbar-collapsed.ts`，面板标记优先。
- `localStorage` 键 `dsh.taskbar.visible`：现在是 `dsh.sidebar-app.v1`（旧键仍会被读一次做迁移）。
- 把启动项配到 `cordis.patch.yml`：启动项由应用扩展通过 `ctx.taskbar.register()` 注册。
