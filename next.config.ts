import type { NextConfig } from "next";

import { HERO_IMAGE_HOSTS } from "./src/domain/hero-image-hosts";

const nextConfig: NextConfig = {
  // Next 16 removed `next lint` and with it the `eslint` config key. Linting
  // runs through the ESLint CLI instead -- see the `lint` script.
  reactStrictMode: true,

  /**
   * A self-contained server directory, for the container image.
   *
   * `next build` traces which files the server actually reaches and copies
   * only those into `.next/standalone`, so the runtime image needs no
   * `node_modules` and no `npm install` -- it copies a directory and runs
   * `node server.js`. That is the difference between an image that ships the
   * dependency tree and one that ships what the code touches.
   *
   * The tracing is why `serverExternalPackages` below matters more than it
   * looks: a package Next bundles is inlined and traced automatically, but one
   * declared external is `require`d at runtime, and the trace is what decides
   * whether it is in the image at all. Both entries there break when bundled
   * and would break differently if they were missing.
   */
  output: "standalone",

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

  /**
   * The hosts `next/image` may fetch from, read from the same array the form
   * validates against.
   *
   * **A wildcard hostname here would make the image optimiser an open proxy.**
   * `next/image` fetches whatever URL it is given, on this server, then caches
   * and re-serves it under this origin -- so "accept any image URL" is an
   * invitation to have this server fetch anything for anybody.
   *
   * Imported rather than restated. Two copies would drift, and the failure is
   * unpleasant in both directions: a host the form accepts and this rejects
   * throws at render time, on the page, after the recipe was saved.
   */
  images: {
    remotePatterns: HERO_IMAGE_HOSTS.map((hostname) => ({ protocol: "https", hostname }) as const),
  },
};

export default nextConfig;
