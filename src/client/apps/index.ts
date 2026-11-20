import type { LauncherDefinition } from '../contract/taskbar.ts'

/** The plugin ships no environment-specific apps; extensions register their own launchers. */
export const DEFAULT_LAUNCHER_DEFINITIONS: readonly LauncherDefinition[] = []
