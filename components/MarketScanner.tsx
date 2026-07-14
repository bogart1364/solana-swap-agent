"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { Radar, RefreshCw, ShieldCheck, ShoppingCart } from "lucide-react";
import {
  discoverCandidateAddresses,
  getPairsForAddresses,
  scoreMomentum,
  type DexPair,
  type ScoreResult,
} from "@/lib/dexscreener";
import { checkTokenSafety, type SafetyReport } from "@/lib/rugcheck";

const POLL_MS = 45_000;
const MAX_ROWS = 15;

interface Row {
  pair: DexPair;
  result: ScoreResult;
}

const TIER_LABEL: Record<ScoreResult["tier"], string> = {
  high: "High momentum",
  medium: "Medium",
  low: "Low",
  watch: "Watch only",
  "extreme-risk": "Extreme risk",
};

export default function MarketScanner({
  runCommand,
}: {
  runCommand: (text: string) => void | Promise<void>;
}) {
  const { connection } = useConnection();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buySize, setBuySize] = useState("0.05");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [safety, setSafety] = useState<Record<string, { loading: boolean; report?: SafetyReport; error?: string }>>(
    {}
  );

  const checkSafety = useCallback(
    async (mint: string) => {
      setSafety((prev) => ({ ...prev, [mint]: { loading: true } }));
      try {
        const report = await checkTokenSafety(connection, mint);
        setSafety((prev) => ({ ...prev, [mint]: { loading: false, report } }));
      } catch (err: any) {
        setSafety((prev) => ({ ...prev, [mint]: { loading: false, error: err?.message ?? "Check failed." } }));
      }
    },
    [connection]
  );

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const addresses = await discoverCandidateAddresses(40);
      const pairs = await getPairsForAddresses(addresses);
      const scored = pairs
        .map((pair) => ({ pair, result: scoreMomentum(pair) }))
        .sort((a, b) => b.result.score - a.result.score)
        .slice(0, MAX_ROWS);
      setRows(scored);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err?.message ?? "Failed to load market data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const handleBuy = (mint: string, symbol: string) => {
    const amount = parseFloat(buySize) || 0.05;
    runCommand(`buy ${amount} SOL of ${mint}`);
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>
          <Radar size={16} strokeWidth={2.2} /> Market scanner
        </h2>
        <div className="panel-header-meta">
          {lastUpdated && <span>{lastUpdated.toLocaleTimeString()}</span>}
          <button className="ghost-btn" onClick={refresh} disabled={loading}>
            {loading ? "\u2026" : (
              <>
                <RefreshCw size={12} strokeWidth={2.4} /> Refresh
              </>
            )}
          </button>
        </div>
      </div>

      <p className="risk-banner">
        These are statistical momentum scores from public DEX data (volume, liquidity, buy/sell
        ratio, age) — <strong>not a prediction</strong>. Low-liquidity Solana tokens are frequently
        rug pulls. Treat every row as "worth a manual look," never as advice. Use{" "}
        <strong>Check mint/freeze authority</strong> on a row before buying — it reads the token's
        actual on-chain permissions, which is a much stronger signal than momentum alone.
      </p>

      <div className="buy-size-row">
        <label htmlFor="buy-size">Buy size (SOL)</label>
        <input
          id="buy-size"
          type="number"
          min="0"
          step="0.01"
          value={buySize}
          onChange={(e) => setBuySize(e.target.value)}
        />
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="scanner-list">
        {rows.map(({ pair, result }) => (
          <div key={pair.baseToken.address} className={`scanner-row tier-${result.tier}`}>
            <div className="scanner-row-top">
              <div className="scanner-token">
                <span className="scanner-symbol">{pair.baseToken.symbol}</span>
                <a href={pair.url} target="_blank" rel="noreferrer" className="scanner-name">
                  {pair.baseToken.name}
                </a>
              </div>
              <span className={`tier-badge tier-badge-${result.tier}`}>
                {TIER_LABEL[result.tier]} {"\u00b7"} {result.score}
              </span>
            </div>

            <div className="scanner-stats">
              <span>${Number(pair.priceUsd ?? 0).toPrecision(4)}</span>
              <span>Liq ${(pair.liquidity?.usd ?? 0).toLocaleString()}</span>
              <span>5m {(pair.priceChange?.m5 ?? 0).toFixed(1)}%</span>
              <span>1h {(pair.priceChange?.h1 ?? 0).toFixed(1)}%</span>
            </div>

            <ul className="scanner-reasons">
              {result.reasons.slice(0, 2).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>

            {(() => {
              const mint = pair.baseToken.address;
              const s = safety[mint];
              return (
                <div className="safety-block">
                  {!s && (
                    <button className="safety-btn" onClick={() => checkSafety(mint)}>
                      <ShieldCheck size={13} strokeWidth={2.2} /> Check mint/freeze authority + holder
                      concentration
                    </button>
                  )}
                  {s?.loading && <p className="empty-text">Reading mint account on-chain\u2026</p>}
                  {s?.error && <p className="error-text">{s.error}</p>}
                  {s?.report && (
                    <div className={`safety-result safety-${s.report.tier}`}>
                      <span className="safety-score-badge">
                        Safety {s.report.score}/100 {"\u00b7"}{" "}
                        {s.report.tier === "clean"
                          ? "No red flags"
                          : s.report.tier === "caution"
                          ? "Mixed signals"
                          : "High risk"}
                      </span>
                      <ul className="scanner-reasons">
                        {s.report.flags.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })()}

            <button
              className="buy-btn"
              onClick={() => handleBuy(pair.baseToken.address, pair.baseToken.symbol)}
              disabled={result.tier === "extreme-risk"}
            >
              <ShoppingCart size={13} strokeWidth={2.4} /> Buy {buySize} SOL of {pair.baseToken.symbol}
            </button>
          </div>
        ))}
        {!loading && rows.length === 0 && !error && (
          <p className="empty-text">No candidates found this round — try refreshing shortly.</p>
        )}
      </div>
    </div>
  );
}
