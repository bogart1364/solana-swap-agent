"use client";

import { useTradeAgent } from "@/lib/useTradeAgent";
import ConsolePanel from "@/components/ConsolePanel";
import MarketScanner from "@/components/MarketScanner";
import PortfolioWatch from "@/components/PortfolioWatch";
import ContactsPanel from "@/components/ContactsPanel";

export default function Home() {
  const { log, busy, pendingAction, runCommand, pushLog } = useTradeAgent();

  return (
    <main className="page">
      <p className="page-title">{"Solana \u00b7 Non-custodial \u00b7 Jupiter-routed"}</p>
      <h1 className="page-subtitle">
        Tell it what to trade. <span className="accent">Your wallet signs it.</span>
      </h1>

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
