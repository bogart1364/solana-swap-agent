"use client";

import { useTradeAgent } from "@/lib/useTradeAgent";
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
          {"\u26a0 No custom RPC configured \u2014 using the public mainnet-beta endpoint, which " +
            "frequently blocks or rate-limits browser requests (you'll see quotes, balances, and " +
            "swaps fail with 403/429). Set "}
          <code>NEXT_PUBLIC_SOLANA_RPC_URL</code>
          {" in your deployment's environment variables to a real provider (Helius, QuickNode, Triton) and redeploy."}
        </div>
      )}

      <div className="dashboard">
        <div className="dashboard-col">
          <ConsolePanel log={log} busy={busy} hasPending={!!pendingAction} runCommand={runCommand} />
          <ContactsPanel />
        </div>
        <div className="dashboard-col">
          <MarketScanner runCommand={runCommand} />
          <PortfolioWatch runCommand={runCommand} pushLog={pushLog} />
        </div>
      </div>
    </main>
  );
}
