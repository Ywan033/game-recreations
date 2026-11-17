import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds one self-contained dist/play.html (all JS and CSS inlined) that runs from file://.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 5000,
    cssCodeSplit: false,
    rollupOptions: { input: 'play.html' },
  },
});
