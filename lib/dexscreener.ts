// Free, no-API-key DexScreener endpoints. Rate limited but sufficient for a
// single-user dashboard polling every 30-60s. Docs: https://docs.dexscreener.com/api/reference
const DS_BASE = "https://api.dexscreener.com";
const CHAIN = "solana";

export interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  priceNative?: string;
  txns?: Record<string, { buys: number; sells: number }>;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  boosts?: { active?: number };
}

async function dsFetch(path: string) {
  const res = await fetch(`${DS_BASE}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`DexScreener request failed (${res.status})`);
  return res.json();
}

// Candidate discovery: combine recently boosted tokens (paid promotion — treat
// as a weak, non-organic signal) with the latest token profiles, restricted to
// Solana, then fetch live pair stats for each.
export async function discoverCandidateAddresses(limit = 40): Promise<string[]> {
  const addresses = new Set<string>();

  const sources = await Promise.allSettled([
    dsFetch("/token-boosts/latest/v1"),
    dsFetch("/token-boosts/top/v1"),
    dsFetch("/token-profiles/latest/v1"),
  ]);

  for (const result of sources) {
    if (result.status !== "fulfilled") continue;
    const items = Array.isArray(result.value) ? result.value : [];
    for (const item of items) {
      if (item?.chainId === CHAIN && item?.tokenAddress) {
        addresses.add(item.tokenAddress);
      }
    }
  }

  return Array.from(addresses).slice(0, limit);
}

// DexScreener's /latest/dex/tokens/ endpoint accepts up to 30 comma-separated
// addresses and returns every matching pair (across all DEXes) for them.
export async function getPairsForAddresses(addresses: string[]): Promise<DexPair[]> {
  if (addresses.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < addresses.length; i += 30) chunks.push(addresses.slice(i, i + 30));

  const results = await Promise.allSettled(
    chunks.map((chunk) => dsFetch(`/latest/dex/tokens/${chunk.join(",")}`))
  );

  const pairs: DexPair[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && Array.isArray(r.value?.pairs)) {
      pairs.push(...r.value.pairs.filter((p: DexPair) => p.chainId === CHAIN));
    }
  }

  // Keep only the highest-liquidity pair per base token so one token doesn't
  // show up multiple times for each DEX/pool it trades on.
  const bestByToken = new Map<string, DexPair>();
  for (const p of pairs) {
    const key = p.baseToken?.address;
    if (!key) continue;
    const existing = bestByToken.get(key);
    const liq = p.liquidity?.usd ?? 0;
    if (!existing || liq > (existing.liquidity?.usd ?? 0)) bestByToken.set(key, p);
  }
  return Array.from(bestByToken.values());
}

export async function searchPairs(query: string): Promise<DexPair[]> {
  const data = await dsFetch(`/latest/dex/search?q=${encodeURIComponent(query)}`);
  const pairs: DexPair[] = Array.isArray(data?.pairs) ? data.pairs : [];
  return pairs.filter((p) => p.chainId === CHAIN);
}

const SOL_MINT = "So11111111111111111111111111111111111111112";
let cachedSolPrice: { price: number; ts: number } | null = null;

/**
 * Current SOL/USD price, cached for 30s so the holdings panel's poll loop
 * doesn't re-fetch it on every render. Used to express P&L in SOL terms
 * without needing to know the historical SOL/USD rate at buy time — since
 * cost basis is tracked in SOL spent, comparing against current value
 * converted back to SOL cancels out the USD rate entirely.
 */
export async function getSolUsdPrice(): Promise<number> {
  if (cachedSolPrice && Date.now() - cachedSolPrice.ts < 30_000) return cachedSolPrice.price;
  try {
    const pairs = await getPairsForAddresses([SOL_MINT]);
    const best = pairs.find((p) => p.baseToken?.address === SOL_MINT && p.priceUsd);
    const price = best?.priceUsd ? Number(best.priceUsd) : 0;
    if (price > 0) {
      cachedSolPrice = { price, ts: Date.now() };
      return price;
    }
  } catch {
    // fall through to stale cache below
  }
  return cachedSolPrice?.price ?? 0;
}

export interface ScoreResult {
  score: number; // 0-100, heuristic "momentum" score — NOT a prediction
  tier: "extreme-risk" | "high" | "medium" | "low" | "watch";
  reasons: string[];
}

// Heuristic momentum score from live, point-in-time market stats. This is
// purely a statistical heuristic over public DEX data — it reflects current
// and recent trading activity, not a forecast, and is easily gamed by wash
// trading on low-liquidity pairs. Treat "score" as "worth a closer manual
// look", never as a buy signal on its own.
export function scoreMomentum(pair: DexPair): ScoreResult {
  const reasons: string[] = [];
  let score = 0;

  const liquidityUsd = pair.liquidity?.usd ?? 0;
  const vol1h = pair.volume?.h1 ?? 0;
  const vol5m = pair.volume?.m5 ?? 0;
  const change5m = pair.priceChange?.m5 ?? 0;
  const change1h = pair.priceChange?.h1 ?? 0;
  const txns5m = pair.txns?.m5 ?? { buys: 0, sells: 0 };
  const txns1h = pair.txns?.h1 ?? { buys: 0, sells: 0 };
  const ageMs = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : null;
  const ageMinutes = ageMs ? ageMs / 60000 : null;

  // Hard floor: extremely low liquidity is dominated by rug/honeypot risk,
  // regardless of how exciting the other numbers look.
  if (liquidityUsd < 3000) {
    reasons.push(`Liquidity is only $${liquidityUsd.toFixed(0)} — very high rug/honeypot risk.`);
    return { score: 5, tier: "extreme-risk", reasons };
  }

  // Turnover: how much of the pool's liquidity traded in the last hour.
  const turnover = liquidityUsd > 0 ? vol1h / liquidityUsd : 0;
  if (turnover > 3) {
    score += 25;
    reasons.push(`Very high turnover: 1h volume is ${turnover.toFixed(1)}x liquidity.`);
  } else if (turnover > 1) {
    score += 15;
    reasons.push(`Elevated turnover: 1h volume is ${turnover.toFixed(1)}x liquidity.`);
  } else if (turnover > 0.3) {
    score += 6;
  }

  // Buy/sell imbalance — dominance of buys over sells recently.
  const total5m = txns5m.buys + txns5m.sells;
  const buyRatio5m = total5m > 0 ? txns5m.buys / total5m : 0.5;
  if (total5m >= 5) {
    if (buyRatio5m > 0.7) {
      score += 20;
      reasons.push(`Strong buy dominance in the last 5m (${(buyRatio5m * 100).toFixed(0)}% buys).`);
    } else if (buyRatio5m > 0.58) {
      score += 10;
    } else if (buyRatio5m < 0.4) {
      score -= 10;
      reasons.push(`Sell-dominant in the last 5m (${((1 - buyRatio5m) * 100).toFixed(0)}% sells).`);
    }
  }

  // Momentum — recent positive price action, moderately weighted so a token
  // that already spiked 500% doesn't score as "about to pump."
  if (change5m > 3 && change5m < 60) {
    score += 20;
    reasons.push(`Price up ${change5m.toFixed(1)}% in the last 5m.`);
  } else if (change5m >= 60) {
    score += 5;
    reasons.push(`Price already up ${change5m.toFixed(0)}% in 5m — likely late, not early.`);
  } else if (change5m < -10) {
    score -= 15;
    reasons.push(`Price down ${change5m.toFixed(1)}% in the last 5m.`);
  }

  if (change1h > 5 && change1h < 200) {
    score += 10;
  }

  // Activity breadth — a handful of wallets trading back and forth is a much
  // weaker signal than broad participation.
  if (txns1h.buys + txns1h.sells > 200) {
    score += 10;
    reasons.push(`High trade count in the last hour (${txns1h.buys + txns1h.sells} txns).`);
  } else if (txns1h.buys + txns1h.sells < 20) {
    score -= 5;
    reasons.push("Low trade count — thin activity, easy to manipulate.");
  }

  // Age — brand-new pairs are the highest-variance (both up and down).
  if (ageMinutes !== null) {
    if (ageMinutes < 10) {
      score -= 10;
      reasons.push("Pair is under 10 minutes old — too new to assess safely.");
    } else if (ageMinutes < 60) {
      reasons.push("Pair is under an hour old — still early-stage risk.");
    }
  }

  if (pair.boosts?.active) {
    reasons.push("Token has an active paid DexScreener boost (marketing, not an organic signal).");
  }

  score = Math.max(0, Math.min(100, score));
  let tier: ScoreResult["tier"] = "watch";
  if (score >= 55) tier = "high";
  else if (score >= 35) tier = "medium";
  else if (score >= 15) tier = "low";
  if (liquidityUsd < 10000) tier = tier === "high" ? "medium" : tier;

  if (reasons.length === 0) reasons.push("No strong signals either way.");
  return { score, tier, reasons };
}

export interface DumpRiskResult {
  atRisk: boolean;
  reasons: string[];
}

// Dump-risk check for a token the user currently holds. `prevSnapshot` is the
// same pair object captured on a previous poll (if any) so we can measure
// short-term deltas the DexScreener snapshot alone doesn't show.
export function assessDumpRisk(pair: DexPair, prevSnapshot?: DexPair): DumpRiskResult {
  const reasons: string[] = [];
  const change5m = pair.priceChange?.m5 ?? 0;
  const txns5m = pair.txns?.m5 ?? { buys: 0, sells: 0 };
  const total5m = txns5m.buys + txns5m.sells;
  const sellRatio5m = total5m > 0 ? txns5m.sells / total5m : 0.5;
  const liquidityUsd = pair.liquidity?.usd ?? 0;

  if (change5m < -8) {
    reasons.push(`Dropped ${Math.abs(change5m).toFixed(1)}% in the last 5m.`);
  }
  if (total5m >= 5 && sellRatio5m > 0.65) {
    reasons.push(`Sell-dominant right now (${(sellRatio5m * 100).toFixed(0)}% sells in 5m).`);
  }
  if (prevSnapshot?.liquidity?.usd) {
    const prevLiq = prevSnapshot.liquidity.usd;
    const drop = prevLiq > 0 ? (prevLiq - liquidityUsd) / prevLiq : 0;
    if (drop > 0.15) {
      reasons.push(`Liquidity fell ${(drop * 100).toFixed(0)}% since the last check — possible pull.`);
    }
  }

  return { atRisk: reasons.length > 0, reasons };
}
