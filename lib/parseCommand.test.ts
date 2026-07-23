import { describe, it, expect } from "vitest";
import { parseCommand } from "./parseCommand";

const MINT_A = "9kFcxV4s75ctSAjX6NLfcmPx1vuJom22RVrSGSitpump";
const MINT_B = "3woeEPMcH9eNnfzvnXBLjeAqAXberTi987H2KZEUpump";

describe("parseCommand — basic swap grammar", () => {
  it("parses a plain swap", () => {
    const r = parseCommand("swap 1 SOL to USDC");
    expect(r.ok).toBe(true);
    expect(r.command).toMatchObject({ kind: "swap", amount: 1, fromToken: "SOL", toToken: "USDC" });
  });

  it("parses trade/exchange as swap synonyms", () => {
    expect(parseCommand("trade 2 SOL for USDC").command).toMatchObject({ fromToken: "SOL", toToken: "USDC" });
    expect(parseCommand("exchange 2 SOL into USDC").command).toMatchObject({ fromToken: "SOL", toToken: "USDC" });
  });

  it("rejects swapping a token for itself", () => {
    const r = parseCommand("swap 1 SOL to sol");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/different/i);
  });

  it("rejects empty input", () => {
    expect(parseCommand("").ok).toBe(false);
    expect(parseCommand("   ").ok).toBe(false);
  });

  it("rejects unparsable gibberish with a helpful example", () => {
    const r = parseCommand("do a flip please");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/swap 1 SOL to USDC/);
  });

  it("preserves mixed-case mint addresses exactly (base58 is case-sensitive)", () => {
    // A regression guard: an earlier version uppercased token references,
    // which corrupts a pasted mint address since base58 is case-sensitive.
    const mixedCase = "AbCdEfGh1234567890AbCdEfGh1234567890AbCd12";
    const r = parseCommand(`swap 1 SOL to ${mixedCase}`);
    expect(r.ok).toBe(true);
    expect((r.command as any).toToken).toBe(mixedCase);
  });
});

describe("parseCommand — buy/sell shorthand", () => {
  it('parses "buy <amount> <TOKEN>" defaulting the source to SOL', () => {
    const r = parseCommand("buy 0.2 BONK");
    expect(r.ok).toBe(true);
    expect(r.command).toMatchObject({ kind: "swap", amount: 0.2, fromToken: "SOL", toToken: "BONK" });
  });

  it('parses "sell <amount> <TOKEN>" defaulting the destination to SOL', () => {
    const r = parseCommand("sell 100 BONK");
    expect(r.ok).toBe(true);
    expect(r.command).toMatchObject({ kind: "swap", amount: 100, fromToken: "BONK", toToken: "SOL" });
  });

  // Regression test: the Market Scanner's quick-buy button sends
  // "buy <amount> SOL of <mint>", which requires "of" to be recognized as a
  // connector word. An earlier version didn't recognize "of", so this
  // silently matched only "<amount> SOL" and dropped the mint entirely,
  // producing a bogus SOL -> SOL swap.
  it('parses "buy <amount> SOL of <mint>" as a single swap to the mint (not SOL -> SOL)', () => {
    const r = parseCommand(`buy 0.01 SOL of ${MINT_A}`);
    expect(r.ok).toBe(true);
    expect(r.command).toMatchObject({ kind: "swap", amount: 0.01, fromToken: "SOL", toToken: MINT_A });
  });

  it('parses the Persian equivalent with "از"', () => {
    const r = parseCommand(`بخر 0.01 SOL از ${MINT_A}`);
    expect(r.ok).toBe(true);
    expect(r.command).toMatchObject({ fromToken: "SOL", toToken: MINT_A });
  });

  // Regression test: the "Sell all X" button sends "sell all <mint> for SOL".
  it('parses "sell all <mint> for SOL"', () => {
    const r = parseCommand(`sell all ${MINT_B} for SOL`);
    expect(r.ok).toBe(true);
    expect(r.command).toMatchObject({ kind: "swap", amount: "all", fromToken: MINT_B, toToken: "SOL" });
  });

  it('parses "همه" as the Persian equivalent of "all"', () => {
    const r = parseCommand(`بفروش همه ${MINT_B} به SOL`);
    expect(r.ok).toBe(true);
    expect((r.command as any).amount).toBe("all");
  });

  it('rejects "buy all X" since "all" only makes sense for selling', () => {
    const r = parseCommand("buy all BONK");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/only makes sense for selling/i);
  });
});

describe("parseCommand — amount parsing edge cases", () => {
  // Regression test: '1e-7' was previously matched only from its trailing
  // digits ('7'), because the amount pattern didn't account for scientific
  // notation — silently producing a wildly wrong amount instead of an error.
  it("parses scientific notation amounts correctly, not just the trailing digits", () => {
    const r = parseCommand(`sell 1e-7 ${MINT_A} for SOL`);
    expect(r.ok).toBe(true);
    expect((r.command as any).amount).toBe(1e-7);
  });

  it("parses scientific notation with a positive exponent", () => {
    const r = parseCommand(`sell 1.5e3 ${MINT_A} for SOL`);
    expect(r.ok).toBe(true);
    expect((r.command as any).amount).toBe(1500);
  });

  it("normalizes Persian and Arabic-Indic digits", () => {
    const r = parseCommand("سواپ ۱.۵ SOL به USDC");
    expect(r.ok).toBe(true);
    expect((r.command as any).amount).toBe(1.5);
  });

  it("rejects a zero or negative amount", () => {
    expect(parseCommand("swap 0 SOL to USDC").ok).toBe(false);
    expect(parseCommand("swap -1 SOL to USDC").ok).toBe(false);
  });

  it("accepts multi-decimal amounts", () => {
    const r = parseCommand("swap 0.000123 SOL to USDC");
    expect((r.command as any).amount).toBe(0.000123);
  });
});

describe("parseCommand — slippage clause", () => {
  it("extracts an explicit slippage percentage", () => {
    const r = parseCommand("swap 1 SOL to USDC with 1% slippage");
    expect(r.ok).toBe(true);
    expect(r.command).toMatchObject({ fromToken: "SOL", toToken: "USDC", slippageBps: 100 });
  });

  it("defaults to no explicit slippage when not mentioned", () => {
    const r = parseCommand("swap 1 SOL to USDC");
    expect((r.command as any).slippageBps).toBeUndefined();
  });
});

describe("parseCommand — send/transfer grammar", () => {
  it("parses a native SOL transfer to a named contact", () => {
    const r = parseCommand("send 0.5 SOL to alice");
    expect(r.ok).toBe(true);
    expect(r.command).toMatchObject({ kind: "send", amount: 0.5, token: "SOL", recipient: "alice" });
  });

  it("parses a transfer to a raw address", () => {
    const r = parseCommand(`send 1 USDC to ${MINT_A}`);
    expect(r.ok).toBe(true);
    expect(r.command).toMatchObject({ kind: "send", amount: 1, token: "USDC", recipient: MINT_A });
  });

  it("defaults the token to SOL when omitted", () => {
    const r = parseCommand("transfer 2 to alice");
    expect(r.ok).toBe(true);
    expect((r.command as any).token).toBe("SOL");
  });

  it("parses the Persian equivalent", () => {
    const r = parseCommand("ارسال 0.5 SOL به علی");
    expect(r.ok).toBe(true);
    expect(r.command).toMatchObject({ kind: "send", amount: 0.5, recipient: "علی" });
  });

  it("rejects an unparsable transfer", () => {
    const r = parseCommand("send money to alice");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/send 0.5 SOL to alice/);
  });
});
