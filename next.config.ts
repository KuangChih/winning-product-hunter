import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // PGlite (local demo database) loads WebAssembly by file path and must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  partialPrefetching: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // The data-sources page became the discovery page (source health is shown there).
  async redirects() {
    return [
      { source: "/sources", destination: "/discover", permanent: true },
      { source: "/:lang(en|zh-TW)/sources", destination: "/:lang/discover", permanent: true },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
