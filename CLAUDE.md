# CLAUDE.md — @meddleware/walrus-storage-kit

## What this package is

A Vue 3 component library providing UI primitives for the Meddleware Walrus upload relay:
relay selection + tip estimation, NFT-gate access control (purchase CTA + ownership check),
and a blob-upload widget. Used by `@meddleware/walrus-storage-ui` (the standalone app) and by the
token-issuance app for image upload.

**Package name history:** published as `@meddleware/walrus-relay-ui`, then `@meddleware/walrus-relay` (v0.1.0), then renamed
`@meddleware/walrus-storage-kit` in the workspace naming convention (2026-10-23, `docs/architecture/ADR-0003-naming.md`).

## Gate config pinning (do not change)

`relayGateConfig(network, { gateId, soulbound })` builds every relay gate config. It takes the
`access_gate` package and the `PlatformConfig` shared object from
`@meddleware/access-gate-client/deployments`, generated from `access-gate-sui`'s published records.
The caller cannot pass them in. `useAccessGate({ network, gate, getClient })` enforces the same thing
for any config it is given (`assertPinnedGate`): the package, the `PlatformConfig` and the NFT type
(at the original id, matching `soulbound`) must equal the published deployment for `network`, or it
throws. The price, the payment recipient and the platform's share are not configured: they are read
from the `Gate` and `PlatformConfig` objects on the chain (`terms`) and shown before the wallet opens.

Do NOT:

- move these ids to env vars;
- add parameters that let operators override them;
- copy them into this repo;
- build the purchase from a price that was not read from the chain.

They change only when `access-gate-sui` publishes a new deployment record. Bump
`@meddleware/access-gate-client` to pick it up.

## Architectural invariants

- **No on-chain logic here — extend the domain client.** `suiBoundary()` from
  `@meddleware/eslint-config` (the last entry in `eslint.config.ts`) forbids, in `src/` outside
  `src/wallet.ts`: value imports of `@mysten/sui/{grpc,client,transactions}` (type-only imports are
  fine; `@mysten/sui/jsonRpc` is banned outright), building transactions and chain reads. URL
  bindings on native elements must go through `safeHref`, `safeIcon`, `suiExplorerUrl` or
  `walruscanBlobUrl`. Do not disable it — move the logic into the domain client instead.
- **No `@mysten/walrus` import.** This library must never import the Walrus wasm client
  directly. The Walrus upload flow is app-injected via the `performUpload` prop on
  `WalrusUpload`. This keeps the library free of wasm/wallet deps and preserves the
  lazy-load boundary — importing a widget never pulls the Walrus wasm chunk into the
  eager bundle.
- **No wallet dependency.** The library is wallet-agnostic. `purchase` accepts an injected
  `GateExecutor` and apps wire in their wallet adapters. Relay access for an upload (consume +
  signed proof, resumable) is `createGatedAccess` in `@meddleware/walrus-storage-client/flow`, fed this
  composable's `buildConsume`.
- **Upload conventions come from `@meddleware/walrus-storage-client/flow`.** `UploadProgress`,
  `UploadStepKey`, `BlobUploadResult`, `ExistingCopy`, `getCertifyRetry` and
  `getDuplicateExisting` are defined there and imported here. The stepper catalogue
  (`CORE_UPLOAD_STEPS`, `GATED_UPLOAD_STEPS`) is UI and stays here. Import only the `./flow`
  subpath, never the walrus-storage-client root, which pulls the wasm client.
- **No build step.** Ships TypeScript source directly (resolved by the consuming app's
  bundler via `"exports": { ".": { "default": "./src/index.ts" } }`).
- **Built from `@meddleware/ui` and the tokens, nothing else.** No local card, badge, button, stepper, spinner or notice CSS and no
  colour, size or radius literal (`tests/upload-parts.test.ts` fails on a hex colour or a hard-coded `id` in any SFC; stylelint
  enforces the tokens). `TipConfigBadge` is a `UiBadge` (tone from the relay's state; its symbol is `aria-hidden`), `AccessGateCta` a
  `UiCard`, the buttons `UiButton` (`busy` for work in flight), notices `UiNotice`, status text an always-mounted `UiLiveStatus`, the
  relay choice a `UiSegmentedControl`, the fields `UiTextField`/`UiCheckField`. Every id comes from `useId()`: two widgets in one page
  must not collide. `@meddleware/ui` and `@meddleware/design-tokens` are **peer** dependencies (the consuming app provides them and
  imports `tokens.css`, `seasons.css` and `@meddleware/ui/reset.css` once); the gallery does the same.
- **Modals use `@meddleware/ui`'s `UiDialog`.** The blocking progress dialog (`upload/UploadProgress.vue`) is
  `UiDialog :dismissible="false"` (native modal: page inert, focus kept inside — no hand-rolled
  focus trap); the duplicate-blob prompt (`upload/UploadDuplicateDialog.vue`) is a dismissible `UiDialog`. Do not reintroduce
  `div role="dialog"` overlays.
- **`WalrusUpload.vue` owns the state; `components/upload/*` are the parts.** `UploadFileStep`, `UploadStorageOptions` (duration +
  permanence), `UploadRelayStatus` (relay notes + choice), `UploadRecovery` (retry the upload / certify, no second payment),
  `UploadProgress`, `UploadDuplicateDialog`, `UploadHint`. A part takes props and `v-model`s and emits; it holds no upload logic.
  A session change (`sessionKey`, hosts, disconnect) invalidates a `createOperationScope` from web-utils, so an outcome that arrives
  afterwards is dropped.
- **`useGatedUpload(gate)` decides relay access for an upload.** `accessFor({ relayHost, publicHost, address, network, executor,
  sign, onStatus })` returns the `createGatedAccess` for a held pass, or `undefined` when none is needed (no gate, no pass, or the
  public relay: never spend a use there). Apps call it from `performUpload`; they do not rebuild the ports themselves.
- **People-facing text is plain; the cause goes to the console.** What a person reads (`termsError`, `purchaseError`, the invalid-relay badge
  and notice) says what to do ("This pass is not available right now. Try again in a moment, or contact the site.", "Uploads are
  unavailable right now."), never a gate id, an RPC message, a function name or "operator" (D117: Meddleware's own relay is "Meddleware
  relay"; spell Meddleware). The original error is logged once with `console.error`. Technical text belongs in the `Error` (or its `cause`)
  a developer sees, not in a string a template renders.
- **Composables over components.** `useWalrusRelay` and `useAccessGate` are the primary
  integration surface. The Vue components (`WalrusUpload`, `TipConfigBadge`, `AccessGateCta`)
  wire them together for common use cases; composables can be used directly for custom UIs.

## Layout and commands

```text
src/index.ts                        package entry: all public API
src/constants.ts                    `relayGateConfig` and `assertPinnedGate` (gate config pinned to the published deployment)
src/lib/relay.ts                    pure helpers (see below); src/lib/upload-steps.ts is the stepper catalogue
src/composables/useWalrusRelay.ts   relay selection, health probe, tip estimation
src/composables/useAccessGate.ts    NFT ownership check, purchase flow, consume builder
src/composables/useGatedUpload.ts   relay access for an upload
src/components/WalrusUpload.vue     upload widget (relay select + upload orchestration); components/upload/* are its parts
src/components/TipConfigBadge.vue   relay reachability + tip display badge
src/components/AccessGateCta.vue    "Purchase access" CTA for gated relays
```

`@meddleware/walrus-storage-ui` is the standalone SPA that consumes this library; this package is the pure library (no app entry point).

```bash
npm run type-check && npm run lint && npm test
npm run test:e2e   # real-browser axe contrast gate over gallery/, every theme x season (needs Chromium)
```

## Injection pattern for relay hosts

Operator relay URLs are NOT hardcoded here. They are passed by the consuming app via the
`hosts: WalrusRelayHosts` prop (`WalrusUpload`) or via composable arguments. The pattern is:

1. App reads `VITE_WALRUS_RELAY_TESTNET` / `VITE_WALRUS_RELAY_MAINNET` from env.
2. App passes `{ operator: OPERATOR_RELAY_HOSTS[network], public: PUBLIC_WALRUS_RELAY_HOSTS[network] }`
   to `WalrusUpload` (or `useWalrusRelay`).
3. The composable validates both hosts (https; plain http only on loopback) and throws otherwise,
   health-probes the operator relay (re-checking with backoff) and falls back to the public relay if
   unreachable.

## `lib/relay.ts` — pure module, no Vue

`parseTipFromConfig`, `probeRelay`, `walrusBlobUrl`, `WALRUS_AGGREGATOR_HOSTS`, `PUBLIC_WALRUS_RELAY_HOSTS` (the one copy of the
public relay addresses; the client's own constant lives in its root, which this package may not import) and
`MAX_SINGLE_RESERVATION_EPOCHS` live in `src/lib/relay.ts`. `formatCoinAmount`, `formatCoinExact`, `walruscanBlobUrl` and the body
reader behind `readBoundedJson` come from `@meddleware/web-utils` (re-exported, so this package's API is unchanged). This module has no Vue or
`@mysten/walrus` import — it's safe to consume from non-Vue contexts (e.g. the
token-issuance app's non-reactive utils).

## What operators CAN configure (via the consuming app's env vars)

| Env var (in the app) | Purpose |
| --- | --- |
| `VITE_WALRUS_RELAY_TESTNET` | Operator relay URL for testnet |
| `VITE_WALRUS_RELAY_MAINNET` | Operator relay URL for mainnet |
| `VITE_ACCESS_GATE_ID_{NET}` | Gate shared object ID |
| `VITE_ACCESS_GATE_SOULBOUND_{NET}` | Whether NFTs are soulbound |
| `VITE_UPLOAD_RELAY_MAX_TIP_MIST` | Max tip cap passed to `createWalrusClient` |

The package and `PlatformConfig` come from `relayGateConfig`; the price comes from the gate on the chain.
Operators configure everything else.

## Deferred: NFT picker for multi-NFT wallets

`useAccessGate` currently auto-selects the NFT with the fewest uses remaining (most-depleted
first). This is the right default when users hold at most one valid NFT per gate.

When multi-NFT wallets become common (e.g. users bulk-buying upload capacity), a picker UI
should be added so the user can see all held NFTs for the current gate (objectId, variant)
and explicitly select which one to consume. The composable already surfaces `nftId` reactively;
extending it to `nftIds: Ref<string[]>` and wiring a selection UI in `WalrusStorageView.vue` is the
implementation path. Until then, auto-selection is intentional.

Separately: preventing a user from holding more than one NFT per gate should be enforced
on-chain (a `max_per_address` field on the `Gate` struct) rather than in this UI layer, since
the gateway verifies the consume event, not the purchase count.

## Testing

Unit tests render the real `@meddleware/ui` (no stubs): Vitest processes the UI packages through Vite (`test.server.deps.inline:
inlineMeddleware` from `@meddleware/frontend-config/vitest`) and a test that opens a dialog calls `installDialogShim()` first.
`npm run test:e2e` builds the gallery and runs the shared sweep (`defineA11ySuite`: axe at WCAG 2.2 AA **and** AAA in 10 theme × season looks, reflow, 200% text, forced colours, reduced motion, keyboard) over every state in `e2e/a11y.spec.ts`; a state with nothing to operate is listed in `noKeyboard`;
`E2E_BROWSERS=all` adds Firefox, WebKit and two mobile profiles. `npm run shots` writes the screenshot matrix (`SHOTS_OUT`) for looking.

## What NOT to do

- Do not add a `configurePackageId()` function or any API that lets operators override
  the ids `relayGateConfig` takes from `deployments`.
- Do not sign a purchase for terms the user has not seen: `purchase` reads the terms again and
  refuses when they differ from the ones shown.
- Do not import `@mysten/walrus` — the Walrus client is app-injected via `performUpload`.
- Do not add wallet-standard imports — stay wallet-agnostic.
- Do not add a build step — the package ships source for consumers to bundle.
