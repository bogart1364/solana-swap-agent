"use client";

// Wallet state is inherently per-browser-session, so this page should never
// be statically prerendered at build time (that's also what triggered the
// "Endpoint URL must start with http/https" build failure when an env var
// was malformed — prerendering ran the wallet provider code during the
// build itself).
export const dynamic = "force-dynamic";

import { useTradeAgent } from "@/lib/useTradeAgent";
import { TriangleAlert } from "lucide-react";
import ConsolePanel from "@/components/ConsolePanel";
import MarketScanner from "@/components/MarketScanner";
import PortfolioWatch from "@/components/PortfolioWatch";
import ContactsPanel from "@/components/ContactsPanel";

export default function Home() {
  const { log, busy, pendingAction, runCommand, pushLog } = useTradeAgent();
  const usingPublicRpc = !process.env.NEXT_PUBLIC_SOLANA_RPC_URL;

  return (
    <main className="page">
      <p className="page-title">{"Solana \u00b7 Non-custodial \u00b7 Jupiter-routed"}</p>
      <h1 className="page-subtitle">
        Tell it what to trade. <span className="accent">Your wallet signs it.</span>
      </h1>

      {usingPublicRpc && (
        <div className="rpc-warning">
          <TriangleAlert size={14} strokeWidth={2.2} />
          <span>
            {"No custom RPC configured \u2014 using the public mainnet-beta endpoint, which " +
              "frequently blocks or rate-limits browser requests (you'll see quotes, balances, and " +
              "swaps fail with 403/429). Set "}
            <code>NEXT_PUBLIC_SOLANA_RPC_URL</code>
            {" in your deployment's environment variables to a real provider (Helius, QuickNode, Triton) and redeploy."}
          </span>
        </div>
      )}

      <div className="dashboard">
        <div className="dashboard-col">
          <ConsolePanel log={log} busy={busy} hasPending={!!pendingAction} runCommand={runCommand} />
          <ContactsPanel />
        </div>
        <div className="dashboard-col">
          <MarketScanner
            runCommand={runCommand}
            pushLog={pushLog}
            hasPending={!!pendingAction}
            busy={busy}
          />
          <PortfolioWatch runCommand={runCommand} pushLog={pushLog} hasPending={!!pendingAction} busy={busy} />
        </div>
      </div>
    </main>
  );
}
