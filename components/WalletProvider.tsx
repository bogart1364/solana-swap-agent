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
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";

import "@solana/wallet-adapter-react-ui/styles.css";

// Set NEXT_PUBLIC_SOLANA_RPC_URL to your own RPC endpoint (QuickNode, Helius, Triton, etc.)
// for production use — the public cluster endpoint is rate limited.
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("mainnet-beta");

export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  // Wallet Standard wallets (Phantom, Backpack, and most modern wallets) auto-register
  // themselves as browser extensions load, so they show up even without an adapter here.
  // These two are kept explicit for broader/older browser support.
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
