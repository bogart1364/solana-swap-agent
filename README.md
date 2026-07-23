# Trade Agent — Solana command console

A Next.js web app that lets you type plain-text commands (English or Persian)
to swap, buy, sell, and transfer tokens on Solana — plus a market scanner that
flags tokens showing early pump-like statistical signals, and a holdings
watcher that flags possible dump risk on what you already hold.

It's **non-custodial end to end**: your wallet (Phantom, Solflare, or any
Wallet-Standard wallet) holds the keys. This app never sees or stores a
private key, and every swap, buy, sell, or transfer previews first — nothing
is broadcast to the network until you type `confirm` and approve it in your
wallet extension. Swap routing comes from [Jupiter](https://jup.ag); market
data comes from [DexScreener](https://dexscreener.com)'s public API.

## ⚠️ Read this before using real funds

- **The "momentum score" is a heuristic, not a prediction.** It's built from
  public, point-in-time stats (volume/liquidity ratio, buy/sell imbalance,
  short-term price change, pair age). None of that can reliably tell you a
  token is about to pump — it can only tell you it's *already* showing
  activity, which is frequently late, and frequently fake (wash trading is
  cheap on low-liquidity pairs).
- **Low-liquidity Solana tokens are a common vector for rug pulls and
  honeypots.** The scanner flags liquidity risk, but a score is not a
  guarantee you'll be able to exit a position.
- **This is not financial advice**, and this code is a starting point, not an
  audited production trading system. Test with amounts you can afford to
  lose, and consider a real security audit before scaling up.

## How it works

1. Connect your wallet (top-right button).
2. Either type a command, or click a quick-action button in the Market
   Scanner / Holdings panels (which fills in the command for you):
   - `swap 0.1 SOL to USDC`
   - `buy 0.05 SOL of <token mint address>`
   - `sell all BONK for SOL`
   - `send 0.5 SOL to alice` (alice = a saved contact)
   - `سواپ 1 SOL به USDC` / `ارسال 0.5 SOL به علی`
3. The agent parses it and shows a **clear-signing preview** — exact amounts,
   minimum received after slippage, price impact, route, and network fee for
   swaps/buys/sells; amount + resolved recipient for a transfer. **Nothing is
   sent yet.**
4. Type `confirm` (or `تایید`) to build the transaction and sign it in your
   wallet, or type anything else to cancel.

## Dashboard panels

- **Console** — the command line described above. Every quote/transfer
  preview is a full clear-signing breakdown: what's being signed, exact
  in/out amounts, worst-case minimum received, price impact, slippage, and
  the network fee — never an opaque "confirm?" with no detail.
- **Market scanner** — polls DexScreener every ~45s for currently-boosted
  Solana tokens, scores each on liquidity, turnover, price momentum, and
  buy/sell pressure (shown as an emoji + colored 0–100 bar, not just a
  number), and lists the reasons behind the score. One click fills in a
  `buy` command for you. Each row also has a **"Check mint/freeze
  authority"** button — see "Safety check" below. An **auto-stage toggle**
  (off by default) will automatically prepare — never sign or send — a buy
  for the first token that clears both a high momentum bar *and* a clean
  on-chain safety check; you still have to type `confirm` yourself.
- **Your holdings** — reads your wallet's SPL token balances directly from
  chain, shows each one's current value in USD and SOL, and — for anything
  bought through this app — unrealized P&L in SOL terms. Raises an
  in-console alert if a token shows dump-risk signals (sharp 5m drop,
  sell-heavy flow, or a sudden liquidity pull), with a matching **auto-stage
  toggle** that prepares (not sends) a sell the same way. One click fills in
  a `sell all ... for SOL` command manually too.
- **Contacts** — save `name → address` pairs locally in your browser so you
  can `send` to a name instead of pasting an address every time.

## Safety check (on-chain, not a vibe score)

The momentum score in the Market scanner tells you what's getting attention
*right now* — it says nothing about whether the token is structurally safe
to hold. The **"Check mint/freeze authority"** button on each row
(`lib/rugcheck.ts`) reads the mint account directly from the chain and
checks the three things that most commonly turn a pump into a total loss:

- **Mint authority** — if it's not renounced (null), the team can create
  unlimited additional supply whenever they want.
- **Freeze authority** — if it's not renounced, the team can freeze any
  wallet's token account, including yours, making it unsellable.
- **Top-10 holder concentration** — what share of total supply sits in the
  10 largest accounts. High concentration is a red flag, but it can also
  just be the liquidity pool itself — the report says so explicitly rather
  than assuming the worst.

These combine into a 0–100 safety score shown as an emoji + colored bar (✅
green / ⚠️ yellow / 🚫 red) plus a plain-language list of flags. It supports
both the classic Token program and Token-2022. **This is still not a
guarantee** — a token with both authorities renounced and low concentration
can still be a bad trade for reasons this check can't see (social
engineering, an already-dumped chart, etc.). Use it to rule out the most
mechanical rug vectors, not as a green light.

## Auto-stage (still requires your signature)

Both the Market scanner and Your holdings panels have an "auto-stage"
toggle, off by default. When enabled:

- **Buys**: the first token that scores ≥80 momentum *and*, once checked,
  ≥70 on-chain safety gets a buy command run automatically, with a log line
  explaining exactly why ("scored X/100 momentum and Y/100 safety").
- **Sells**: a holding that trips the dump-risk check gets a `sell all`
  staged automatically, with the reasons logged.

In both cases, "staged" only means the same clear-signing quote preview
described above gets prepared and shown — it never signs or broadcasts
anything. You still have to type `confirm` and approve it in your wallet;
nothing is fully automatic. Each mint is only auto-staged once per browser
session, so it won't repeatedly re-suggest something you already dismissed.

## Supported command grammar

```
[swap|trade|exchange] <amount> <FROM> [to|for|into] <TO> [with X% slippage]
[buy|بخر] <amount> SOL [of] <TOKEN>            → shorthand for swap SOL → TOKEN
[sell|بفروش] <amount> <TOKEN>                   → shorthand for swap TOKEN → SOL
[send|transfer|ارسال|بفرست] <amount> [TOKEN] [to|به] <contact name or address>
```

`<TOKEN>` can be a symbol from `lib/tokens.ts` (SOL, USDC, USDT, JUP, BONK,
WIF, RAY, PYTH, mSOL) **or any raw SPL mint address** — decimals for unknown
mints are looked up on-chain automatically. Numbers accept Persian/Arabic-Indic
digits too (e.g. `۱.۵`).

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000. You'll need a Solana wallet browser extension
(Phantom, Solflare, or any Wallet-Standard-compatible wallet) installed to
connect and sign.

### Using your own RPC endpoint (do this before real trading — not optional)

The public `mainnet-beta` cluster endpoint used by default **frequently returns
403/429 to browser traffic** — this is the #1 cause of "quotes fail",
"holdings don't load", and "buy says unknown token" reports. The app now
shows a banner and clear error messages when this happens, but the real fix
is to configure your own endpoint:

1. Get a free RPC URL — e.g. sign up at https://helius.dev (free tier is
   enough for personal use), or QuickNode / Triton / Alchemy. **The value
   must start with `https://`** — pasting just the hostname (without the
   scheme) will make the app silently fall back to the public endpoint.
2. Local dev: copy `.env.example` to `.env.local` and set
   `NEXT_PUBLIC_SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=...`
3. On Vercel: Project → Settings → Environment Variables → add
   `NEXT_PUBLIC_SOLANA_RPC_URL` with the same value → **redeploy** (env var
   changes don't apply to already-built deployments).

### Jupiter API tier

Calls the free `lite-api.jup.ag` tier — no API key, but rate limited. For
higher volume, get a key at https://portal.jup.ag and switch the base URL /
add the `x-api-key` header in `lib/jupiter.ts`.

### DexScreener API tier

Calls the free, keyless public endpoints (`/token-boosts/*`, `/latest/dex/*`).
Rate limits are roughly 60 req/min on the boosts endpoints and 300 req/min on
pair lookups — comfortable for one browser polling every 30–45s, but don't
drop the poll intervals in `MarketScanner.tsx` / `PortfolioWatch.tsx` much
further without checking DexScreener's current terms.

## Project structure

```
app/
  layout.tsx           Root layout, wraps the app in the wallet provider
  page.tsx             Dashboard layout: console + scanner + holdings + contacts
  globals.css          Design tokens + all panel/console styles
components/
  WalletProvider.tsx   Wallet adapter setup (Phantom, Solflare, + Wallet Standard)
  ConsolePanel.tsx     The command line UI (dumb component, all logic in the hook)
  MarketScanner.tsx     "Tokens worth a look" list with scores + one-click buy + auto-stage
  PortfolioWatch.tsx    Your SPL holdings, value/P&L, dump-risk alerts + one-click sell
  ContactsPanel.tsx     Saved name → address book for transfers
  ScoreBar.tsx          Shared emoji + colored 0-100 bar (momentum and safety scores)
lib/
  useTradeAgent.ts      Core hook: parses commands, builds clear-signing previews, signs/sends
  parseCommand.ts       Free-text command parser (English + Persian)
  mint.ts               Resolves a symbol or raw mint address → mint + decimals
  jupiter.ts            Jupiter quote/swap API wrapper
  dexscreener.ts        Market data fetch + momentum scoring + dump-risk check + SOL price
  rugcheck.ts           On-chain mint/freeze authority + holder concentration check
  positions.ts          localStorage cost-basis ledger for the P&L display
  contacts.ts           localStorage-backed contact book
  tokens.ts             Curated symbol → mint address registry
```

## Security notes

- **Non-custodial by design.** The app only ever asks the connected wallet to
  sign; there's no server-side wallet, no private key storage, and no way to
  move funds without a signature you approve yourself.
- **Always read the preview before confirming.** Price impact, slippage, and
  the resolved recipient are shown before you type `confirm`.
- **Mainnet transactions are irreversible.** Test with small amounts first.
- New SPL-token recipients need an Associated Token Account; the transfer
  builder creates one automatically if the recipient doesn't have it yet
  (this costs a small amount of rent-exempt SOL from your wallet).
- **HTTP security headers** (`next.config.js`) are set on every response:
  a Content-Security-Policy, `X-Frame-Options: DENY` (no embedding this app
  in an iframe elsewhere), `X-Content-Type-Options: nosniff`, a strict
  `Referrer-Policy`, a locked-down `Permissions-Policy`, and HSTS. See the
  comments in `next.config.js` for the reasoning behind each CSP directive,
  and `SECURITY.md` for a from-first-principles look at dependency
  advisories (which ones actually reach the shipped bundle vs. which don't,
  verified against the real build output rather than assumed).
- **If you enable GitHub's Dependabot / secret scanning** for this repo
  (Settings → Code security and analysis — free for public repos, and
  worth turning on if you haven't): a scoped `Contents: Read and write`
  personal access token, like the kind used to push here, deliberately
  cannot change those settings itself. That's correct behavior, not a bug —
  flip them on manually.

## Extending it

- **Voice input**: add the Web Speech API (`SpeechRecognition`) in
  `ConsolePanel.tsx` to transcribe speech into the same command box — the
  parser already accepts free text, so nothing else needs to change.
- **More curated tokens**: add entries to `lib/tokens.ts`, though any mint
  address already works without this.
- **Smarter signals**: `scoreMomentum` in `lib/dexscreener.ts` is a simple,
  transparent heuristic on purpose — swap in holder-concentration data,
  social-mention velocity, or a real model if you want to go further.
- **Auto-alerts without a click**: `MarketScanner`/`PortfolioWatch` already
  poll in the background; wire their results into `pushLog("alert", ...)`
  proactively (not just on demand) if you want the console itself to ping
  you the moment a score crosses a threshold.
