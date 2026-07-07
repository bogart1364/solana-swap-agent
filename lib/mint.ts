import { Connection, PublicKey } from "@solana/web3.js";
import { getMint, getAssociatedTokenAddress } from "@solana/spl-token";
import { findToken } from "./tokens";

export interface ResolvedToken {
  mint: string;
  decimals: number;
  symbol: string;
}

// Base58 alphabet, no 0/O/I/l. Solana addresses are 32-44 chars.
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOL_MINT = "So11111111111111111111111111111111111111112";

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

/**
 * Resolves the *whole current balance* of a token for "sell all" / "send all"
 * style commands. Returns a human-readable amount (e.g. 1.2345), leaving a
 * small lamport buffer out of native SOL so the transaction can still pay
 * network fees.
 */
export async function resolveWalletBalance(
  connection: Connection,
  owner: PublicKey,
  resolved: ResolvedToken
): Promise<number> {
  if (resolved.mint === SOL_MINT) {
    const lamports = await connection.getBalance(owner);
    const FEE_BUFFER_LAMPORTS = 5000; // leave a little headroom for the tx fee
    const spendable = Math.max(0, lamports - FEE_BUFFER_LAMPORTS);
    return spendable / 10 ** resolved.decimals;
  }
  try {
    const ata = await getAssociatedTokenAddress(new PublicKey(resolved.mint), owner);
    const balance = await connection.getTokenAccountBalance(ata);
    return balance.value.uiAmount ?? 0;
  } catch {
    return 0;
  }
}
