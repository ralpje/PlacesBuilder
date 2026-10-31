// Bundles the server to dist/server/index.mjs. Set APP_VERSION (the release workflow uses the git tag) to stamp the version.
import { build } from 'esbuild';

const version = process.env.APP_VERSION || 'dev';
await build({
  entryPoints: ['src/server/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/server/index.mjs',
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  define: { __APP_VERSION__: JSON.stringify(version) },
  logLevel: 'info',
});
