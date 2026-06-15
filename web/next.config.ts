import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    dangerouslyAllowLocalIP: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "3001",
      },
      {
        protocol: "http",
        hostname: "localhost",
        port: "3001",
      },
    ],
  },
};

export default nextConfig;
