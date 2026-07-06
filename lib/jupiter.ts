// Free, no-API-key tier of Jupiter's Swap API. It is rate limited, which is
// fine for an interactive single-user agent. For production/high volume,
// get a key at https://portal.jup.ag and switch this to https://api.jup.ag
// (adding the "x-api-key" header in the fetch calls below).
const JUP_BASE = "https://lite-api.jup.ag/swap/v1";

export const SOL_MINT = "So11111111111111111111111111111111111111112";

export interface QuoteParams {
  fromMint: string;
  toMint: string;
  rawAmount: string; // integer, smallest units of fromMint
  slippageBps?: number; // default 50 = 0.5%
}

export async function getQuote({ fromMint, toMint, rawAmount, slippageBps }: QuoteParams) {
  const params = new URLSearchParams({
    inputMint: fromMint,
    outputMint: toMint,
    amount: rawAmount,
    slippageBps: String(slippageBps ?? 50),
  });

  const res = await fetch(`${JUP_BASE}/quote?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jupiter quote failed (${res.status}): ${body}`);
  }
  return res.json();
}

export async function getSwapTransaction(quoteResponse: unknown, userPublicKey: string) {
  const res = await fetch(`${JUP_BASE}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      // Let Jupiter's routing engine pick sensible compute unit + priority fee defaults.
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
      wrapAndUnwrapSol: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jupiter swap build failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.swapTransaction as string; // base64-encoded VersionedTransaction
}

// Converts a raw (integer, smallest-unit) amount back to a human-readable string.
export function formatAmount(raw: string | number, decimals: number): string {
  const value = Number(raw) / 10 ** decimals;
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function toRawAmount(humanAmount: number, decimals: number): string {
  return Math.round(humanAmount * 10 ** decimals).toString();
}
