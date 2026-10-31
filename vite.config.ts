import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web app lives in src/web and is built to dist/web, which the Node server serves.
export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || 'dev') },
  build: { outDir: '../../dist/web', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
