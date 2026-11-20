import type { LauncherDefinition } from '../../contract/taskbar.ts'

export const neteaseMusicDefinition = {
  priority: 'builtin',
  item: {
    id: 'netease-music',
    label: '网易云音乐',
    kind: 'external',
    appId: 'cloudmusic',
    executablePath: 'cloudmusic.exe',
    launchUrl: 'orpheus://',
    order: 20,
    platforms: ['windows'],
  },
} satisfies LauncherDefinition
