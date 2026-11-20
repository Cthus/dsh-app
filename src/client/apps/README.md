# Taskbar / App Dock — 出厂定义

这个目录只放**产品自带**的那部分：每个应用的启动项定义及其注册清单。启动栏
本身（注册表、状态、服务、界面）在 `src/client/` 下，按 ui-sidebar-right 的分法分层：

| 位置 | 职责 |
|---|---|
| `../contract/taskbar.ts` | 唯一跨边界的词汇：启动项、`LauncherDefinition`、`TaskbarState`、`TaskbarService` 面、`taskbar/*` 事件 |
| `../app-registry.ts` | `LauncherRegistry`：按 `id` 归并定义（`extension` > `builtin` > `fallback`），再把在用的那批交给平台与次序规则 |
| `../stores.ts` | 本窗口的状态：显隐、镜像来的活动面板、运行期改写 |
| `../persistence.ts` | 唯一落盘的东西：显隐（`dsh.sidebar-app.v1`，兼容旧键 `dsh.taskbar.visible`） |
| `../service.ts` | `TaskbarController`：把上面两者合成引用稳定的快照，把点击翻译成请求 |
| `../shell/` | `TaskbarDock`、`TaskbarItem`、`rightbar-collapsed.ts` —— 只画，不订阅 |
| `../index.ts` | 唯一装配点 |
| `index.ts` | 出厂启动项表（每条都是 `builtin`） |
| `../taskbar/platform.ts` | `detectPlatform()` 与 `filterLauncherItems()`：平台过滤 + 次序 |
| `../taskbar/launch.ts` | 外部应用启动：默认先请 Host；`protocolOnly` 启动项只走自己的 `launchUrl` |

## 加一个应用

在 `<app-id>/index.ts` 导出一条定义，并在本目录的 `index.ts` 注册：

```ts
{
  priority: 'builtin',
  item: {
    id: 'my-app',
    label: '我的应用',
    kind: 'external',
    appId: 'my-app',                       // 对应 Host OPEN_IN_APP_CATALOG 的 id
    executablePath: 'my-app.exe',          // 契约字段；真正解析在 Host
    launchUrl: 'myapp://',                 // 浏览器侧兜底，可省
    order: 30,
    platforms: ['windows'],
  },
}
```

不要在这里写 `availability`：它是运行期状态（Host 解析失败、平台不支持），由
`setItemAvailability` 记录，写进定义只会在每次启动时假装成事实。

外部包要给同一个 `id` 换实现，用 `ctx.taskbar.register({ priority: 'extension', item })`
注册即可 —— 出厂这一条被遮住，外部包卸载后自动复位。

## 扩展与应用注入指南

本插件随包附带了专供 AI 开发者与外部插件开发者的规范指南：
👉 详细指南请参阅：[skills/dsh-taskbar-app-injection/SKILL.md](../../../skills/dsh-taskbar-app-injection/SKILL.md)
