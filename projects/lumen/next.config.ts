import type { NextConfig } from "next";
import { securityHeaders } from "./src/auth/publicMode";

const nextConfig: NextConfig = {
  serverExternalPackages: ["node:sqlite"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(true),
      },
    ];
  },
};

export default nextConfig;
