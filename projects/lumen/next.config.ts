import type { NextConfig } from "next";
import { publicModeOn, securityHeaders } from "./src/auth/publicMode";

const nextConfig: NextConfig = {
  serverExternalPackages: ["node:sqlite"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(publicModeOn()),
      },
    ];
  },
};

export default nextConfig;
