// Ambient types for the TypeScript build: Vite's client types, and a module declaration so that `import X from './X.vue'` type-checks.
/// <reference types="vite/client" />

// Any `.vue` file is a component whose props and emits are not statically known here.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
