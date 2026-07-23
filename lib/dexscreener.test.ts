import { describe, it, expect } from "vitest";
import { scoreMomentum, assessDumpRisk, type DexPair } from "./dexscreener";

function makePair(overrides: Partial<DexPair> = {}): DexPair {
  return {
    chainId: "solana",
    dexId: "raydium",
    url: "https://dexscreener.com/solana/test",
    pairAddress: "pair123",
    baseToken: { address: "mint123", name: "Test Token", symbol: "TEST" },
    quoteToken: { address: "So11111111111111111111111111111111111111112", name: "Wrapped SOL", symbol: "SOL" },
    priceUsd: "0.001",
    liquidity: { usd: 50000 },
    volume: { h1: 20000, m5: 2000 },
    priceChange: { m5: 5, h1: 20 },
    txns: { m5: { buys: 8, sells: 2 }, h1: { buys: 100, sells: 50 } },
    pairCreatedAt: Date.now() - 2 * 60 * 60 * 1000, // 2h old
    ...overrides,
  };
}

describe("scoreMomentum", () => {
  it("floors extremely low-liquidity pairs at extreme-risk regardless of other stats", () => {
    const pair = makePair({ liquidity: { usd: 500 }, priceChange: { m5: 500, h1: 900 } });
    const result = scoreMomentum(pair);
    expect(result.tier).toBe("extreme-risk");
    expect(result.score).toBeLessThan(10);
    expect(result.reasons.join(" ")).toMatch(/rug\/honeypot/i);
  });

  it("scores a healthy, active, moderately-aged pair as high momentum", () => {
    const pair = makePair({
      liquidity: { usd: 80000 },
      volume: { h1: 300000, m5: 30000 }, // >3x turnover
      txns: { m5: { buys: 40, sells: 5 }, h1: { buys: 300, sells: 60 } },
      priceChange: { m5: 10, h1: 40 },
      pairCreatedAt: Date.now() - 3 * 60 * 60 * 1000,
    });
    const result = scoreMomentum(pair);
    expect(result.tier).toBe("high");
    expect(result.score).toBeGreaterThanOrEqual(55);
  });

  it("never returns a score outside 0-100", () => {
    const extreme = makePair({
      liquidity: { usd: 100000 },
      volume: { h1: 10_000_000, m5: 1_000_000 },
      priceChange: { m5: 1000, h1: 5000 },
      txns: { m5: { buys: 10000, sells: 1 }, h1: { buys: 100000, sells: 1 } },
    });
    const result = scoreMomentum(extreme);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("penalizes sell-dominant activity", () => {
    const sellHeavy = makePair({ txns: { m5: { buys: 2, sells: 18 }, h1: { buys: 50, sells: 50 } } });
    const buyHeavy = makePair({ txns: { m5: { buys: 18, sells: 2 }, h1: { buys: 50, sells: 50 } } });
    expect(scoreMomentum(sellHeavy).score).toBeLessThan(scoreMomentum(buyHeavy).score);
  });

  it("treats a brand-new pair (<10 min old) as riskier than an otherwise-identical older one", () => {
    const brandNew = makePair({ pairCreatedAt: Date.now() - 2 * 60 * 1000 });
    const establishedOlder = makePair({ pairCreatedAt: Date.now() - 5 * 60 * 60 * 1000 });
    expect(scoreMomentum(brandNew).score).toBeLessThan(scoreMomentum(establishedOlder).score);
  });

  it("caps the tier at medium when liquidity is thin, even with a high raw score", () => {
    const thinButActive = makePair({
      liquidity: { usd: 5000 }, // above the 3000 extreme-risk floor, below the 10000 "thin" cutoff
      volume: { h1: 50000, m5: 5000 },
      txns: { m5: { buys: 40, sells: 5 }, h1: { buys: 300, sells: 60 } },
      priceChange: { m5: 10, h1: 40 },
    });
    const result = scoreMomentum(thinButActive);
    expect(result.tier).not.toBe("high");
  });

  it("always returns at least one reason", () => {
    const flat = makePair({
      liquidity: { usd: 50000 },
      volume: { h1: 0, m5: 0 },
      priceChange: { m5: 0, h1: 0 },
      txns: { m5: { buys: 0, sells: 0 }, h1: { buys: 0, sells: 0 } },
    });
    expect(scoreMomentum(flat).reasons.length).toBeGreaterThan(0);
  });
});

describe("assessDumpRisk", () => {
  it("flags a sharp 5-minute price drop", () => {
    const result = assessDumpRisk(makePair({ priceChange: { m5: -15, h1: -5 } }));
    expect(result.atRisk).toBe(true);
    expect(result.reasons.join(" ")).toMatch(/dropped/i);
  });

  it("flags sell-dominant flow with enough transaction volume to be meaningful", () => {
    const result = assessDumpRisk(makePair({ txns: { m5: { buys: 2, sells: 18 }, h1: { buys: 50, sells: 50 } } }));
    expect(result.atRisk).toBe(true);
    expect(result.reasons.join(" ")).toMatch(/sell-dominant/i);
  });

  it("does not flag sell-dominant flow when transaction count is too low to be meaningful", () => {
    const result = assessDumpRisk(makePair({ txns: { m5: { buys: 1, sells: 2 }, h1: { buys: 50, sells: 50 } } }));
    expect(result.atRisk).toBe(false);
  });

  it("flags a sudden liquidity pull compared to the previous snapshot", () => {
    const prev = makePair({ liquidity: { usd: 100000 } });
    const now = makePair({ liquidity: { usd: 50000 }, priceChange: { m5: 0, h1: 0 } });
    const result = assessDumpRisk(now, prev);
    expect(result.atRisk).toBe(true);
    expect(result.reasons.join(" ")).toMatch(/liquidity fell/i);
  });

  it("does not flag a healthy, stable pair", () => {
    const prev = makePair({ liquidity: { usd: 50000 } });
    const now = makePair({ liquidity: { usd: 51000 }, priceChange: { m5: 1, h1: 5 } });
    const result = assessDumpRisk(now, prev);
    expect(result.atRisk).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });
});
