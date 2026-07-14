import { Connection, PublicKey } from "@solana/web3.js";
import { getMint, getAssociatedTokenAddress, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { findToken } from "./tokens";

export interface ResolvedToken {
  mint: string;
  decimals: number;
  symbol: string;
  programId: PublicKey;
}

// Base58 alphabet, no 0/O/I/l. Solana addresses are 32-44 chars.
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOL_MINT = "So11111111111111111111111111111111111111112";

export class RpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcError";
  }
}

export function isRpcFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /403|429|forbidden|too many requests|failed to fetch|NetworkError/i.test(msg);
}

/**
 * Resolves a user-typed symbol or a raw mint address into a mint + decimals,
 * looking at the curated registry first (no RPC call needed) and falling
 * back to an on-chain lookup for anything else. This lets the console accept
 * *any* SPL token by pasting its mint address, not just the curated list.
 *
 * Tries the classic Token program first, then Token-2022 — a lot of newer
 * tokens (many pump.fun launches and others using transfer fees / hooks)
 * are minted under Token-2022, and a mint's account is owned by exactly one
 * of the two, so guessing wrong throws rather than just returning less info.
 *
 * Throws RpcError (rather than returning null) when the failure looks like
 * the RPC endpoint itself is blocking/rate-limiting requests, so the caller
 * can show "your RPC endpoint is blocked" instead of the misleading
 * "unknown token" — this is a common cause of that error in practice, since
 * the public mainnet-beta endpoint frequently 403s browser traffic.
 */
export async function resolveToken(
  connection: Connection,
  symbolOrMint: string
): Promise<ResolvedToken | null> {
  const curated = findToken(symbolOrMint);
  if (curated)
    return {
      mint: curated.mint,
      decimals: curated.decimals,
      symbol: curated.symbol,
      programId: TOKEN_PROGRAM_ID,
    };

  const candidate = symbolOrMint.trim();
  if (!BASE58_RE.test(candidate)) return null;

  const pubkey = new PublicKey(candidate);
  const shortSymbol = `${candidate.slice(0, 4)}\u2026${candidate.slice(-4)}`;
  let sawRpcFailure = false;

  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const mintInfo = await getMint(connection, pubkey, undefined, programId);
      return { mint: candidate, decimals: mintInfo.decimals, symbol: shortSymbol, programId };
    } catch (err) {
      if (isRpcFailure(err)) sawRpcFailure = true;
      // Otherwise this just means "not owned by this program" — try the next one.
    }
  }

  if (sawRpcFailure) {
    throw new RpcError(
      "Your Solana RPC endpoint rejected the request (403/429). The public mainnet-beta " +
        "endpoint blocks most browser traffic — set NEXT_PUBLIC_SOLANA_RPC_URL to a real " +
        "provider (Helius, QuickNode, Triton...) and redeploy."
    );
  }
  return null;
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
    let lamports: number;
    try {
      lamports = await connection.getBalance(owner);
    } catch (err) {
      if (isRpcFailure(err)) {
        throw new RpcError(
          "Your Solana RPC endpoint rejected the request (403/429). Set " +
            "NEXT_PUBLIC_SOLANA_RPC_URL to a real provider and redeploy."
        );
      }
      throw err;
    }
    const FEE_BUFFER_LAMPORTS = 5000; // leave a little headroom for the tx fee
    const spendable = Math.max(0, lamports - FEE_BUFFER_LAMPORTS);
    return spendable / 10 ** resolved.decimals;
  }
  try {
    const ata = await getAssociatedTokenAddress(
      new PublicKey(resolved.mint),
      owner,
      false,
      resolved.programId
    );
    const balance = await connection.getTokenAccountBalance(ata);
    return balance.value.uiAmount ?? 0;
  } catch (err) {
    if (isRpcFailure(err)) {
      throw new RpcError(
        "Your Solana RPC endpoint rejected the request (403/429). Set " +
          "NEXT_PUBLIC_SOLANA_RPC_URL to a real provider and redeploy."
      );
    }
    return 0;
  }
}
