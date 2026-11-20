// @vitest-environment jsdom
/**
 * 启动栏的显隐由 Session 主视图、右栏是否收起（`useRightbarCollapsed`）与用户是否把
 * 它打开（`state.visible`）决定。组件不读 DOM、不订阅 —— 这些输入都以
 * observable 的形式到达组件，因此这里用真实快照库当来源。
 *
 * 判据本身（哪个 DOM 标记算「收起」）由 `rightbar-collapsed.client.spec.ts` 钉住。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { TaskbarDock } from '../src/client/shell/TaskbarDock.tsx'
import type { TaskbarDockProps } from '../src/client/shell/TaskbarDock.tsx'
import type { LauncherItem, TaskbarState } from '../src/client/contract/taskbar.ts'

const EDGE: LauncherItem = {
  id: 'edge',
  label: 'Microsoft Edge',
  kind: 'external',
  executablePath: 'msedge.exe',
}

const MUSIC: LauncherItem = {
  id: 'netease-music',
  label: '网易云音乐',
  kind: 'internal',
  panelId: 'netease-music',
}

afterEach(() => {
  cleanup()
})

/** 测试本地选择器 Hook：把一个框架无关的快照源包成组件拿到的那种 Hook。 */
function hookOf<T>(source: { getSnapshot: () => T; subscribe: (fn: () => void) => () => void }) {
  return function useSelector<S>(select: (state: T) => S): S {
    return select(useSyncExternalStore(source.subscribe, source.getSnapshot))
  }
}

/** 用两个快照库当注入面，渲染真正的组件。 */
function mount(state: TaskbarState, collapsed: boolean, activate = vi.fn()) {
  const taskbar = createSnapshotStore<TaskbarState>(state)
  const gate = createSnapshotStore<boolean>(collapsed)
  const panelInfo = createSnapshotStore({ activePanelId: state.activePanelId })
  const props = {
    useTaskbar: hookOf(taskbar),
    useRightbarCollapsed: hookOf(gate),
    usePanelInfo: hookOf(panelInfo),
    activate,
    t: (key: string) => key,
  } as unknown as TaskbarDockProps
  const view = render(<TaskbarDock {...props} />)
  return { ...view, taskbar, gate, activate }
}

/** 显隐门的 DOM 标记。 */
function dockOf(container: HTMLElement): Element | null {
  return container.querySelector('[data-taskbar-dock]')
}

/** 每个图标的可访问名。 */
function labelsOf(container: HTMLElement): readonly (string | null)[] {
  return [...container.querySelectorAll('button')].map(button => button.getAttribute('aria-label'))
}

/** 一条状态快照。 */
function stateOf(items: readonly LauncherItem[], extra: Partial<TaskbarState> = {}): TaskbarState {
  return { visible: true, activePanelId: null, items, ...extra }
}

describe('taskbar dock visibility', () => {
  it('stays hidden while the right column is expanded', () => {
    const { container } = mount(stateOf([EDGE]), false)

    expect(dockOf(container)).toBeNull()
  })

  it('renders every launcher once the right column is collapsed', () => {
    const { container } = mount(stateOf([EDGE, MUSIC]), true)

    expect(dockOf(container)).not.toBeNull()
    expect(labelsOf(container)).toEqual(['Microsoft Edge', '网易云音乐'])

    // 外部应用的图标走 Host 的 exe 图标路由，而不是 MCP 回传的 iconUrl
    expect(container.querySelector('img')?.getAttribute('src')).toBe('open-in-app/icon/edge')
  })

  it('follows the column opening and closing after mount', async () => {
    const { container, gate } = mount(stateOf([EDGE]), true)
    expect(dockOf(container)).not.toBeNull()

    await act(async () => { gate.set(false) })
    expect(dockOf(container)).toBeNull()

    await act(async () => { gate.set(true) })
    expect(dockOf(container)).not.toBeNull()
  })

  it('renders nothing while the user has switched the dock off', async () => {
    const { container, taskbar } = mount(stateOf([EDGE]), true)
    expect(dockOf(container)).not.toBeNull()

    await act(async () => { taskbar.set(stateOf([EDGE], { visible: false })) })
    expect(dockOf(container)).toBeNull()
  })

  it('hides the launcher while a global panel is selected', () => {
    const { container } = mount(stateOf([EDGE, MUSIC], { activePanelId: MUSIC.panelId }), true)

    expect(dockOf(container)).toBeNull()
  })

  it('renders an unsupported launcher inert', () => {
    const { container } = mount(stateOf([{ ...MUSIC, availability: 'unsupported' }]), true)
    const button = container.querySelector('button')

    expect(button?.getAttribute('data-mode')).toBe('close')
    expect(button?.disabled).toBe(true)
  })

  it('reports the clicked launcher and nothing else', () => {
    const { container, activate } = mount(stateOf([EDGE, MUSIC]), true)
    const button = container.querySelectorAll('button')[1]
    if (button === null || button === undefined) throw new Error('the dock renders one button per launcher')

    fireEvent.click(button)

    expect(activate).toHaveBeenCalledExactlyOnceWith(MUSIC)
  })
})
