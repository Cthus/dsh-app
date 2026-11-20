/**
 * 启动项注册表：往启动栏里加一个应用，只走这一条路。
 *
 * 一个启动项是「定义」，不是槽位注册：启动栏一个图标对应一条定义，谁知道自己怎么被
 * 唤起，谁就把定义交进来。注册表负责把同一个 `id` 上的多条定义归并成「在用的那一条」，
 * 并把平台过滤与次序交给装配点传进来的 {@link LauncherSelection} —— 于是外部包交来的
 * 定义与产品自带的定义走完全相同的判定。
 *
 * band 与标签页注册表同构：同一个 `id` 上可以同时有一条 `builtin` 和一条 `extension`，
 * 在用的是 `extension`，它注销后 `builtin` 复位；`fallback` 不与任何定义共用 `id`；
 * 同一个 band 里再注册一次是接线错误，直接抛错而不是悄悄覆盖。
 *
 * 生命周期跟着贡献者走：`register()` 把注册与注销放进本 fiber 的 `ctx.effect`，
 * 因此调用方在自己的 `ctx.effect` 里持有返回的注销函数，插件卸载即复位。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { LauncherDefinition, LauncherItem, LauncherPlatform, LauncherPriority } from './contract/taskbar.ts'

/** 每个 band 的优先级；数值大者在同一个 `id` 上接管。 */
const RANKS: Readonly<Record<LauncherPriority, number>> = {
  extension: 3,
  builtin: 2,
  fallback: 1,
}

/** 没有写明 band 的定义所在的 band：来自产品之外的包。 */
const DEFAULT_BAND: LauncherPriority = 'extension'

/** 一条已登记的定义。 */
interface Registered {
  readonly item: LauncherItem
  readonly band: LauncherPriority
  /** 注册顺序，`order` 相同时的最后一道裁决，也用于没有写 `order` 的项。 */
  readonly order: number
}

/**
 * 一个 `id` 上登记的全部定义：在用的那条，以及被它遮住的那条（只可能是 `builtin`）。
 * `id` 在 map 里存在就一定有在用的定义，因此查表永远有答案。
 */
interface IdSlot {
  inForce: Registered
  shadowed: Registered | undefined
}

/**
 * 两个 band 能否共存于同一个 `id`：一条 `extension` 与一条 `builtin` 可以配对一次，
 * `fallback` 谁也不让。
 */
function coexists(slot: IdSlot, band: LauncherPriority): boolean {
  return band !== 'fallback' && slot.inForce.band !== 'fallback' && slot.inForce.band !== band && slot.shadowed === undefined
}

/**
 * 把「直接给一个启动项」与「给一条定义」统一成定义。
 * @param definition - 调用方交来的形状。
 * @returns 带上 `priority` 字段（可能为 undefined）的定义。
 */
function asDefinition(definition: LauncherDefinition | LauncherItem): LauncherDefinition {
  return 'item' in definition ? definition : { item: definition }
}

/**
 * 平台与次序策略：拿到一组定义，交出该显示的那些、按图标次序排好。
 *
 * 声明成端口而不是在本文件里写死，是为了让「哪些项该出现、谁在前」这条纯规则留在
 * `taskbar/platform.ts`（它一直是这条规则的家），注册表只管归并定义。
 * @param items - 在用的定义，按注册顺序。
 * @param platform - 当前平台。
 * @returns 该显示的启动项，按图标次序。
 */
export type LauncherSelection = (items: readonly LauncherItem[], platform: LauncherPlatform) => readonly LauncherItem[]


/**
 * 已登记的启动项。
 *
 * 注册顺序是契约的一部分：它决定 `order` 相同的两项谁在前，也决定没写 `order` 的项
 * 之间的先后。
 */
export class LauncherRegistry {
  private readonly slots = new Map<string, IdSlot>()
  private readonly listeners = new Set<() => void>()
  private registrations = 0
  private cached: readonly LauncherItem[] = []

  /**
   * @param ctx - 拥有这些注册的 Context；注销随它一起结束。
   * @param platform - 当前平台，交给 `select` 判断哪些项该出现。
   * @param select - 平台过滤与次序规则，生产环境是 `filterLauncherItems`。
   */
  constructor(
    private readonly ctx: Context,
    private readonly platform: LauncherPlatform,
    private readonly select: LauncherSelection,
  ) {}

  /**
   * 注册一条启动项，活在调用方的 fiber 里。
   * @param definition - 启动项定义，或直接给一个启动项（按 `extension` 处理）。
   * @returns 幂等注销函数。
   * @throws 当 `id` 为空，或该 band 已被占用（同名同 band 的第二次注册）。
   */
  register(definition: LauncherDefinition | LauncherItem): () => void {
    const { item, priority } = asDefinition(definition)
    const id = item.id
    if (id.trim() === '') throw new Error('sidebarApp: a launcher definition needs a non-empty id')
    const band = priority ?? DEFAULT_BAND
    const held = this.slots.get(id)
    if (held !== undefined && !coexists(held, band)) {
      throw new Error(`sidebarApp: launcher "${id}" is already registered (${held.inForce.band})`)
    }
    this.registrations += 1
    const entry: Registered = { item, band, order: this.registrations }
    const dispose = this.ctx.effect(() => {
      const slot = this.enter(id, entry)
      this.refresh()
      return () => {
        this.leave(id, slot, entry)
        this.refresh()
      }
    }, `sidebarApp.launchers.register(${JSON.stringify(id)})`)
    return () => { void dispose() }
  }

  /**
   * 把一条登记放进它的 `id` 槽位，高 band 在用的那条在上；共存条件已由 `coexists` 放行。
   * @param id - 启动项标识。
   * @param entry - 本次登记。
   * @returns 该 `id` 的槽位，注销时按它判断该退到哪一条。
   */
  private enter(id: string, entry: Registered): IdSlot {
    const held = this.slots.get(id)
    if (held === undefined) {
      const slot: IdSlot = { inForce: entry, shadowed: undefined }
      this.slots.set(id, slot)
      return slot
    }
    if (RANKS[entry.band] > RANKS[held.inForce.band]) {
      held.shadowed = held.inForce
      held.inForce = entry
    } else {
      held.shadowed = entry
    }
    return held
  }

  /**
   * 把一条登记从它的槽位移除：被遮住的 `builtin` 复位，槽位空了就释放。
   * @param id - 启动项标识。
   * @param slot - 注册时拿到的槽位。
   * @param entry - 要移除的登记。
   */
  private leave(id: string, slot: IdSlot, entry: Registered): void {
    if (slot.inForce !== entry) {
      slot.shadowed = undefined
    } else if (slot.shadowed === undefined) {
      this.slots.delete(id)
    } else {
      slot.inForce = slot.shadowed
      slot.shadowed = undefined
    }
  }

  /**
   * 当前平台该显示的全部启动项，已按 `order` 排好。
   * @returns 引用稳定的数组：注册表没变就还是同一个引用。
   */
  entries(): readonly LauncherItem[] {
    return this.cached
  }

  /**
   * 按 `id` 取在用的定义。
   * @param id - 启动项标识。
   * @returns 在用的启动项，没有登记过时为 undefined。
   */
  get(id: string): LauncherItem | undefined {
    return this.slots.get(id)?.inForce.item
  }

  /**
   * 观察注册表变化（低频：一次注册或注销）。
   * @param listener - 同步失效回调。
   * @returns 取消订阅。
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 重算缓存并通知观察者；每次注册/注销后调用一次。 */
  private refresh(): void {
    const active = [...this.slots.values()]
      .map(slot => slot.inForce)
      .sort((left, right) => left.order - right.order)
      .map(entry => entry.item)
    this.cached = this.select(active, this.platform)
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('LauncherRegistry listener error:', error)
      }
    }
  }
}
