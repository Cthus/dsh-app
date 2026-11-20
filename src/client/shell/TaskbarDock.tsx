/**
 * 紧凑应用启动栏 (TaskbarDock) 容器组件
 *
 * Session 主视图且右栏收起时显示；全局主面板选中时整列不渲染。
 *
 * 组件不认识控制器，也不持有订阅：启动栏状态与「右栏是否收起」都通过注入面的
 * `hooks` 隔间由渲染器绑定成 `useTaskbar` / `useRightbarCollapsed`，点击通过注入面的
 * 回调上报。开/收与外部启动的判定都在 `service.ts` 与 `taskbar/launch.ts`，
 * 这里只剩「画出来」和「点了谁」。
 *
 * 显隐在渲染时按用户选择、Session 主视图和右栏折叠状态决定。
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconAppsAddOutlineRegular, IconCloseOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LauncherItem, TaskbarState } from '../contract/taskbar.ts'
import type {} from '../locales.ts'
import { TaskbarItem, type TaskbarItemMode } from './TaskbarItem.tsx'
import css from './TaskbarDock.module.css'

const WHEEL_THRESHOLD = 5
const WHEEL_BUTTON_SIZE = 40
const WHEEL_SPACING = WHEEL_BUTTON_SIZE + 8

interface WheelPosition {
  readonly x: number
  readonly y: number
}

interface WheelLayout {
  readonly size: number
  readonly positions: readonly WheelPosition[]
}

/** Arrange many launchers around one or more evenly spaced rings. */
function wheelLayout(count: number): WheelLayout {
  const ringCount = count <= 16 ? 1 : Math.ceil(count / 16)
  const positions: WheelPosition[] = []
  let remaining = count
  let outerRadius = 0

  for (let ring = 0; ring < ringCount; ring++) {
    const ringItems = Math.ceil(remaining / (ringCount - ring))
    const radius = Math.max(68, Math.ceil(ringItems * WHEEL_SPACING / (2 * Math.PI))) + ring * 44
    outerRadius = Math.max(outerRadius, radius)
    for (let position = 0; position < ringItems; position++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * position / ringItems) + (ring % 2) * Math.PI / ringItems
      positions.push({ x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius) })
    }
    remaining -= ringItems
  }

  return { size: (outerRadius + WHEEL_BUTTON_SIZE / 2 + 24) * 2, positions }
}

/** 启动栏从装配点拿到的能力面；实现见 `service.ts`。 */
export interface TaskbarDockInjected {
  readonly hooks: {
    /** 启动栏状态：显隐、活动面板、启动项。 */
    readonly taskbar: HostObservable<TaskbarState>
    /** 右栏是否收起；收起才轮到启动栏出场。 */
    readonly rightbarCollapsed: HostObservable<boolean>
  }
  /** @param item - 被点击的启动项；内部开/收与外部启动都由装配点决定。 */
  readonly activate: (item: LauncherItem) => void
}

/** 启动栏组件入参：父槽位的运行时份额、本包文案、以及注入面。 */
export type TaskbarDockProps =
  & PropsRuntime<'shell.overlay'>
  & PropsLocale<'sidebarApp'>
  & InjectFace<TaskbarDockInjected>

/**
 * 推导单个启动项的三态模式：
 * 平台不支持 → close；内部面板正在前台 → work；其余可用项 → sleep。
 * @param item - 启动项。
 * @param activePanelId - 当前在前的内部面板 id。
 * @returns 该图标应显示的模式。
 */
export function itemMode(item: LauncherItem, activePanelId: string | null): TaskbarItemMode {
  if (item.availability === 'unsupported') return 'close'
  if (item.kind === 'internal' && item.panelId === activePanelId) return 'work'
  return 'sleep'
}

/**
 * 悬浮提示的第二句：图标为什么是这个样子。
 * @param item - 启动项。
 * @param mode - 已推导出的三态。
 * @param t - 本包文案。
 * @returns 需要解释时的说明，正常可用且未运行时为 undefined。
 */
function statusOf(item: LauncherItem, mode: TaskbarItemMode, t: TaskbarDockProps['t']): string | undefined {
  if (item.availability === 'unsupported') return t('item.unsupported')
  if (item.availability === 'failed') return t('item.failed')
  return mode === 'work' ? t('item.running') : undefined
}

/**
 * @param props - 启动栏状态、右栏折叠状态与点击回调。
 * @returns 悬浮启动栏，右栏展开或用户关闭时返回 null。
 */
export function TaskbarDock({ useTaskbar, useRightbarCollapsed, usePanelInfo, activate, t }: TaskbarDockProps): ReactNode {
  const state = useTaskbar(snapshot => snapshot)
  const collapsed = useRightbarCollapsed(value => value)
  const { activePanelId } = usePanelInfo(info => info)
  const [shown, setShown] = useState(false)
  const [wheelOpen, setWheelOpen] = useState(false)
  const wheelRef = useRef<HTMLDivElement>(null)
  const wheelToggleRef = useRef<HTMLButtonElement>(null)
  const wheelMode = state.items.length >= WHEEL_THRESHOLD
  const visible = collapsed && state.visible && activePanelId === null
  const expanded = wheelMode && wheelOpen && visible

  useEffect(() => {
    if (!visible || !wheelMode) setWheelOpen(false)
  }, [visible, wheelMode])

  useEffect(() => {
    if (!expanded) return undefined
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !wheelRef.current?.contains(event.target)) setWheelOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => { document.removeEventListener('pointerdown', closeOutside) }
  }, [expanded])

  useEffect(() => {
    if (visible) {
      const frame = requestAnimationFrame(() => { setShown(true) })
      return () => { cancelAnimationFrame(frame) }
    }
    setShown(false)
    return undefined
  }, [visible])

  // 保留 DOM 完成渐隐与弹出收场，再从树中卸载。
  if (!visible && !shown) return null

  if (wheelMode) {
    const layout = wheelLayout(state.items.length)
    const wheelStyle = { '--wheel-size': `${layout.size}px` } as CSSProperties
    return (
      <div
        ref={wheelRef}
        className={css.wheel}
        role="toolbar"
        aria-label={t('dock.label')}
        data-taskbar-dock=""
        data-visible={visible && shown}
        data-open={expanded}
        style={wheelStyle}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && expanded) {
            event.preventDefault()
            setWheelOpen(false)
            wheelToggleRef.current?.focus()
          }
        }}
      >
        <div className={css.wheelGuide} aria-hidden="true" />
        <div className={css.wheelEntries} id="ui-sidebar-app-wheel-items" aria-hidden={!expanded}>
          {state.items.map((item, itemIndex) => {
            const position = layout.positions[itemIndex]
            if (position === undefined) return null
            const entryStyle = {
              '--wheel-x': `${position.x}px`,
              '--wheel-y': `${position.y}px`,
              '--wheel-delay': `${Math.min(itemIndex, 18) * 12}ms`,
            } as CSSProperties
            const mode = itemMode(item, state.activePanelId)
            return (
              <div key={item.id} className={css.wheelEntry} style={entryStyle}>
                <TaskbarItem
                  item={item}
                  mode={mode}
                  status={statusOf(item, mode, t)}
                  tabIndex={expanded ? 0 : -1}
                  onClick={() => { setWheelOpen(false); wheelToggleRef.current?.focus(); activate(item) }}
                />
              </div>
            )
          })}
        </div>
        <Tooltip label={expanded ? t('wheel.close') : t('wheel.open')} side="left" delayMs={500}>
          <button
            ref={wheelToggleRef}
            type="button"
            className={css.wheelToggle}
            aria-label={expanded ? t('wheel.close') : t('wheel.open')}
            aria-expanded={expanded}
            aria-controls="ui-sidebar-app-wheel-items"
            data-open={expanded}
            onClick={() => { setWheelOpen(open => !open) }}
          >
            <span className={css.wheelGlyph} aria-hidden="true">
              {expanded ? <IconCloseOutlineRegular /> : <IconAppsAddOutlineRegular />}
            </span>
          </button>
        </Tooltip>
      </div>
    )
  }

  return (
    <div
      className={css.dock}
      role="toolbar"
      aria-orientation="vertical"
      aria-label={t('dock.label')}
      data-taskbar-dock=""
      data-visible={visible && shown}
    >
      {state.items.map((item) => {
        const mode = itemMode(item, state.activePanelId)
        return (
          <TaskbarItem
            key={item.id}
            item={item}
            mode={mode}
            status={statusOf(item, mode, t)}
            onClick={() => { activate(item) }}
          />
        )
      })}
    </div>
  )
}
