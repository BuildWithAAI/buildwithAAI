import type { NextConfig } from "next";
import { securityHeaders } from "./src/auth/publicMode";

const nextConfig: NextConfig = {
  serverExternalPackages: ["node:sqlite"],
  poweredByHeader: false,
  webpack: (config, { nextRuntime }) => {
    if (nextRuntime === "edge") {
      config.plugins.push({
        apply(compiler: { hooks: { normalModuleFactory: { tap: (name: string, fn: (factory: { hooks: { beforeResolve: { tap: (name: string, fn: (data: { request?: string }) => false | void) => void } } }) => void) => void } } }) {
          compiler.hooks.normalModuleFactory.tap("lumen-edge", (factory) => {
            factory.hooks.beforeResolve.tap("lumen-edge", (data) => {
              const request = data.request ?? "";
              if (request === "./server/engine" || request.endsWith("/server/engine")) return false;
            });
          });
        },
      });
    }
    return config;
  },
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
