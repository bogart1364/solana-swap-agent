import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { findToken } from "./tokens";

export interface ResolvedToken {
  mint: string;
  decimals: number;
  symbol: string;
}

// Base58 alphabet, no 0/O/I/l. Solana addresses are 32-44 chars.
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Resolves a user-typed symbol or a raw mint address into a mint + decimals,
 * looking at the curated registry first (no RPC call needed) and falling
 * back to an on-chain lookup for anything else. This lets the console accept
 * *any* SPL token by pasting its mint address, not just the curated list.
 */
export async function resolveToken(
  connection: Connection,
  symbolOrMint: string
): Promise<ResolvedToken | null> {
  const curated = findToken(symbolOrMint);
  if (curated) return { mint: curated.mint, decimals: curated.decimals, symbol: curated.symbol };

  const candidate = symbolOrMint.trim();
  if (!BASE58_RE.test(candidate)) return null;

  try {
    const mintInfo = await getMint(connection, new PublicKey(candidate));
    return {
      mint: candidate,
      decimals: mintInfo.decimals,
      symbol: `${candidate.slice(0, 4)}\u2026${candidate.slice(-4)}`,
    };
  } catch {
    return null;
  }
}
