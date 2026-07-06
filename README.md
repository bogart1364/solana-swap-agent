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
3. The agent parses it and shows a preview — a live Jupiter quote for
   swaps/buys/sells, or the amount + resolved recipient for a transfer.
   **Nothing is sent yet.**
4. Type `confirm` (or `تایید`) to build the transaction and sign it in your
   wallet, or type anything else to cancel.

## Dashboard panels

- **Console** — the command line described above.
- **Market scanner** — polls DexScreener every ~45s for currently-boosted
  Solana tokens, scores each on liquidity, turnover, price momentum, and
  buy/sell pressure, and lists them with the reasons behind the score. One
  click fills in a `buy` command for you.
- **Your holdings** — reads your wallet's SPL token balances directly from
  chain, checks each against DexScreener, and raises an in-console alert if
  a token you hold shows dump-risk signals (sharp 5m drop, sell-heavy flow,
  or a sudden liquidity pull). One click fills in a `sell all ... for SOL`
  command.
- **Contacts** — save `name → address` pairs locally in your browser so you
  can `send` to a name instead of pasting an address every time.

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

### Using your own RPC endpoint (recommended before real trading)

Copy `.env.example` to `.env.local` and set:

```
NEXT_PUBLIC_SOLANA_RPC_URL=https://your-provider.example.com/your-key
```

The public `mainnet-beta` cluster endpoint used by default is heavily rate
limited and can fail under real usage, and reading your token balances every
30s (for the holdings watcher) adds up quickly. Get a free/paid endpoint from
QuickNode, Helius, Triton, or Alchemy.

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
  MarketScanner.tsx     "Tokens worth a look" list with scores + one-click buy
  PortfolioWatch.tsx    Your SPL holdings + dump-risk alerts + one-click sell
  ContactsPanel.tsx     Saved name → address book for transfers
lib/
  useTradeAgent.ts      Core hook: parses commands, builds/signs/sends transactions
  parseCommand.ts       Free-text command parser (English + Persian)
  mint.ts               Resolves a symbol or raw mint address → mint + decimals
  jupiter.ts            Jupiter quote/swap API wrapper
  dexscreener.ts        Market data fetch + momentum scoring + dump-risk check
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
