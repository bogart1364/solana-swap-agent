// Tracks cost basis (in SOL spent) per mint, purely client-side, so the
// holdings panel can show unrealized P&L for anything bought through this
// app. Tracking cost basis in SOL rather than USD is deliberate: comparing
// "SOL spent" against "current value converted back to SOL" gives the right
// P&L without ever needing the historical SOL/USD rate at buy time.
//
// This can't know about tokens you already held before using this app, or
// bought elsewhere — those just won't have a position and the UI shows
// value without a P&L figure rather than guessing.

export interface Position {
  mint: string;
  solSpent: number;
  tokensReceived: number;
  updatedAt: number;
}

const KEY = "swapagent:positions:v1";

function isPosition(value: unknown): value is Position {
  const v = value as any;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.mint === "string" &&
    typeof v.solSpent === "number" &&
    Number.isFinite(v.solSpent) &&
    v.solSpent > 0 &&
    typeof v.tokensReceived === "number" &&
    Number.isFinite(v.tokensReceived) &&
    v.tokensReceived > 0
  );
}

function readAll(): Record<string, Position> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    // Defensive: drop anything that doesn't look like a real position rather
    // than letting a corrupted entry propagate into P&L math (e.g. NaN%).
    const out: Record<string, Position> = {};
    for (const [mint, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isPosition(value)) out[mint] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, Position>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage full or unavailable (private browsing, etc.) — P&L tracking
    // is a nice-to-have, so fail silently rather than breaking a trade.
  }
}

export function getPosition(mint: string): Position | null {
  return readAll()[mint] ?? null;
}

/** Call after a confirmed buy (SOL -> token) to accumulate cost basis. */
export function recordBuy(mint: string, solSpent: number, tokensReceived: number) {
  if (!(solSpent > 0) || !(tokensReceived > 0)) return;
  const all = readAll();
  const existing = all[mint];
  all[mint] = existing
    ? {
        mint,
        solSpent: existing.solSpent + solSpent,
        tokensReceived: existing.tokensReceived + tokensReceived,
        updatedAt: Date.now(),
      }
    : { mint, solSpent, tokensReceived, updatedAt: Date.now() };
  writeAll(all);
}

/** Call after a confirmed sell (token -> SOL) to reduce or clear cost basis. */
export function reducePosition(mint: string, tokensSold: number) {
  const all = readAll();
  const existing = all[mint];
  if (!existing || tokensSold <= 0) return;
  if (tokensSold >= existing.tokensReceived) {
    delete all[mint];
  } else {
    const fractionRemaining = (existing.tokensReceived - tokensSold) / existing.tokensReceived;
    all[mint] = {
      ...existing,
      solSpent: existing.solSpent * fractionRemaining,
      tokensReceived: existing.tokensReceived - tokensSold,
      updatedAt: Date.now(),
    };
  }
  writeAll(all);
}

export function clearPosition(mint: string) {
  const all = readAll();
  if (all[mint]) {
    delete all[mint];
    writeAll(all);
  }
}
