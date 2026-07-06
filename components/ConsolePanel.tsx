"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { LogEntry } from "@/lib/useTradeAgent";

// The wallet button reads browser-only wallet state (which extensions are
// installed), so its first client render never matches the server-rendered
// HTML. Disabling SSR for it avoids the hydration mismatch entirely.
const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false }
);

export default function ConsolePanel({
  log,
  busy,
  hasPending,
  runCommand,
}: {
  log: LogEntry[];
  busy: boolean;
  hasPending: boolean;
  runCommand: (text: string) => void | Promise<void>;
}) {
  const [input, setInput] = useState("");
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    runCommand(text);
  };

  return (
    <div className="console">
      <header className="console-header">
        <div className="brand">
          <span className="dot" />
          Swap Agent
        </div>
        <WalletMultiButton />
      </header>

      <div className="log" role="log" aria-live="polite">
        {log.map((entry) => (
          <div key={entry.id} className={`log-line log-${entry.kind}`}>
            {entry.kind === "command" ? <span className="prompt">{"\u203A"}</span> : null}
            <span className="log-text">
              {entry.text}
              {entry.href && (
                <>
                  {" "}
                  <a href={entry.href} target="_blank" rel="noreferrer">
                    {"view on Solscan \u2197"}
                  </a>
                </>
              )}
            </span>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <span className="composer-prompt">{"\u203A"}</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            hasPending
              ? 'Type "confirm" to send, or anything else to cancel'
              : 'e.g. "swap 0.1 SOL to USDC" or "send 0.2 SOL to alice"'
          }
          disabled={busy}
          spellCheck={false}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          {busy ? "\u2026" : "Run"}
        </button>
      </form>

      <p className="hint">
        Every command only previews first — a quote for swaps, an amount + recipient for
        transfers. Nothing is sent to the network until you type <code>confirm</code> and approve
        it in your wallet.
      </p>
    </div>
  );
}
