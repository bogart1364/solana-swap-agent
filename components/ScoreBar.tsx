export type ScoreTone = "good" | "mid" | "bad";

export function toneForScore(score: number): ScoreTone {
  if (score >= 70) return "good";
  if (score >= 40) return "mid";
  return "bad";
}

/** A labeled 0-100 score as a colored horizontal bar, plus an icon cue. */
export default function ScoreBar({
  score,
  label,
  icon,
}: {
  score: number;
  label: string;
  icon: React.ReactNode;
}) {
  const pct = Math.max(0, Math.min(100, score));
  const tone = toneForScore(pct);
  return (
    <div className="score-bar-wrap">
      <span className="score-bar-icon">{icon}</span>
      <span className="score-bar-label">{label}</span>
      <div className="score-bar-track">
        <div className={`score-bar-fill score-bar-${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="score-bar-value">{pct}/100</span>
    </div>
  );
}
