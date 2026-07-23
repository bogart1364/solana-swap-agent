/** @type {import('next').NextConfig} */

// Content-Security-Policy notes (read before loosening any of this):
// - script-src needs 'unsafe-inline': Next.js App Router injects small
//   inline bootstrap scripts for RSC/hydration streaming
//   (`self.__next_f.push(...)`) as a core, unavoidable part of how it
//   works — verified by inspecting the actual build output, not assumed.
//   A nonce-based CSP would avoid this, but this Next.js version has its
//   own known nonce-related XSS advisory (GHSA-ffhc-5mcf-pf4q), and a
//   hash-based allowlist isn't practical since bundle content (and hence
//   hashes) changes every build. The residual risk is mitigated by the
//   fact that this app has no dangerouslySetInnerHTML, no eval, and never
//   renders untrusted user content as HTML — verified, not assumed.
// - style-src needs 'unsafe-inline' because a couple of components set
//   inline `style` (e.g. the score bar's dynamic width) — a much smaller
//   XSS surface than inline scripts, which is the one that actually matters.
// - connect-src includes a broad `https:` because the Solana RPC endpoint is
//   deployment-configurable (NEXT_PUBLIC_SOLANA_RPC_URL can point at Helius,
//   QuickNode, Triton, Alchemy, or anything else) — there's no fixed origin
//   to allowlist.
// - img-src includes data: for the custom SVG cursor (a data: URI) and the
//   site icons.
// - No remote script/style/frame hosts are allowlisted anywhere: this app
//   loads no third-party scripts and embeds no third-party frames.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  webpack: (config, { isServer }) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    if (!isServer) {
      config.resolve.fallback.buffer = require.resolve("buffer/");
    }
    return config;
  },
};

module.exports = nextConfig;
