const runtimeExternalPackageIncludes = [
  './node_modules/@ffprobe-installer/ffprobe/**/*',
  './node_modules/@livekit/**/*',
  './node_modules/@remotion/bundler/**/*',
  './node_modules/@remotion/renderer/**/*',
  './node_modules/@remotion/studio/**/*',
  './node_modules/@rspack/**/*',
  './node_modules/@runwayml/avatars-node-rpc/**/*',
  './node_modules/esbuild/**/*',
  './node_modules/get-audio-duration/**/*',
  './node_modules/remotion/**/*',
  './src/remotion/**/*',
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  outputFileTracingIncludes: {
    '/api/avatar/session': runtimeExternalPackageIncludes,
    '/api/pipeline/*': runtimeExternalPackageIncludes,
  },
  serverExternalPackages: [
    'get-audio-duration',
    '@ffprobe-installer/ffprobe',
    '@remotion/bundler',
    '@remotion/renderer',
    '@runwayml/avatars-node-rpc',
    '@livekit/rtc-node',
    '@livekit/rtc-ffi-bindings',
  ],
};

module.exports = nextConfig;
