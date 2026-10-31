import { vueApp } from '@meddleware/frontend-config/eslint'

// The fleet's Vue + TypeScript + accessibility + browser-compat config, plus the chain boundary: this library holds no on-chain logic
// (it takes it from the domain clients) and must not import the Walrus wasm client.
export default vueApp({ name: 'walrus-storage-kit', sui: true })
