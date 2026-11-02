import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  // Relative paths, so the same build works at qustudent.net and at the
  // github.io/Student-Table-Maker-Qu-Student-/ address (the site has a single page).
  base: './',
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

