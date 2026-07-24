# Security Policy

## About this project

This is a personal, single-branch project (no version releases to track) —
`main` is always the current version. There isn't a matrix of supported
versions; security fixes land on `main` and get redeployed.

## Design principles that bound the attack surface

- **Non-custodial.** This app never holds, stores, or transmits a private
  key. Every swap, buy, sell, and transfer is signed by the user's own
  wallet extension (Phantom, Solflare, etc.) — the app can *build* a
  transaction but never signs or broadcasts anything without the wallet's
  own approval prompt.
- **Clear-signing previews.** Every transaction preview (see `README.md`)
  shows exact amounts, worst-case minimum received, price impact, slippage,
  route, and network fee before the user can confirm — nothing is a blind
  "sign this opaque blob" prompt.
- **No server-side secrets.** There is no backend, no database, and no API
  keys embedded in this app. The only configurable value
  (`NEXT_PUBLIC_SOLANA_RPC_URL`) is a public RPC endpoint URL, not a secret,
  and is validated before use (see `components/WalletProvider.tsx`) so a
  malformed value can't crash the deployment.
- **Client-only storage.** Contacts (`lib/contacts.ts`) and cost-basis
  tracking (`lib/positions.ts`) live in the browser's `localStorage` only —
  nothing is sent to any server. Both defensively validate their own parsed
  data on read, rather than trusting it's still well-formed.

## Known residual risk (dependency advisories)

*(Update: adding `vitest` as a test-runner devDependency briefly introduced
a critical advisory, GHSA-5xrq-8626-4rwp, affecting Vitest's UI/browser-mode
dev server — never used by this project (`npm test` runs `vitest run`,
never `--ui`), and a devDependency that's never shipped to production
regardless. It's fixed anyway: bumping to the latest stable `vitest@4.x`
resolved it along with the `esbuild`/`vite` chain it pulled in, verified
against the actual test run and full build before shipping.)

`npm audit` currently reports advisories in transitive dependencies pulled
in by `@solana/wallet-adapter-react` and `@solana/spl-token` (mobile wallet
adapter support, `bigint-buffer`, and an old `uuid` via `jayson` inside
`@solana/web3.js`'s Node-only RPC transport). These have been reviewed, not
just scanned:

- The `bigint-buffer` and `jayson`/`uuid` advisories were checked against
  the actual production build output (`.next/static`, `.next/server`) —
  neither the vulnerable function (`toBigIntLE`) nor `jayson` itself appears
  in anything actually shipped to the browser; they're dead-code-eliminated
  from the client bundle. No fix is currently published upstream for either.
- The Next.js advisories in the audit report concern Middleware, Server
  Actions, `next/image` `remotePatterns`, and i18n rewrites — this app uses
  none of those (verified: no `middleware.ts`, no `"use server"`, no
  `next/image`, no i18n config, no rewrites/redirects). Next.js is kept at
  the latest patch of its major version regardless.

This isn't "0 vulnerabilities" theater — it's a documented judgment call:
forcing `@solana/spl-token` down to a version old enough to have no
advisory would drop Token-2022 support this app actually needs, which is a
worse trade than an unreached code path. This section will be updated if
that calculus changes.

## Reporting a vulnerability

Please open a private report via GitHub's
[Security Advisories](../../security/advisories/new) for this repository
rather than a public issue. Include what you found and, if possible, steps
to reproduce. This is a side project maintained by one person, so response
time may vary, but reports will be read and taken seriously.
