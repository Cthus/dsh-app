// @vitest-environment jsdom
/**
 * 一个图标带三种模式：`work`（运行中，高亮）、`sleep`（可用但空闲）、`close`（当前平台
 * 不可用，点不动）；图标来自 Host 的可执行文件路由（外部应用）或面板的 MCP 服务
 * （内部面板），都取不到时回落到 id 首字母。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { TaskbarItem } from '../src/client/shell/TaskbarItem.tsx'
import type { TaskbarItemMode } from '../src/client/shell/TaskbarItem.tsx'
import type { InternalAppItem, LauncherItem } from '../src/client/contract/taskbar.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const EDGE: LauncherItem = {
  id: 'edge',
  label: 'Microsoft Edge',
  kind: 'external',
  executablePath: 'msedge.exe',
}

const MUSIC: InternalAppItem = {
  id: 'netease-music',
  label: '网易云音乐',
  kind: 'internal',
  panelId: 'netease-music',
}

/** 渲染一个图标并交出按钮。 */
function buttonOf(mode: TaskbarItemMode, item: LauncherItem = EDGE, status?: string): HTMLButtonElement {
  const { container } = render(<TaskbarItem item={item} mode={mode} status={status} onClick={() => {}} />)
  const button = container.querySelector('button')
  if (button === null) throw new Error('the launcher item renders a button')
  return button
}

it('marks the running mode as pressed and keeps it clickable', () => {
  const onClick = vi.fn()
  const { container } = render(<TaskbarItem item={EDGE} mode="work" onClick={onClick} />)
  const button = container.querySelector('button')
  if (button === null) throw new Error('the launcher item renders a button')

  expect(button.getAttribute('data-mode')).toBe('work')
  expect(button.getAttribute('aria-pressed')).toBe('true')
  expect(button.disabled).toBe(false)

  fireEvent.click(button)
  expect(onClick).toHaveBeenCalledTimes(1)
})

it('leaves the idle mode unpressed and clickable', () => {
  const button = buttonOf('sleep')

  expect(button.getAttribute('data-mode')).toBe('sleep')
  expect(button.getAttribute('aria-pressed')).toBe('false')
  expect(button.disabled).toBe(false)
})

it('renders the closed mode inert without dropping the icon label', () => {
  const onClick = vi.fn()
  const { container } = render(<TaskbarItem item={EDGE} mode="close" onClick={onClick} />)
  const button = container.querySelector('button')
  if (button === null) throw new Error('the launcher item renders a button')

  expect(button.getAttribute('data-mode')).toBe('close')
  expect(button.disabled).toBe(true)
  expect(button.getAttribute('aria-label')).toBe('Microsoft Edge')

  fireEvent.click(button)
  expect(onClick).not.toHaveBeenCalled()
})

describe('status mark', () => {
  it('draws a dot only for availability the user must notice', () => {
    const unsupported = render(<TaskbarItem item={{ ...MUSIC, availability: 'unsupported' }} mode="close" onClick={() => {}} />)
    expect(unsupported.container.querySelector('[data-status]')?.getAttribute('data-status')).toBe('unsupported')
    cleanup()

    const failed = render(<TaskbarItem item={{ ...MUSIC, availability: 'failed' }} mode="sleep" onClick={() => {}} />)
    expect(failed.container.querySelector('[data-status]')?.getAttribute('data-status')).toBe('failed')
    cleanup()

    // available 是默认态，画点只会变成满屏绿点。
    const available = render(<TaskbarItem item={{ ...MUSIC, availability: 'available' }} mode="sleep" onClick={() => {}} />)
    expect(available.container.querySelector('[data-status]')).toBeNull()
  })
})

describe('icon source', () => {
  /** 图标地址，没有图标时为 null。 */
  function imgOf(item: LauncherItem): string | null {
    const { container } = render(<TaskbarItem item={item} mode="sleep" onClick={() => {}} />)
    return container.querySelector('img')?.getAttribute('src') ?? null
  }

  /** 兜底字形。 */
  function fallbackTextOf(item: LauncherItem): string | undefined {
    const { container } = render(<TaskbarItem item={item} mode="sleep" onClick={() => {}} />)
    return container.querySelector('[data-icon-fallback]')?.textContent ?? undefined
  }

  it('routes an external application through the Host executable-icon route', () => {
    // 桌面应用的图标在可执行文件里，Host 按 app id 提取后经图标路由返回。
    expect(imgOf(EDGE)).toBe('open-in-app/icon/edge')
  })

  it('addresses the Host route by appId when the launcher carries one', () => {
    expect(imgOf({ ...EDGE, id: 'netease-music', appId: 'cloudmusic' })).toBe('open-in-app/icon/cloudmusic')
  })

  it('renders the MCP-provided icon of an internal panel', () => {
    expect(imgOf({ ...MUSIC, iconUrl: 'data:image/png;base64,AAAA' })).toBe('data:image/png;base64,AAAA')
    expect(imgOf({ ...MUSIC, iconUrl: 'http://127.0.0.1:8765/icon.png' })).toBe('http://127.0.0.1:8765/icon.png')
  })

  it('falls back to the id initial for an internal panel without an MCP icon', () => {
    expect(imgOf(MUSIC)).toBeNull()
    expect(fallbackTextOf(MUSIC)).toBe('N')
  })

  it('falls back to the id initial when the image fails to load', () => {
    const { container } = render(
      <TaskbarItem item={{ ...MUSIC, iconUrl: 'data:image/png;base64,broken' }} mode="sleep" onClick={() => {}} />,
    )
    const img = container.querySelector('img')
    if (img === null) throw new Error('the MCP icon renders an image first')

    fireEvent.error(img)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[data-icon-fallback]')?.textContent).toBe('N')
  })
})

describe('id initial fallback', () => {
  /** 兜底字形。 */
  function fallbackTextOf(item: LauncherItem): string | undefined {
    const { container } = render(<TaskbarItem item={item} mode="sleep" onClick={() => {}} />)
    return container.querySelector('[data-icon-fallback]')?.textContent ?? undefined
  }

  it('upper-cases the first letter of the id', () => {
    expect(fallbackTextOf(MUSIC)).toBe('N')
    expect(fallbackTextOf({ ...MUSIC, id: 'panel' })).toBe('P')
    expect(fallbackTextOf({ ...MUSIC, id: '  ' })).toBe('?')
  })
})
