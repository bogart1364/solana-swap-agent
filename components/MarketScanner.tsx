"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { Radar, RefreshCw, ShieldCheck, ShoppingCart, Bot } from "lucide-react";
import {
  discoverCandidateAddresses,
  getPairsForAddresses,
  scoreMomentum,
  type DexPair,
  type ScoreResult,
} from "@/lib/dexscreener";
import { checkTokenSafety, type SafetyReport } from "@/lib/rugcheck";
import ScoreBar from "./ScoreBar";
import type { LogKind } from "@/lib/useTradeAgent";

const POLL_MS = 45_000;
const MAX_ROWS = 15;
// Auto-stage threshold: both the momentum score AND an on-chain safety
// check have to independently clear a high bar before anything gets
// auto-staged — and staging only ever prepares a quote, it never signs or
// sends anything without you typing "confirm" yourself.
const AUTO_STAGE_MOMENTUM_MIN = 80;
const AUTO_STAGE_SAFETY_MIN = 70;

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

const TIER_EMOJI: Record<ScoreResult["tier"], string> = {
  high: "\ud83d\ude80",
  medium: "\ud83d\udcc8",
  low: "\ud83d\udcc9",
  watch: "\ud83d\udc40",
  "extreme-risk": "\ud83d\udeab",
};

export default function MarketScanner({
  runCommand,
  pushLog,
  hasPending,
  busy,
}: {
  runCommand: (text: string) => void | Promise<void>;
  pushLog: (kind: LogKind, text: string) => void;
  hasPending: boolean;
  busy: boolean;
}) {
  const { connection } = useConnection();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buySize, setBuySize] = useState("0.05");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoStage, setAutoStage] = useState(false);
  const [safety, setSafety] = useState<Record<string, { loading: boolean; report?: SafetyReport; error?: string }>>(
    {}
  );

  const safetyRef = useRef(safety);
  safetyRef.current = safety;
  const autoStageRef = useRef(autoStage);
  autoStageRef.current = autoStage;
  const hasPendingRef = useRef(hasPending);
  hasPendingRef.current = hasPending;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const buySizeRef = useRef(buySize);
  buySizeRef.current = buySize;
  const autoStagedMints = useRef<Set<string>>(new Set());

  const runSafetyCheck = useCallback(
    async (mint: string): Promise<SafetyReport | null> => {
      setSafety((prev) => ({ ...prev, [mint]: { loading: true } }));
      try {
        const report = await checkTokenSafety(connection, mint);
        setSafety((prev) => ({ ...prev, [mint]: { loading: false, report } }));
        return report;
      } catch (err: any) {
        setSafety((prev) => ({ ...prev, [mint]: { loading: false, error: err?.message ?? "Check failed." } }));
        return null;
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

      if (autoStageRef.current && !hasPendingRef.current && !busyRef.current) {
        const candidate = scored.find(
          (r) =>
            r.result.tier === "high" &&
            r.result.score >= AUTO_STAGE_MOMENTUM_MIN &&
            !autoStagedMints.current.has(r.pair.baseToken.address)
        );
        if (candidate) {
          const mint = candidate.pair.baseToken.address;
          autoStagedMints.current.add(mint);
          const existing = safetyRef.current[mint]?.report;
          const report = existing ?? (await runSafetyCheck(mint));
          if (report && report.score >= AUTO_STAGE_SAFETY_MIN) {
            const amount = parseFloat(buySizeRef.current) || 0.05;
            pushLog(
              "alert",
              `\ud83e\udd16 Auto-staged buy: ${candidate.pair.baseToken.symbol} scored ${candidate.result.score}/100 ` +
                `momentum and ${report.score}/100 safety (mint/freeze renounced check + holder concentration). ` +
                `Review the quote below \u2014 nothing sends until you type "confirm".`
            );
            runCommand(`buy ${amount} SOL of ${mint}`);
          }
        }
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to load market data.");
    } finally {
      setLoading(false);
    }
  }, [runSafetyCheck, runCommand, pushLog]);

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

      <label className="toggle-row">
        <input type="checkbox" checked={autoStage} onChange={(e) => setAutoStage(e.target.checked)} />
        <Bot size={14} strokeWidth={2.2} />
        <span>
          Auto-stage strong buys ({AUTO_STAGE_MOMENTUM_MIN}+ momentum, {AUTO_STAGE_SAFETY_MIN}+ safety)
          — still needs your confirm
        </span>
      </label>

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
                {TIER_EMOJI[result.tier]} {TIER_LABEL[result.tier]}
              </span>
            </div>

            <ScoreBar score={result.score} label="Momentum" emoji={TIER_EMOJI[result.tier]} />

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
                    <button className="safety-btn" onClick={() => runSafetyCheck(mint)}>
                      <ShieldCheck size={13} strokeWidth={2.2} /> Check mint/freeze authority + holder
                      concentration
                    </button>
                  )}
                  {s?.loading && <p className="empty-text">Reading mint account on-chain\u2026</p>}
                  {s?.error && <p className="error-text">{s.error}</p>}
                  {s?.report && (
                    <div className={`safety-result safety-${s.report.tier}`}>
                      <ScoreBar
                        score={s.report.score}
                        label="Safety"
                        emoji={
                          s.report.tier === "clean" ? "\u2705" : s.report.tier === "caution" ? "\u26a0\ufe0f" : "\ud83d\udeab"
                        }
                      />
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
