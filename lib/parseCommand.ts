// Converts Persian/Arabic-Indic digits to plain ASCII digits so users can
// type amounts either way, e.g. "۱.۵" -> "1.5".
function normalizeDigits(input: string): string {
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  return input.replace(/[۰-۹٠-٩]/g, (ch) => {
    const pIdx = persian.indexOf(ch);
    if (pIdx > -1) return String(pIdx);
    const aIdx = arabic.indexOf(ch);
    if (aIdx > -1) return String(aIdx);
    return ch;
  });
}

// Token symbols are matched case-insensitively; mint addresses are base58 and
// case-sensitive, so we never lowercase the whole command — only the parts we
// use for keyword matching (verbs, "to"/"for" words).
const TOKEN_CHARS = "a-zA-Z0-9";

export interface ParsedSwapCommand {
  kind: "swap";
  amount: number;
  fromToken: string; // symbol or raw mint address, original case preserved
  toToken: string;
  slippageBps?: number;
  raw: string;
}

export interface ParsedSendCommand {
  kind: "send";
  amount: number;
  token: string; // symbol or raw mint address; "SOL" if omitted
  recipient: string; // contact name or raw address, original case preserved
  raw: string;
}

export type ParsedCommand = ParsedSwapCommand | ParsedSendCommand;

export interface ParseResult {
  ok: boolean;
  command?: ParsedCommand;
  error?: string;
}

const SWAP_WORDS = ["swap", "trade", "exchange", "buy", "sell", "سواپ", "تبدیل", "معامله", "بخر", "بفروش"];
const SEND_WORDS = ["send", "transfer", "ارسال", "انتقال", "بفرست"];
const TO_WORDS = ["to", "for", "into", "به", "برای"];

function stripLeadingWord(text: string, words: string[]): { rest: string; matched: string | null } {
  for (const w of words) {
    const re = new RegExp(`^${w}\\s+`, "i");
    if (re.test(text)) return { rest: text.replace(re, ""), matched: w };
  }
  return { rest: text, matched: null };
}

function extractSlippage(text: string): { rest: string; slippageBps?: number } {
  const m = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:slippage)?|slippage\s*(\d+(?:\.\d+)?)\s*%?/i);
  if (!m) return { rest: text };
  const pct = parseFloat(m[1] ?? m[2]);
  if (Number.isNaN(pct)) return { rest: text };
  return { rest: text.replace(m[0], " ").trim(), slippageBps: Math.round(pct * 100) };
}

/**
 * Parses free-form text commands (English or Persian):
 *   "swap 1 SOL to USDC"
 *   "buy 0.2 SOL of <mint address>"          (shorthand -> swap SOL for X)
 *   "sell all BONK for SOL"                   ("all" resolved by the caller)
 *   "send 0.5 SOL to alice"                   (transfer, "alice" = saved contact)
 *   "سواپ 1 SOL به USDC" / "ارسال 1 SOL به علی"
 */
export function parseCommand(input: string): ParseResult {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Command is empty." };

  const normalized = normalizeDigits(raw);

  // --- try "send / transfer" first ---
  const sendStrip = stripLeadingWord(normalized, SEND_WORDS);
  if (sendStrip.matched) {
    const sendRegex = new RegExp(
      `([0-9]+(?:\\.[0-9]+)?)\\s+(?:([${TOKEN_CHARS}]+)\\s+)?(?:${TO_WORDS.join("|")})\\s+([\\S]+)`,
      "i"
    );
    const m = sendStrip.rest.match(sendRegex);
    if (!m) {
      return {
        ok: false,
        error: 'Couldn\'t understand the transfer. Try: "send 0.5 SOL to alice".',
      };
    }
    const amount = parseFloat(m[1]);
    if (!amount || amount <= 0) return { ok: false, error: "Amount must be a positive number." };
    return {
      ok: true,
      command: {
        kind: "send",
        amount,
        token: m[2] || "SOL",
        recipient: m[3],
        raw,
      },
    };
  }

  // --- otherwise try "swap / buy / sell" ---
  const swapStrip = stripLeadingWord(normalized, SWAP_WORDS);
  const verb = swapStrip.matched?.toLowerCase();
  const { rest, slippageBps } = extractSlippage(swapStrip.rest);

  // "buy <amount> <TOKEN>" defaults the source side to SOL; "sell <amount> <TOKEN>"
  // defaults the destination side to SOL, unless the user names both tokens explicitly.
  const twoTokenRegex = new RegExp(
    `([0-9]+(?:\\.[0-9]+)?)\\s+([${TOKEN_CHARS}]+)\\s+(?:${TO_WORDS.join("|")})\\s+([${TOKEN_CHARS}]+)`,
    "i"
  );
  const oneTokenRegex = new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s+([${TOKEN_CHARS}]+)`, "i");

  const twoMatch = rest.match(twoTokenRegex);
  if (twoMatch) {
    const amount = parseFloat(twoMatch[1]);
    if (!amount || amount <= 0) return { ok: false, error: "Amount must be a positive number." };
    const fromToken = twoMatch[2];
    const toToken = twoMatch[3];
    if (fromToken.toLowerCase() === toToken.toLowerCase())
      return { ok: false, error: "Input and output tokens must be different." };
    return { ok: true, command: { kind: "swap", amount, fromToken, toToken, slippageBps, raw } };
  }

  if (verb === "buy" || verb === "بخر" || verb === "sell" || verb === "بفروش") {
    const oneMatch = rest.match(oneTokenRegex);
    if (oneMatch) {
      const amount = parseFloat(oneMatch[1]);
      if (!amount || amount <= 0) return { ok: false, error: "Amount must be a positive number." };
      const token = oneMatch[2];
      const isBuy = verb === "buy" || verb === "بخر";
      return {
        ok: true,
        command: isBuy
          ? { kind: "swap", amount, fromToken: "SOL", toToken: token, slippageBps, raw }
          : { kind: "swap", amount, fromToken: token, toToken: "SOL", slippageBps, raw },
      };
    }
  }

  return {
    ok: false,
    error:
      'Couldn\'t understand the command. Try: "swap 1 SOL to USDC", "buy 0.2 SOL of <mint>", or "send 0.5 SOL to alice".',
  };
}
