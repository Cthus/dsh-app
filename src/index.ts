/**
 * Node half of the App Dock plugin. The browser half in `src/client/` owns every
 * contribution; this entry exists so the package appears as an ordinary Loader
 * row and can be enabled or disabled without the Web client noticing a rebuild.
 * @module @deepseek-ai/dsh-client-ui-sidebar-app
 */

/** Loader-visible no-op body; the browser half carries the feature. */
export function apply(): void {}
