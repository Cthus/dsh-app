/**
 * 启动栏唯一的显隐判据：右侧那根栏是不是收起的。
 *
 * 这件事在布局服务里没有出口 —— 帧只把结论画成标记，不把它发布成服务：
 * - `data-rightbar-collapsed`：帧在右栏宽度为 0 时打在帧上（`cols.rightbar === 0`）；
 * - `data-sidebar-right-open`：面板自己展开时打在面板上。
 *
 * 面板那一条优先：面板正在画就谈不上「收起」。浮窗呈现时右栏宽度仍是 0、帧上的标记
 * 也还在，只看帧会把浮窗当成收起 —— 旧的样式表用 `body:has(...)` 补了这一刀，现在
 * 判据只有一处，这一刀必须在这里。
 *
 * 两者都不是 CSS Module 类名（编译后是哈希，`.frame` 永远匹配不到），所以这里只认属性。
 *
 * 观察放在装配点而不是组件里：组件不该自带订阅机器，事实以 observable 的形式经注入面
 * 交给它。流式输出时 childList 投递极频繁，而两个判据都是全文档扫描，因此用一帧一次
 * 的合并把成本压到「每帧至多两次 querySelector」。
 */

/**
 * 读一次当前结论。
 * @param document - 产品文档；帧与面板都在它里面。
 * @returns true 表示右栏收起且没有面板在画，启动栏该出现。
 */
export function readRightbarCollapsed(document: Document): boolean {
  if (document.querySelector('[data-sidebar-right-open]') !== null) return false
  return document.querySelector('[data-rightbar-collapsed]') !== null
}

/**
 * 观察结论变化，并立即回调一次当前值。
 * @param document - 产品文档，监听器随它存活。
 * @param publish - 结论变化时的回调；同一帧内多次变化只回调一次。
 * @returns 释放监听器与未执行的那一帧。
 */
export function observeRightbarCollapsed(document: Document, publish: (collapsed: boolean) => void): () => void {
  let queued = false
  let frame: number | undefined
  const flush = (): void => {
    queued = false
    frame = undefined
    publish(readRightbarCollapsed(document))
  }
  const schedule = (): void => {
    if (queued) return
    queued = true
    if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(flush)
    else queueMicrotask(flush)
  }
  // 先给一次当前值：观察器装上之前就已经画好的帧不必等下一次变化。
  publish(readRightbarCollapsed(document))
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, {
    attributes: true,
    subtree: true,
    attributeFilter: ['data-rightbar-collapsed', 'data-sidebar-right-open'],
    childList: true,
  })
  return () => {
    observer.disconnect()
    if (frame !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    queued = false
  }
}
