import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  // Base path for GitHub Pages (repository name)
  // For local development, use './' (relative paths)
  // For production build, use the repository name as base path
  base: (process.env.NODE_ENV === 'production' || process.env.CI) 
    ? '/Student-Table-Maker-Qu-Student-/' 
    : './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Ensure .nojekyll is copied from public folder
    copyPublicDir: true,
  },
  publicDir: 'public',
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0', // Allow access from network (for iPad on same network)
    port: 3000,
  },
});

