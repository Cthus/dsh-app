import type { LauncherDefinition } from '../contract/taskbar.ts'
import { edgeDefinition } from './edge/index.ts'
import { neteaseMusicDefinition } from './netease-music/index.ts'

/** Built-in launcher contributions in registration order. */
export const DEFAULT_LAUNCHER_DEFINITIONS: readonly LauncherDefinition[] = [
  edgeDefinition,
  neteaseMusicDefinition,
]
