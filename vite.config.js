import { defineConfig } from 'vite';
export default defineConfig({
  // GitHub Pages supplies its repository or custom-domain path during the build.
  base: process.env.VITE_BASE_PATH || '/',
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true },
  build: {
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
    // Three's renderer is a fixed, locally bundled dependency; the payload is intentional.
    chunkSizeWarningLimit: 650,
  },
});
