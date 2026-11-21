import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  // 相对路径：既能挂在域名根，也能挂在 /<仓库>/ 这类子路径（GitHub Pages）
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
  },
});