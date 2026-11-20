import type { LauncherDefinition } from '../../contract/taskbar.ts'

export const edgeDefinition = {
  priority: 'builtin',
  item: {
    id: 'edge',
    label: 'Microsoft Edge',
    kind: 'external',
    appId: 'edge',
    executablePath: 'msedge.exe',
    launchUrl: 'microsoft-edge:newtab',
    protocolOnly: true,
    order: 10,
    platforms: ['windows'],
  },
} satisfies LauncherDefinition
