"use client";

import { useCallback, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";

import { parseCommand } from "./parseCommand";
import { getQuote, getSwapTransaction, formatAmount, toRawAmount, SOL_MINT } from "./jupiter";
import { resolveToken, resolveWalletBalance } from "./mint";
import { resolveRecipient } from "./contacts";
import { recordBuy, reducePosition } from "./positions";

export type LogKind = "command" | "info" | "quote" | "success" | "error" | "alert";

export interface LogEntry {
  id: number;
  kind: LogKind;
  text: string;
  href?: string;
}

let idCounter = 0;
const nextId = () => ++idCounter;

type PendingAction =
  | {
      kind: "swap";
      quote: any;
      fromMint: string;
      toMint: string;
      fromLabel: string;
      toLabel: string;
      fromAmountLabel: string;
      toAmountLabel: string;
      fromAmountRaw: number;
      toAmountRaw: number;
      minReceivedLabel: string;
      priceImpactPct: number;
      slippagePct: number;
    }
  | {
      kind: "send";
      isNative: boolean;
      mint: string;
      decimals: number;
      rawAmount: string;
      amountLabel: string;
      tokenLabel: string;
      recipientAddress: string;
      recipientLabel: string;
    };

const CONFIRM_WORDS = ["confirm", "yes", "تایید", "بله"];
const CANCEL_WORDS = ["cancel", "no", "n", "لغو", "کنسل", "نه"];

export function useTradeAgent() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();

  const [log, setLog] = useState<LogEntry[]>([
    {
      id: nextId(),
      kind: "info",
      text:
        'Connect a wallet, then type a command such as "swap 0.1 SOL to USDC" or "send 0.2 SOL to alice". Every trade or transfer shows a preview first — nothing sends until you confirm.',
    },
  ]);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const pushLog = useCallback((kind: LogKind, text: string, href?: string) => {
    setLog((prev) => [...prev, { id: nextId(), kind, text, href }]);
    return undefined;
  }, []);

  const startSwap = useCallback(
    async (fromToken: string, toToken: string, amountInput: number | "all", slippageBps?: number) => {
      if (!publicKey) {
        pushLog("error", "No wallet connected yet.");
        return;
      }
      setBusy(true);
      pushLog(
        "info",
        `Fetching a route: ${amountInput === "all" ? "all" : amountInput} ${fromToken} \u2192 ${toToken}\u2026`
      );
      try {
        const from = await resolveToken(connection, fromToken);
        const to = await resolveToken(connection, toToken);
        if (!from) {
          pushLog("error", `Unknown token "${fromToken}". Use a known symbol or paste the mint address.`);
          return;
        }
        if (!to) {
          pushLog("error", `Unknown token "${toToken}". Use a known symbol or paste the mint address.`);
          return;
        }

        let amount: number;
        if (amountInput === "all") {
          amount = await resolveWalletBalance(connection, publicKey, from);
          if (amount <= 0) {
            pushLog("error", `No spendable ${from.symbol} balance found in this wallet.`);
            return;
          }
        } else {
          amount = amountInput;
        }

        const rawAmount = toRawAmount(amount, from.decimals);
        const quote = await getQuote({ fromMint: from.mint, toMint: to.mint, rawAmount, slippageBps });
        if (quote.error) {
          pushLog("error", `No route found: ${quote.error}`);
          return;
        }
        const toAmountLabel = formatAmount(quote.outAmount, to.decimals);
        const toAmountRaw = Number(quote.outAmount) / 10 ** to.decimals;
        const priceImpact = Number(quote.priceImpactPct ?? 0) * 100;
        const slippagePct = (quote.slippageBps ?? 50) / 100;
        const minReceivedRaw = quote.otherAmountThreshold
          ? Number(quote.otherAmountThreshold) / 10 ** to.decimals
          : toAmountRaw * (1 - slippagePct / 100);
        const minReceivedLabel = formatAmount(
          quote.otherAmountThreshold ?? Math.floor(minReceivedRaw * 10 ** to.decimals),
          to.decimals
        );

        pushLog(
          "quote",
          "Review before signing:\n" +
            `  \u2022 Action: Swap (via Jupiter aggregator, Solana mainnet)\n` +
            `  \u2022 You send: ${amount} ${from.symbol}\n` +
            `  \u2022 You receive (estimated): ${toAmountLabel} ${to.symbol}\n` +
            `  \u2022 Minimum received if price moves against you: ${minReceivedLabel} ${to.symbol}\n` +
            `  \u2022 Price impact: ${priceImpact.toFixed(3)}%\n` +
            `  \u2022 Slippage tolerance: ${slippagePct}%\n` +
            `  \u2022 Network fee: ~0.000005 SOL (+ rent if a new token account is needed)\n` +
            `Type "confirm" to sign and broadcast this exact transaction with your wallet, or anything else to cancel.`
        );
        setPendingAction({
          kind: "swap",
          quote,
          fromMint: from.mint,
          toMint: to.mint,
          fromLabel: from.symbol,
          toLabel: to.symbol,
          fromAmountLabel: String(amount),
          toAmountLabel,
          fromAmountRaw: amount,
          toAmountRaw,
          minReceivedLabel,
          priceImpactPct: priceImpact,
          slippagePct,
        });
      } catch (err: any) {
        pushLog("error", err?.message ?? "Failed to fetch a quote.");
      } finally {
        setBusy(false);
      }
    },
    [connection, publicKey, pushLog]
  );

  const startSend = useCallback(
    async (tokenText: string, amount: number, recipientText: string) => {
      if (!publicKey) {
        pushLog("error", "No wallet connected yet.");
        return;
      }
      const recipient = resolveRecipient(recipientText);
      if (!recipient) {
        pushLog(
          "error",
          `Couldn't resolve recipient "${recipientText}". Add them as a contact first, or paste a full address.`
        );
        return;
      }
      setBusy(true);
      try {
        const isNative = tokenText.toUpperCase() === "SOL";
        if (isNative) {
          const rawAmount = toRawAmount(amount, 9);
          pushLog(
            "quote",
            "Review before signing:\n" +
              `  \u2022 Action: Transfer (System Program, Solana mainnet)\n` +
              `  \u2022 You send: ${amount} SOL\n` +
              `  \u2022 To: ${recipient.label} (${recipient.address.slice(0, 4)}\u2026${recipient.address.slice(-4)})\n` +
              `  \u2022 Network fee: ~0.000005 SOL\n` +
              `Type "confirm" to sign and broadcast this exact transaction with your wallet, or anything else to cancel.`
          );
          setPendingAction({
            kind: "send",
            isNative: true,
            mint: SOL_MINT,
            decimals: 9,
            rawAmount,
            amountLabel: String(amount),
            tokenLabel: "SOL",
            recipientAddress: recipient.address,
            recipientLabel: recipient.label,
          });
        } else {
          const token = await resolveToken(connection, tokenText);
          if (!token) {
            pushLog("error", `Unknown token "${tokenText}". Use a known symbol or paste the mint address.`);
            return;
          }
          const rawAmount = toRawAmount(amount, token.decimals);
          pushLog(
            "quote",
            "Review before signing:\n" +
              `  \u2022 Action: Transfer (SPL Token, Solana mainnet)\n` +
              `  \u2022 You send: ${amount} ${token.symbol}\n` +
              `  \u2022 To: ${recipient.label} (${recipient.address.slice(0, 4)}\u2026${recipient.address.slice(-4)})\n` +
              `  \u2022 Network fee: ~0.000005 SOL (+ rent if the recipient needs a new token account)\n` +
              `Type "confirm" to sign and broadcast this exact transaction with your wallet, or anything else to cancel.`
          );
          setPendingAction({
            kind: "send",
            isNative: false,
            mint: token.mint,
            decimals: token.decimals,
            rawAmount,
            amountLabel: String(amount),
            tokenLabel: token.symbol,
            recipientAddress: recipient.address,
            recipientLabel: recipient.label,
          });
        }
      } catch (err: any) {
        pushLog("error", err?.message ?? "Failed to prepare the transfer.");
      } finally {
        setBusy(false);
      }
    },
    [connection, publicKey, pushLog]
  );

  const executeConfirmedAction = useCallback(async () => {
    if (!pendingAction || !publicKey || !signTransaction) return;
    setBusy(true);
    try {
      if (pendingAction.kind === "swap") {
        pushLog("info", "Building transaction and requesting your signature\u2026");
        const swapTxBase64 = await getSwapTransaction(pendingAction.quote, publicKey.toBase58());
        const tx = VersionedTransaction.deserialize(Buffer.from(swapTxBase64, "base64"));
        const signed = await signTransaction(tx);
        const signature = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });
        pushLog("info", `Submitted. Confirming ${signature.slice(0, 12)}\u2026`);
        const latestBlockhash = await connection.getLatestBlockhash();
        const confirmation = await connection.confirmTransaction({ signature, ...latestBlockhash }, "confirmed");
        if (confirmation.value.err) {
          pushLog("error", `Transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
        } else {
          if (pendingAction.fromMint === SOL_MINT) {
            recordBuy(pendingAction.toMint, pendingAction.fromAmountRaw, pendingAction.toAmountRaw);
          } else if (pendingAction.toMint === SOL_MINT) {
            reducePosition(pendingAction.fromMint, pendingAction.fromAmountRaw);
          }
          pushLog(
            "success",
            `Swapped ${pendingAction.fromAmountLabel} ${pendingAction.fromLabel} \u2192 ${pendingAction.toAmountLabel} ${pendingAction.toLabel}.`,
            `https://solscan.io/tx/${signature}`
          );
        }
      } else {
        pushLog("info", "Building transfer and requesting your signature\u2026");
        const tx = new Transaction();
        const recipientPk = new PublicKey(pendingAction.recipientAddress);

        if (pendingAction.isNative) {
          tx.add(
            SystemProgram.transfer({
              fromPubkey: publicKey,
              toPubkey: recipientPk,
              lamports: Number(pendingAction.rawAmount),
            })
          );
        } else {
          const mintPk = new PublicKey(pendingAction.mint);
          const sourceAta = await getAssociatedTokenAddress(mintPk, publicKey);
          const destAta = await getAssociatedTokenAddress(mintPk, recipientPk);
          const destInfo = await connection.getAccountInfo(destAta);
          if (!destInfo) {
            tx.add(createAssociatedTokenAccountInstruction(publicKey, destAta, recipientPk, mintPk));
          }
          tx.add(
            createTransferInstruction(sourceAta, destAta, publicKey, BigInt(pendingAction.rawAmount))
          );
        }

        const latestBlockhash = await connection.getLatestBlockhash();
        tx.recentBlockhash = latestBlockhash.blockhash;
        tx.feePayer = publicKey;
        const signed = await signTransaction(tx);
        const signature = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });
        pushLog("info", `Submitted. Confirming ${signature.slice(0, 12)}\u2026`);
        const confirmation = await connection.confirmTransaction({ signature, ...latestBlockhash }, "confirmed");
        if (confirmation.value.err) {
          pushLog("error", `Transfer failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
        } else {
          pushLog(
            "success",
            `Sent ${pendingAction.amountLabel} ${pendingAction.tokenLabel} to ${pendingAction.recipientLabel}.`,
            `https://solscan.io/tx/${signature}`
          );
        }
      }
    } catch (err: any) {
      pushLog("error", err?.message ?? "Transaction failed or was rejected.");
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  }, [pendingAction, publicKey, signTransaction, connection, pushLog]);

  /** Runs a free-text command, or resolves a pending confirm/cancel step. */
  const runCommand = useCallback(
    async (commandText: string) => {
      const text = commandText.trim();
      if (!text || busy) return;

      pushLog("command", text);

      if (pendingAction) {
        if (CONFIRM_WORDS.includes(text.toLowerCase())) {
          await executeConfirmedAction();
          return;
        }
        if (CANCEL_WORDS.includes(text.toLowerCase())) {
          pushLog("info", "Cancelled.");
          setPendingAction(null);
          return;
        }
        // Anything else is treated as a brand-new command that supersedes the
        // pending one — cancel it and fall through to parse `text` below,
        // instead of silently discarding the command the person just typed.
        pushLog("info", "Previous pending action cancelled \u2014 running your new command instead.");
        setPendingAction(null);
      }

      if (!connected || !publicKey) {
        pushLog("error", 'No wallet connected yet. Click "Select Wallet" above first.');
        return;
      }

      const parsed = parseCommand(text);
      if (!parsed.ok || !parsed.command) {
        pushLog("error", parsed.error ?? "Could not parse that command.");
        return;
      }

      if (parsed.command.kind === "swap") {
        const { amount, fromToken, toToken, slippageBps } = parsed.command;
        await startSwap(fromToken, toToken, amount, slippageBps);
      } else {
        const { amount, token, recipient } = parsed.command;
        await startSend(token, amount, recipient);
      }
    },
    [busy, pendingAction, connected, publicKey, pushLog, executeConfirmedAction, startSwap, startSend]
  );

  return { log, busy, pendingAction, connected, publicKey, runCommand, pushLog };
}
