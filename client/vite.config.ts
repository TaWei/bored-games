import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // 1. Listen on all addresses so the SSH tunnel can find the server
    host: '0.0.0.0', 
    port: 5173,
    // 2. Prevent Vite from switching to 5174 if 5173 is "busy"
    strictPort: true, 
    hmr: {
      // 3. Force the browser to look for HMR on your LOCAL machine
      protocol: 'ws',
      host: 'localhost',
      port: 5173,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});