import { Connection, PublicKey } from "@solana/web3.js";
import { getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { isRpcFailure } from "./mint";

export interface SafetyReport {
  score: number; // 0-100, higher = fewer red flags
  tier: "clean" | "caution" | "high-risk";
  flags: string[];
  mintAuthorityRenounced: boolean;
  freezeAuthorityRenounced: boolean;
  top10HolderPct: number | null;
}

/**
 * Reads the mint account directly on-chain and checks the handful of things
 * that separate "probably fine" from "the team can rug this at will":
 * mint authority (can they print more supply?), freeze authority (can they
 * freeze your tokens?), and how concentrated the supply is among the
 * largest holders. This is the same class of check tools like RugCheck.xyz
 * do — it's a real signal, not a vibe, but it's still not a guarantee:
 * a "clean" mint can still be a bad trade, and holder concentration can
 * include the liquidity pool itself rather than an actual whale.
 */
export async function checkTokenSafety(connection: Connection, mintAddress: string): Promise<SafetyReport> {
  const pubkey = new PublicKey(mintAddress);

  let mintInfo: Awaited<ReturnType<typeof getMint>> | null = null;
  let lastErr: unknown = null;
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      mintInfo = await getMint(connection, pubkey, undefined, programId);
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!mintInfo) {
    if (isRpcFailure(lastErr)) {
      throw new Error("RPC endpoint rejected the request (403/429) \u2014 set NEXT_PUBLIC_SOLANA_RPC_URL to a real provider.");
    }
    throw new Error("Could not read this mint account. Double-check the address.");
  }

  const flags: string[] = [];
  let score = 100;

  const mintAuthorityRenounced = mintInfo.mintAuthority === null;
  const freezeAuthorityRenounced = mintInfo.freezeAuthority === null;

  if (!mintAuthorityRenounced) {
    score -= 40;
    flags.push(
      "Mint authority is still active \u2014 the team can create more supply at any time and dilute holders."
    );
  }
  if (!freezeAuthorityRenounced) {
    score -= 25;
    flags.push(
      "Freeze authority is still active \u2014 the team can freeze individual token accounts, including yours."
    );
  }

  let top10HolderPct: number | null = null;
  try {
    const largest = await connection.getTokenLargestAccounts(pubkey);
    const totalSupply = Number(mintInfo.supply);
    if (totalSupply > 0 && largest.value.length > 0) {
      const top10Sum = largest.value.slice(0, 10).reduce((sum, a) => sum + Number(a.amount), 0);
      top10HolderPct = (top10Sum / totalSupply) * 100;
      if (top10HolderPct > 80) {
        score -= 20;
        flags.push(
          `Top 10 holder accounts control ${top10HolderPct.toFixed(0)}% of supply (this can include the ` +
            `liquidity pool itself, not just whales \u2014 worth checking on Solscan before assuming the worst).`
        );
      } else if (top10HolderPct > 50) {
        score -= 10;
        flags.push(`Top 10 holder accounts control ${top10HolderPct.toFixed(0)}% of supply.`);
      }
    }
  } catch {
    // Holder concentration is a best-effort extra signal; skip silently if it fails.
  }

  score = Math.max(0, Math.min(100, score));
  const tier: SafetyReport["tier"] = score >= 70 ? "clean" : score >= 40 ? "caution" : "high-risk";

  if (flags.length === 0) {
    flags.push("Mint authority and freeze authority are both renounced. No holder-concentration red flag found.");
  }

  return { score, tier, flags, mintAuthorityRenounced, freezeAuthorityRenounced, top10HolderPct };
}
