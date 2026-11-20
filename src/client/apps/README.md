# App definitions

The App Dock ships no environment-specific launchers. An extension registers a
launcher through `ctx.taskbar.register()` and owns its application settings and
platform support.

```ts
ctx.taskbar.register({
  priority: 'extension',
  item: {
    id: 'my-app',
    label: 'My app',
    kind: 'external',
    executablePath: 'my-app',
    launchUrl: 'my-app://',
  },
})
```
