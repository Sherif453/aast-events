import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  //  Hide Supabase source map warnings (they're harmless noise)
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.ignoreWarnings = [
        ...(config.ignoreWarnings || []),
        { module: /node_modules\/@supabase\/auth-js/ },
      ];
    }
    return config;
  },

  // Empty turbopack config to silence the warning
  turbopack: {},
};

export default nextConfig;