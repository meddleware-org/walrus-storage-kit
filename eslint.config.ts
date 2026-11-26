// ESLint configuration (`npm run lint:js`): the shared Vue app configuration from `@meddleware/frontend-config`.
import { vueApp } from '@meddleware/frontend-config/eslint'

// The fleet's Vue + TypeScript + accessibility + browser-compat config, plus the chain boundary: this library holds no on-chain logic
// (it takes it from the domain clients) and must not import the Walrus wasm client.
// `name` labels this configuration in lint output; `sui: true` adds the chain-boundary rules (value imports of the Sui client, transaction building and
// chain reads are forbidden in src/ outside the wallet module).
export default vueApp({ name: 'walrus-storage-kit', sui: true })
