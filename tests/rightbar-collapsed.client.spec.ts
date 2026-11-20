// @vitest-environment jsdom
/**
 * 显隐判据：帧与面板各打一个标记，谁说了算。
 *
 * 判据只有一处（`shell/rightbar-collapsed.ts`），因此每一条分支都在这里钉住：
 * - 两个标记都没有 —— 右栏还开着，启动栏不出现；
 * - 只有帧标记 —— 收起；
 * - 面板标记在 —— 面板正画着，谈不上收起（浮窗呈现时帧标记仍在，这一条是分水岭）。
 *
 * 观察器只负责「有变化就叫一声」，因此另外钉住三件事：装上时先给一次当前值、
 * 同一帧内的多次变化只回调一次、释放后不再回调也不再持有帧。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeRightbarCollapsed, readRightbarCollapsed } from '../src/client/shell/rightbar-collapsed.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

/** 把帧调度握在手里：`flush()` 就是「这一帧到了」。 */
function frames(): {
  readonly pending: Map<number, FrameRequestCallback>
  readonly cancelled: number[]
  flush(): void
} {
  const pending = new Map<number, FrameRequestCallback>()
  const cancelled: number[] = []
  let next = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    next += 1
    pending.set(next, callback)
    return next
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    cancelled.push(id)
    pending.delete(id)
  })
  return {
    pending,
    cancelled,
    flush: () => {
      const callbacks = [...pending.values()]
      pending.clear()
      for (const callback of callbacks) callback(0)
    },
  }
}

/** 在文档里挂一个标记元素，返回它本身。 */
function mark(attribute: string): HTMLElement {
  const element = document.createElement('div')
  element.setAttribute(attribute, '')
  document.body.append(element)
  return element
}

/** 让 MutationObserver 的投递跑完（jsdom 用微任务送）。 */
const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

describe('readRightbarCollapsed', () => {
  it('answers false while neither marker is drawn', () => {
    expect(readRightbarCollapsed(document)).toBe(false)
  })

  it('answers true when the frame reports a zero-width right column', () => {
    mark('data-rightbar-collapsed')
    expect(readRightbarCollapsed(document)).toBe(true)
  })

  it('answers false as soon as the panel draws itself, even with the frame marker still there', () => {
    // 浮窗呈现：右栏宽度仍是 0，帧标记还在，只有面板自己的标记能说明它正画着。
    mark('data-rightbar-collapsed')
    mark('data-sidebar-right-open')
    expect(readRightbarCollapsed(document)).toBe(false)
  })

  it('answers false when only the panel marker is drawn', () => {
    mark('data-sidebar-right-open')
    expect(readRightbarCollapsed(document)).toBe(false)
  })
})

describe('observeRightbarCollapsed', () => {
  it('publishes the current answer before any change arrives', () => {
    const frame = frames()
    mark('data-rightbar-collapsed')
    const publish = vi.fn()

    const release = observeRightbarCollapsed(document, publish)

    expect(publish).toHaveBeenCalledExactlyOnceWith(true)
    // 立即回调不等于「已经排了一帧」：装上的那一刻没有待执行的调度。
    expect(frame.pending.size).toBe(0)
    release()
  })

  it('coalesces every change within one frame into a single callback', async () => {
    const frame = frames()
    const publish = vi.fn()
    const release = observeRightbarCollapsed(document, publish)
    expect(publish).toHaveBeenLastCalledWith(false)

    const collapsed = mark('data-rightbar-collapsed')
    await settle()
    expect(frame.pending.size).toBe(1)

    // 同一帧里的第二次变化：已经排过帧了，不再排第二帧。
    collapsed.remove()
    await settle()
    expect(frame.pending.size).toBe(1)

    frame.flush()
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenLastCalledWith(false)
    release()
  })

  it('drops the pending frame and stops observing on release', async () => {
    const frame = frames()
    const publish = vi.fn()
    const release = observeRightbarCollapsed(document, publish)

    mark('data-rightbar-collapsed')
    await settle()
    expect(frame.pending.size).toBe(1)

    release()
    expect(frame.cancelled).toHaveLength(1)
    expect(frame.pending.size).toBe(0)

    // 观察器已经断开：再改文档不会排帧，也不会回调。
    document.body.replaceChildren()
    await settle()
    expect(frame.pending.size).toBe(0)
    expect(publish).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('cancels nothing when released with no frame in flight', () => {
    const frame = frames()
    const release = observeRightbarCollapsed(document, vi.fn())

    release()

    expect(frame.cancelled).toEqual([])
  })

  it('falls back to a microtask when the environment schedules no frames', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    const publish = vi.fn()
    const release = observeRightbarCollapsed(document, publish)

    mark('data-rightbar-collapsed')
    await settle()

    expect(publish).toHaveBeenLastCalledWith(true)
    release()
  })
})
