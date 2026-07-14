"use client";

import { useMemo } from "react";
import { Buffer } from "buffer";

// @solana/web3.js and the wallet adapters expect a global `Buffer`, which
// Node has but browsers don't. Polyfill it once, client-side only.
if (typeof window !== "undefined" && !(window as any).Buffer) {
  (window as any).Buffer = Buffer;
}
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl } from "@solana/web3.js";

import "@solana/wallet-adapter-react-ui/styles.css";

// Set NEXT_PUBLIC_SOLANA_RPC_URL to your own RPC endpoint (QuickNode, Helius, Triton, etc.)
// for production use — the public cluster endpoint is rate limited.
//
// This is validated defensively because a malformed value here (missing
// "https://", stray whitespace/quotes from pasting into a dashboard env var
// field, etc.) would otherwise throw inside `new Connection(...)` — and
// since that construction can run during Next.js's build-time prerender,
// a bad env var can take down the whole deployment, not just show a runtime
// error. Falling back keeps the build (and the app) working; the on-page
// banner in app/page.tsx is what tells the user their custom RPC isn't
// actually being used.
function resolveRpcUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  if (raw && /^https?:\/\//i.test(raw)) return raw;
  if (raw) {
    console.warn(
      `NEXT_PUBLIC_SOLANA_RPC_URL is set but isn't a valid http(s) URL ("${raw}"). ` +
        "Falling back to the public mainnet-beta endpoint, which is rate limited."
    );
  }
  return clusterApiUrl("mainnet-beta");
}

const RPC_URL = resolveRpcUrl();

export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  // Phantom, Solflare, Backpack, and virtually every modern Solana wallet now
  // auto-register via the Wallet Standard as soon as the extension loads.
  // Explicitly instantiating the legacy adapters alongside that causes
  // duplicate/conflicting entries in the picker and can make "Connect"
  // silently do nothing — so we deliberately pass an empty list here and
  // let every installed wallet be auto-detected instead.
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
