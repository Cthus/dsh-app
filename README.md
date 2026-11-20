# DSH App

App Dock plugin source for DeepSeek Harness. It adds a right-edge launcher on the
Session page, with an animated circular wheel when five or more apps are
registered.

This repository contains the plugin package only. It does not include or
redistribute the DeepSeek Harness host application. The plugin expects the
Harness services and packages declared in `package.json` and must be integrated
with a compatible DSH workspace to run.

## Features

- Shows the launcher on the Session page while the right sidebar is collapsed.
- Displays up to four app icons directly; five or more apps use an expandable
  circular wheel.
- Closes the wheel on Escape, outside click, or app activation.
- Ships no environment-specific app definitions. Extensions register launchers
  through `ctx.taskbar.register()`.

## Source layout

- `src/client/contract/taskbar.ts` defines launcher items, registration, state,
  service methods, and Cordis events.
- `src/client/app-registry.ts` merges definitions and applies platform ordering.
- `src/client/apps/` exports an empty default list; environment-specific apps
  belong in separate extensions.
- `src/client/taskbar/` handles platform selection and external app launching.
- `src/client/shell/` renders the dock and wheel with module-scoped styles.
- `skills/dsh-taskbar-app-injection/SKILL.md` documents adding launcher apps.

## License

MIT. See [LICENSE](LICENSE) for the copyright notice and terms.
