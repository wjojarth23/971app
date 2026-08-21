import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  output: 'standalone',
  async redirects() {
    return [
      {
        source: '/settings', 
        destination: '/settings/personal',
        permanent: true,
      },
    ];
  }
};

export default nextConfig;
