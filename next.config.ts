import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ['get-audio-duration', '@ffprobe-installer/ffprobe'],
};

export default nextConfig;
