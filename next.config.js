/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    if (!isServer) {
      config.resolve.fallback.buffer = require.resolve("buffer/");
    }
    return config;
  },
};

module.exports = nextConfig;
