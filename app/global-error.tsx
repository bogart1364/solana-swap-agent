"use client";

import { useEffect } from "react";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Swap Agent crashed at the root layout:", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="page">
          <div className="error-boundary">
            <h1>Something broke in the interface</h1>
            <p>
              This is a UI error, not a wallet or funds issue — nothing signs or sends without
              your explicit confirmation. Try reloading the page.
            </p>
            <button className="error-boundary-retry" onClick={reset}>
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
