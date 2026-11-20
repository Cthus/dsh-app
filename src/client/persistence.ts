/**
 * 启动栏唯一跨会话存活的事实：用户把这一列开着还是关掉。
 *
 * 其余状态都不落盘，理由各自不同：`activePanelId` 是布局服务的事实，刷新后由它重新
 * 推回来；`availability` 与 `iconUrl` 是运行时答案（Host 解析结果、MCP 服务连上后
 * 回传的图标），存下来只会在下次启动时显示一个已经不成立的图标或红点。
 *
 * 载荷带版本后缀，形状一变就换 key，旧值自然失效；读到不合法的内容直接清掉并当作
 * 「没存过」，绝不让一段脏 JSON 决定启动栏是否出现。
 */

/** 持久化命名空间；版本后缀让形状变更时旧值自动作废。 */
export const dockPersistence = 'dsh.sidebar-app.v1'

/** 注册表之前那一版启动栏用过的键，只在没有新值时读一次，保证用户的选择不被这次重写抹掉。 */
const legacyVisibleKey = 'dsh.taskbar.visible'

/** 落盘的那点偏好。 */
export interface DockPreferences {
  readonly visible: boolean
}

/**
 * 读取已存的偏好。
 * @returns 校验通过的偏好；没有、不可读或内容不合法时为 undefined。
 */
export function readDockPreferences(): DockPreferences | undefined {
  if (typeof localStorage === 'undefined') return undefined
  const legacy = readLegacyVisible()
  let raw: string | null
  try {
    raw = localStorage.getItem(dockPersistence)
  } catch (_storageUnavailable) {
    // 隐私模式下 getItem 也可能抛：退回旧键，再不行就当没存过。
    return legacy
  }
  if (raw === null) return legacy
  const saved = parsePreferences(raw)
  if (saved === undefined) {
    clearDockPreferences()
    return legacy
  }
  return saved
}

/**
 * 写入偏好；存储不可用时静默降级，不影响本次会话的显隐。
 * @param preferences - 当前偏好。
 */
export function writeDockPreferences(preferences: DockPreferences): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(dockPersistence, JSON.stringify({ visible: preferences.visible }))
  } catch (error) {
    console.error('App dock preference persistence failed:', error)
  }
}

/** 清掉本命名空间与旧键：读到脏值时用，用户重置时也用。 */
export function clearDockPreferences(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(dockPersistence)
    localStorage.removeItem(legacyVisibleKey)
  } catch (_storageUnavailable) {
    // 清不掉也不影响本次会话：脏值已经被排除在使用之外。
  }
}

/**
 * 校验一段 JSON。
 * @param raw - 存储里的原文。
 * @returns 只有 `visible` 明确是布尔值才算数。
 */
function parsePreferences(raw: string): DockPreferences | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (_invalidJson) {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const visible = (value as { visible?: unknown }).visible
  return typeof visible === 'boolean' ? { visible } : undefined
}

/**
 * 读注册表之前的显隐键（裸 `'true'` / `'false'`）。
 * @returns 认得的旧值，其余（含脏值）为 undefined。
 */
function readLegacyVisible(): DockPreferences | undefined {
  try {
    const saved = localStorage.getItem(legacyVisibleKey)
    if (saved === 'true') return { visible: true }
    if (saved === 'false') return { visible: false }
    return undefined
  } catch (_storageUnavailable) {
    return undefined
  }
}
