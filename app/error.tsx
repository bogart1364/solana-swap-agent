"use client";

import { useEffect } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Client-side only — no analytics/reporting wired up, so at minimum this
    // shows up in the browser console instead of vanishing silently.
    console.error("Swap Agent crashed:", error);
  }, [error]);

  return (
    <main className="page">
      <div className="error-boundary">
        <TriangleAlert size={28} strokeWidth={2} />
        <h1>Something broke in the interface</h1>
        <p>
          This is a UI error, not a wallet or funds issue — nothing signs or sends without your
          explicit confirmation, and this crash doesn't change that. Refreshing usually clears it.
        </p>
        {error?.message && <code className="error-boundary-detail">{error.message}</code>}
        <button className="error-boundary-retry" onClick={reset}>
          <RefreshCw size={14} strokeWidth={2.4} /> Try again
        </button>
      </div>
    </main>
  );
}
