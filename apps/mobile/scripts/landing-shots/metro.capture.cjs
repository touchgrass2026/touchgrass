// Landing-page screenshots (D-226): Metro override that runs the app in a browser for capture.mjs. Never shipped.
//
// The app has no web target. For screenshots only, Expo's web bundler runs it with react-native-web installed
// outside the repo, and the native-only modules the screens touch swapped for the small stand-ins in ./stubs
// (maps, secure storage, push, Firebase, view-shot). The app's own metro.config.js and package.json are untouched.
//
// Whole pipeline (local throwaway stack; nothing here touches the dev or test databases):
//   1. docker compose -p tgcapture -f infra/docker/docker-compose.yml up -d --wait
//      pnpm turbo run build --filter=@touchgrass/api; cd apps/api; node --env-file=../../.env dist/…/migrate.cli.js up,
//      storage-init.cli.js and seed.cli.js (as scripts/dev.mjs does); start dist/main.js and dist/realtime.js
//   2. node --env-file=../../.env ../mobile/scripts/landing-shots/fixture.mjs   (from apps/api), then flush Redis
//      and restart the API so cached reference data is re-read
//   3. npm install --prefix <tmp> react-native-web@0.21.4 (delete its react, react-dom and scheduler copies), then
//      from apps/mobile:
//      CI=1 EXPO_NO_WEB_SETUP=1 EXPO_NO_DEPENDENCY_VALIDATION=1 CAPTURE_RNW_ROOT=<tmp> CAPTURE_APP_ROOT=$PWD \
//        EXPO_OVERRIDE_METRO_CONFIG=$PWD/scripts/landing-shots/metro.capture.cjs \
//        EXPO_PUBLIC_API_URL=http://localhost:4000 EXPO_PUBLIC_REALTIME_URL=http://localhost:4001 \
//        npx expo start --web --port 8081 --no-dev --minify
//   4. node --env-file=.env apps/mobile/scripts/landing-shots/capture.mjs <dir>   (from the repo root)
//   5. node apps/mobile/scripts/landing-shots/encode.mjs <dir>
const path = require('node:path');

const appRoot = process.env.CAPTURE_APP_ROOT;
const rnwRoot = process.env.CAPTURE_RNW_ROOT;
if (!appRoot || !rnwRoot) throw new Error('Set CAPTURE_APP_ROOT and CAPTURE_RNW_ROOT');
const { getDefaultConfig } = require(require.resolve('expo/metro-config', { paths: [appRoot] }));

const stubs = path.join(__dirname, 'stubs');
const STUBS = {
  'react-native-maps': 'maps.js',
  'expo-secure-store': 'secure-store.js',
  'expo-notifications': 'notifications.js',
  '@react-native-firebase/auth': 'empty.js',
  '@react-native-firebase/app': 'empty.js',
  'react-native-view-shot': 'empty.js',
};

const config = getDefaultConfig(appRoot);
config.watchFolders = [...(config.watchFolders ?? []), rnwRoot, stubs];
config.resolver.nodeModulesPaths = [
  ...(config.resolver.nodeModulesPaths ?? []),
  path.join(rnwRoot, 'node_modules'),
];
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && STUBS[moduleName]) {
    return { type: 'sourceFile', filePath: path.join(stubs, STUBS[moduleName]) };
  }
  return upstream
    ? upstream(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
