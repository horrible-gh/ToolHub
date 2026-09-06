import { defineConfig } from 'vite';
export default defineConfig({ root: 'client', publicDir: 'public', build: { outDir: '../build/client', emptyOutDir: true, manifest: true, rollupOptions: { input: 'client/src/main.js', output: { entryFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' } } } });
