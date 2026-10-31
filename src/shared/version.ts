// Replaced at build time (vite and esbuild "define") with the release tag, for example "v0.1.6".
// Without a define (local development, tests) it is "dev".
declare const __APP_VERSION__: string | undefined;
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
