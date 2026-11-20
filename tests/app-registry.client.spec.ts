/**
 * 注册表：同一个 `id` 上的多条定义怎么归并，以及平台与次序怎么决定图标列表。
 *
 * band 的规则是契约 —— 外部包靠它接管某个应用、并在卸载时把手里的 `id` 交还 ——
 * 因此每一条都单独钉住，而不是靠一条「大」用例顺带覆盖。
 */
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LauncherRegistry } from '../src/client/app-registry.ts'
import { filterLauncherItems } from '../src/client/taskbar/platform.ts'
import type { InternalAppItem, LauncherDefinition, LauncherPlatform } from '../src/client/contract/taskbar.ts'

/** 一条内部启动项，`panelId` 与 `id` 相同。 */
function panel(id: string, extra: Partial<InternalAppItem> = {}): InternalAppItem {
  return { id, label: id, kind: 'internal', panelId: id, ...extra }
}

/**
 * 造一个注册表。
 * @param platform - 目标平台，默认 windows。
 * @returns 新的注册表。
 */
function registryOf(platform: LauncherPlatform = 'windows'): LauncherRegistry {
  return new LauncherRegistry(new Context(), platform, filterLauncherItems)
}

/** 列表里的 id，按图标次序。 */
function ids(registry: LauncherRegistry): string[] {
  return registry.entries().map(item => item.id)
}

it('lists launchers in registration order when none declares an order', () => {
  const registry = registryOf()
  registry.register(panel('b'))
  registry.register(panel('a'))

  expect(ids(registry)).toEqual(['b', 'a'])
})

it('sorts by order, leaving unordered launchers after the ordered ones in registration order', () => {
  const registry = registryOf()
  registry.register(panel('late'))
  registry.register(panel('second', { order: 20 }))
  registry.register(panel('also-late'))
  registry.register(panel('first', { order: 10 }))

  expect(ids(registry)).toEqual(['first', 'second', 'late', 'also-late'])
})

it('filters by platform and keeps the registration order as the tiebreaker', () => {
  const registry = registryOf('windows')
  registry.register(panel('everywhere'))
  registry.register(panel('win', { platforms: ['windows'] }))
  registry.register(panel('mac', { platforms: ['macos'] }))

  expect(ids(registry)).toEqual(['everywhere', 'win'])
})

it('lets an extension take an id over and hands it back when it unregisters', () => {
  const registry = registryOf()
  const builtin: LauncherDefinition = { item: panel('music', { label: '自带' }), priority: 'builtin' }
  const extension: LauncherDefinition = { item: panel('music', { label: '插件' }), priority: 'extension' }

  registry.register(builtin)
  const dispose = registry.register(extension)

  expect(registry.get('music')?.label).toBe('插件')
  expect(registry.entries()).toHaveLength(1)

  dispose()

  expect(registry.get('music')?.label).toBe('自带')
})

it('rejects a second registration in the same band, and any sharing with a fallback', () => {
  const registry = registryOf()
  registry.register({ item: panel('music'), priority: 'builtin' })

  expect(() => registry.register({ item: panel('music'), priority: 'builtin' }))
    .toThrow('launcher "music" is already registered (builtin)')

  const fallback = registryOf()
  fallback.register({ item: panel('music'), priority: 'fallback' })
  expect(() => fallback.register({ item: panel('music'), priority: 'extension' }))
    .toThrow('launcher "music" is already registered (fallback)')
})

it('rejects a launcher without an id', () => {
  expect(() => registryOf().register(panel('  '))).toThrow('needs a non-empty id')
})

it('notifies observers on registration and on removal', () => {
  const registry = registryOf()
  const seen = vi.fn()
  registry.subscribe(seen)

  const dispose = registry.register(panel('music'))
  expect(seen).toHaveBeenCalledTimes(1)

  dispose()
  expect(seen).toHaveBeenCalledTimes(2)
  expect(registry.entries()).toEqual([])
})

it('returns the same array until the registration set changes', () => {
  const registry = registryOf()
  registry.register(panel('music'))

  const first = registry.entries()
  expect(registry.entries()).toBe(first)

  registry.register(panel('edge'))
  expect(registry.entries()).not.toBe(first)
})
