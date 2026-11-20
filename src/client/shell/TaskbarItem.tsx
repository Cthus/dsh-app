/**
 * 启动项单个图标按钮组件
 *
 * 只负责画：图标从哪来、三态长什么样、悬浮时说什么。点击只上报「点了这一项」，
 * 启动/兜底/失败判定都在 `taskbar/launch.ts` 与 `service.ts` 里。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { OPEN_IN_APP_ICON_PREFIX_ROUTE } from '@deepseek-ai/dsh-host-open-in-app/shared'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InternalAppItem, LauncherItem } from '../contract/taskbar.ts'
import css from './TaskbarDock.module.css'

/**
 * 启动项运行状态（三态模式）：
 * - work：运行中，图标高亮
 * - sleep：待机，可用但未激活
 * - close：关闭，当前平台不可用
 */
export type TaskbarItemMode = 'work' | 'sleep' | 'close'

export interface TaskbarItemProps {
  readonly item: LauncherItem
  /** 三态；由容器按活动面板推导，组件自己不判断。 */
  readonly mode: TaskbarItemMode
  /** 悬浮提示的第二句：为什么这个图标是这个样子。没有时只显示名字。 */
  readonly status?: string | undefined
  /** Tab 顺序；轮盘收起时传 -1。 */
  readonly tabIndex?: number | undefined
  readonly onClick: () => void
}

/**
 * 内部面板的图标由 MCP 服务提供：注册启动项时把 MCP 给出的地址写进 `iconUrl`，
 * 既可以是 `data:image/png;base64,...` 的图标字节，也可以是 MCP 服务的 `http(s):` 资源地址。
 * @param item - 内部应用启动项。
 * @returns 图标地址，未接入 MCP 图标时为 undefined。
 */
function mcpIconSource(item: InternalAppItem): string | undefined {
  const raw = item.iconUrl?.trim()
  return raw === undefined || raw === '' ? undefined : raw
}

/**
 * 启动项图标的来源：
 * - 外部应用：图标内嵌在 exe / app 包资源里，交给 Host 从可执行文件提取后按图标路由返回；
 * - 内部应用：图标来自支撑该面板的 MCP 服务；
 * 两者都取不到时返回 undefined，由 `id` 首字母兜底。
 * @param item - 启动项契约。
 * @returns 可供 `<img src>` 使用的地址，或 undefined 表示无图标可用。
 */
function iconSourceOf(item: LauncherItem): string | undefined {
  if (item.kind === 'external') {
    return `${OPEN_IN_APP_ICON_PREFIX_ROUTE}/${encodeURIComponent(item.appId ?? item.id)}`
  }
  return mcpIconSource(item)
}

/**
 * 无图标可用时的兜底字形：取启动项 id 的首字母（大写）。
 * @param id - 启动项提供方定义的稳定标识符。
 * @returns 单字符占位，id 为空时回退为 `?`。
 */
function fallbackLetter(id: string): string {
  return id.trim().charAt(0).toUpperCase() || '?'
}

/**
 * @param props - 单个启动项、它的三态与点击回调。
 * @returns 一个图标按钮，含状态点与悬浮提示。
 */
export function TaskbarItem({ item, mode, status, tabIndex, onClick }: TaskbarItemProps): ReactNode {
  const [imgFailed, setImgFailed] = useState(false)
  const iconSource = iconSourceOf(item)

  // MCP 连上后会把 `iconUrl` 写进来，甚至可能先给一个坏的再换成好的；
  // 不复位就会永久停在首字母兜底。
  useEffect(() => { setImgFailed(false) }, [iconSource])

  function renderIcon(): ReactNode {
    if (iconSource !== undefined && !imgFailed) {
      return (
        <img
          src={iconSource}
          alt=""
          className={css.icon}
          onError={() => { setImgFailed(true) }}
        />
      )
    }

    return (
      <span className={css.letter} data-icon-fallback="" aria-hidden="true">
        {fallbackLetter(item.id)}
      </span>
    )
  }

  // 只有需要用户注意的可用性才画状态点：`available` 是默认态，画点只会变成满屏绿点。
  const statusMark = item.availability === 'unsupported' || item.availability === 'failed'
    ? item.availability
    : undefined

  return (
    <Tooltip label={status === undefined ? item.label : `${item.label} · ${status}`} side="left" delayMs={500}>
      <button
        type="button"
        className={css.item}
        onClick={onClick}
        tabIndex={tabIndex}
        aria-label={item.label}
        aria-pressed={mode === 'work'}
        data-mode={mode}
        disabled={mode === 'close'}
      >
        {renderIcon()}
        {statusMark !== undefined && <span className={css.status} data-status={statusMark} />}
      </button>
    </Tooltip>
  )
}
