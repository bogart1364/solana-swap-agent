export default function BrandLogo({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-label="Swap Agent logo" role="img">
      <defs>
        <linearGradient id="brandLogoGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#9945FF" />
          <stop offset="100%" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="24" height="24" rx="7" fill="url(#brandLogoGrad)" />
      <path
        d="M7 9.3H16.8M16.8 9.3L13.6 6.1M16.8 9.3L13.6 12.5"
        stroke="white"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M17 14.7H7.2M7.2 14.7L10.4 11.5M7.2 14.7L10.4 17.9"
        stroke="white"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
