import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 removed `next lint` and with it the `eslint` config key. Linting
  // runs through the ESLint CLI instead -- see the `lint` script.
  reactStrictMode: true,

  /**
   * Packages the server build must `require` at runtime rather than bundle.
   *
   * Both of these break when bundled, for different reasons. The generated
   * Prisma client resolves engine files relative to its own location on disk,
   * which a bundle moves. `@node-rs/argon2` is a native napi module: its
   * binding is a `.node` binary that no JavaScript bundler can inline, and the
   * platform-specific package is chosen at require time.
   *
   * It matters most where it is hardest to debug -- Phase 21's `standalone`
   * output traces exactly these requires to decide what to copy into the
   * image, so a wrong answer here surfaces as a container that builds and then
   * cannot start.
   */
  serverExternalPackages: ["@prisma/client", "@node-rs/argon2"],
};

export default nextConfig;
