import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Dev only: lets a second browser profile reach the dev server on 127.0.0.1
  // (a separate cookie jar) so two accounts can be driven side by side.
  allowedDevOrigins: ["127.0.0.1"],
  // Pin the workspace root so Turbopack doesn't pick up an unrelated parent lockfile.
  turbopack: {
    root: path.join(__dirname),
  },
  /* disable eslint & ts errors on production build if we want, but keeping them strict is better */
};

export default nextConfig;
