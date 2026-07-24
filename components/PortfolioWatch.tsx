"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Wallet, RefreshCw, TrendingDown, Bot } from "lucide-react";
import { getPairsForAddresses, assessDumpRisk, getSolUsdPrice, type DexPair } from "@/lib/dexscreener";
import { isRpcFailure } from "@/lib/mint";
import { getPosition } from "@/lib/positions";
import type { LogKind } from "@/lib/useTradeAgent";

const POLL_MS = 30_000;
const ALERT_COOLDOWN_MS = 10 * 60_000;

interface Holding {
  mint: string;
  uiAmount: number;
  uiAmountString: string;
  pair?: DexPair;
  atRisk: boolean;
  riskReasons: string[];
  valueUsd: number | null;
  valueSol: number | null;
  pnlPct: number | null;
}

export default function PortfolioWatch({
  runCommand,
  pushLog,
  hasPending,
  busy,
}: {
  runCommand: (text: string) => void | Promise<void>;
  pushLog: (kind: LogKind, text: string, href?: string) => void;
  hasPending: boolean;
  busy: boolean;
}) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(false);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [autoStageSell, setAutoStageSell] = useState(false);
  const lastRpcErrorLoggedAt = useRef(0);

  const prevPairs = useRef<Map<string, DexPair>>(new Map());
  const lastAlertAt = useRef<Map<string, number>>(new Map());
  const autoStageRef = useRef(autoStageSell);
  autoStageRef.current = autoStageSell;
  const hasPendingRef = useRef(hasPending);
  hasPendingRef.current = hasPending;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const autoStagedMints = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setHoldings([]);
      return;
    }
    setLoading(true);
    try {
      const [classic, token2022] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }),
        connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID }),
      ]);
      const accounts = { value: [...classic.value, ...token2022.value] };

      const balances = accounts.value
        .map((a) => {
          const info = a.account.data.parsed.info;
          const amount = info.tokenAmount;
          return {
            mint: info.mint as string,
            uiAmount: Number(amount.uiAmount ?? 0),
            uiAmountString: amount.uiAmountString as string,
          };
        })
        .filter((b) => b.uiAmount > 0);

      const mints = balances.map((b) => b.mint);
      const [pairs, solPriceUsd] = await Promise.all([
        mints.length > 0 ? getPairsForAddresses(mints) : Promise.resolve([]),
        getSolUsdPrice(),
      ]);
      const pairByMint = new Map(pairs.map((p) => [p.baseToken.address, p]));

      let stagedThisCycle = false;
      const nextHoldings: Holding[] = balances.map((b) => {
        const pair = pairByMint.get(b.mint);
        if (!pair) {
          return { ...b, atRisk: false, riskReasons: [], valueUsd: null, valueSol: null, pnlPct: null };
        }

        const priceUsd = Number(pair.priceUsd ?? 0);
        const valueUsd = priceUsd > 0 ? b.uiAmount * priceUsd : null;
        const valueSol = valueUsd !== null && solPriceUsd > 0 ? valueUsd / solPriceUsd : null;
        const position = getPosition(b.mint);
        const pnlPct =
          valueSol !== null && position && position.solSpent > 0
            ? ((valueSol - position.solSpent) / position.solSpent) * 100
            : null;

        const risk = assessDumpRisk(pair, prevPairs.current.get(b.mint));
        if (risk.atRisk) {
          const lastAlert = lastAlertAt.current.get(b.mint) ?? 0;
          if (Date.now() - lastAlert > ALERT_COOLDOWN_MS) {
            pushLog(
              "alert",
              `Possible dump risk on ${pair.baseToken.symbol}: ${risk.reasons.join(" ")}`
            );
            lastAlertAt.current.set(b.mint, Date.now());
          }
          if (
            autoStageRef.current &&
            !hasPendingRef.current &&
            !busyRef.current &&
            !stagedThisCycle &&
            !autoStagedMints.current.has(b.mint)
          ) {
            autoStagedMints.current.add(b.mint);
            stagedThisCycle = true;
            pushLog(
              "alert",
              `Auto-staged sell: ${pair.baseToken.symbol} looks like it's dumping (${risk.reasons.join(
                " "
              )}). Review the quote below \u2014 nothing sends until you type "confirm".`
            );
            runCommand(`sell all ${b.mint} for SOL`);
          }
        }
        return { ...b, pair, atRisk: risk.atRisk, riskReasons: risk.reasons, valueUsd, valueSol, pnlPct };
      });

      for (const p of pairs) prevPairs.current.set(p.baseToken.address, p);
      setHoldings(nextHoldings);
      setRpcError(null);
    } catch (err) {
      if (isRpcFailure(err)) {
        setRpcError(
          "Your Solana RPC endpoint is blocking/rate-limiting requests (403/429). Holdings can't " +
            "load until NEXT_PUBLIC_SOLANA_RPC_URL is set to a real provider (Helius, QuickNode\u2026)."
        );
        // Log it to the console once every few minutes, not on every 30s poll.
        if (Date.now() - lastRpcErrorLoggedAt.current > 5 * 60_000) {
          pushLog("error", "Holdings fetch failed: RPC endpoint rejected the request (403/429).");
          lastRpcErrorLoggedAt.current = Date.now();
        }
      }
      // Non-RPC hiccups (a transient DexScreener blip, etc.) are skipped quietly.
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey, pushLog, runCommand]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const handleSell = (h: Holding) => {
    if (!h.pair) return;
    runCommand(`sell all ${h.mint} for SOL`);
  };

  if (!publicKey) {
    return (
      <div className="panel">
        <div className="panel-header">
          <h2>
            <Wallet size={16} strokeWidth={2.2} /> Your holdings
          </h2>
        </div>
        <p className="empty-text">Connect a wallet to watch your token holdings for dump risk.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>
          <Wallet size={16} strokeWidth={2.2} /> Your holdings
        </h2>
        <button className="ghost-btn" onClick={refresh} disabled={loading}>
          {loading ? "\u2026" : (
            <>
              <RefreshCw size={12} strokeWidth={2.4} /> Refresh
            </>
          )}
        </button>
      </div>

      <label className="toggle-row">
        <input
          type="checkbox"
          checked={autoStageSell}
          onChange={(e) => setAutoStageSell(e.target.checked)}
        />
        <Bot size={14} strokeWidth={2.2} />
        <span>{"Auto-stage sells on detected dump risk \u2014 still needs your confirm"}</span>
      </label>

      <div className="scanner-list">
        {rpcError && <p className="error-text">{rpcError}</p>}
        {holdings.map((h) => (
          <div key={h.mint} className={`scanner-row ${h.atRisk ? "tier-extreme-risk" : ""}`}>
            <div className="scanner-row-top">
              <div className="scanner-token">
                <span className="scanner-symbol">{h.pair?.baseToken.symbol ?? "Unknown"}</span>
                <span className="scanner-name">{h.uiAmountString}</span>
              </div>
              {h.atRisk && <span className="tier-badge tier-badge-extreme-risk">Dump risk</span>}
            </div>

            {(h.valueUsd !== null || h.pnlPct !== null) && (
              <div className="holding-value-row">
                {h.valueUsd !== null && (
                  <span className="holding-value">
                    {"\u2248 $"}
                    {h.valueUsd.toFixed(2)}
                    {h.valueSol !== null && ` \u00b7 ${h.valueSol.toFixed(4)} SOL`}
                  </span>
                )}
                {h.pnlPct !== null && (
                  <span className={`holding-pnl ${h.pnlPct >= 0 ? "holding-pnl-up" : "holding-pnl-down"}`}>
                    {h.pnlPct >= 0 ? "\u25b2" : "\u25bc"} {h.pnlPct >= 0 ? "+" : ""}
                    {h.pnlPct.toFixed(1)}%
                  </span>
                )}
                {h.pnlPct === null && h.valueUsd !== null && (
                  <span className="holding-pnl-unknown">cost basis unknown</span>
                )}
              </div>
            )}

            {h.riskReasons.length > 0 && (
              <ul className="scanner-reasons">
                {h.riskReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
            {h.pair && (
              <button className="sell-btn" onClick={() => handleSell(h)}>
                <TrendingDown size={13} strokeWidth={2.4} /> Sell all {h.pair.baseToken.symbol} for SOL
              </button>
            )}
          </div>
        ))}
        {holdings.length === 0 && !loading && !rpcError && (
          <p className="empty-text">No tracked SPL token balances found in this wallet.</p>
        )}
      </div>
    </div>
  );
}
