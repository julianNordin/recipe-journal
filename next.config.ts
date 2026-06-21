import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 removed `next lint` and with it the `eslint` config key. Linting
  // runs through the ESLint CLI instead -- see the `lint` script.
  reactStrictMode: true,
};

export default nextConfig;
