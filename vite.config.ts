import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, join } from 'path';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'fs';

// Custom plugin to copy manifest.json, public assets, and move dashboard.html to root with corrected paths
const copyManifest = () => {
  return {
    name: 'copy-manifest',
    closeBundle() {
      copyFileSync('manifest.json', 'dist/manifest.json');
      // Copy public folder assets if they exist
      const publicFiles = ['title-bg.jpg'];
      publicFiles.forEach((file) => {
        const source = join('public', file);
        const dest = join('dist', file);
        if (existsSync(source)) {
          copyFileSync(source, dest);
        }
      });
        // Move dashboard.html from dist/src/pages/ to dist/ and fix paths
        const htmlSource = join('dist', 'src', 'pages', 'dashboard.html');
        const htmlDest = join('dist', 'dashboard.html');
        if (existsSync(htmlSource)) {
          let htmlContent = readFileSync(htmlSource, 'utf-8');
          // Fix absolute paths: /assets/ -> ./assets/
          htmlContent = htmlContent.replace(/"\/assets\//g, '"./assets/');
          htmlContent = htmlContent.replace(/'\/assets\//g, "'./assets/");
          // Also fix any relative paths: ../../assets/ -> ./assets/
          htmlContent = htmlContent.replace(/\.\.\/\.\.\/assets\//g, './assets/');
          writeFileSync(htmlDest, htmlContent);
        }
        // Ensure content script has a newline at the end (some Chrome versions require this)
        const contentScriptPath = join('dist', 'src', 'content', 'contentScript.js');
        if (existsSync(contentScriptPath)) {
          let contentScript = readFileSync(contentScriptPath, 'utf-8');
          if (!contentScript.endsWith('\n')) {
            contentScript += '\n';
            writeFileSync(contentScriptPath, contentScript);
          }
        }
      }
  };
};

export default defineConfig({
  base: './',
  plugins: [react(), copyManifest()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        dashboard: resolve(__dirname, 'src/pages/dashboard.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        contentScript: resolve(__dirname, 'src/content/contentScript.ts'),
        reviewAutofill: resolve(__dirname, 'src/content/reviewAutofill.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') {
            return 'src/background/index.js';
          }
          if (chunkInfo.name === 'contentScript') {
            return 'src/content/contentScript.js';
          }
          if (chunkInfo.name === 'reviewAutofill') {
            return 'src/content/reviewAutofill.js';
          }
          return 'assets/[name].js';
        },
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (assetInfo) => {
          // Keep HTML files at root level
          if (assetInfo.name && assetInfo.name.endsWith('.html')) {
            return '[name][extname]';
          }
          return 'assets/[name].[ext]';
        },
        // Ensure content script is built as a single file with all dependencies
        inlineDynamicImports: false,
      }
    },
    emptyOutDir: true,
    // Ensure content script dependencies are bundled
    commonjsOptions: {
      include: [/node_modules/],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});

