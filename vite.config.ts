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
        // Inline imports in content scripts and ensure they have a newline at the end
        const contentScripts = [
          join('dist', 'src', 'content', 'contentScript.js'),
          join('dist', 'src', 'content', 'gpaCalculator.js'),
          join('dist', 'src', 'content', 'reviewAutofill.js'),
        ];
        contentScripts.forEach((contentScriptPath) => {
          if (existsSync(contentScriptPath)) {
            let contentScript = readFileSync(contentScriptPath, 'utf-8');
            
            // Only process gpaCalculator.js
            if (contentScriptPath.includes('gpaCalculator')) {
              // Inline imports from assets/gpa.js
              const gpaImportMatch = contentScript.match(/import\s*\{([^}]*)\}\s*from\s*["']\.\.\/\.\.\/assets\/gpa\.js["'];?/);
              if (gpaImportMatch) {
                const gpaJsPath = join('dist', 'assets', 'gpa.js');
                if (existsSync(gpaJsPath)) {
                  let gpaJsContent = readFileSync(gpaJsPath, 'utf-8');
                  // Extract import mappings: {g as G, c as S, a as H, b as k, d as L}
                  const importSpec = gpaImportMatch[1].trim();
                  const mappings: Record<string, string> = {};
                  // Parse: "g as G, c as S, ..." or "g, c, ..."
                  importSpec.split(',').forEach(part => {
                    const trimmed = part.trim();
                    if (trimmed.includes(' as ')) {
                      const [original, alias] = trimmed.split(' as ').map(s => s.trim());
                      mappings[original] = alias;
                    } else {
                      mappings[trimmed] = trimmed;
                    }
                  });
                  
                  // Replace export statement with variable assignments
                  // The export is: export{e as a,d as b,i as c,P as d,D as e,f as g,y as v};
                  // Map: g -> f (getDefaultGradePoints), c -> i (calcTotalHours), a -> e (calcQualityPoints), b -> d (calcSemesterGpa), d -> P (calcNewCumulativeGpa)
                  const exportMap: Record<string, string> = {
                    'g': 'f', // getDefaultGradePoints
                    'c': 'i', // calcTotalHours  
                    'a': 'e', // calcQualityPoints
                    'b': 'd', // calcSemesterGpa
                    'd': 'P', // calcNewCumulativeGpa
                  };
                  
                  // Remove export and create variable assignments
                  gpaJsContent = gpaJsContent.replace(/export\s*\{[^}]*\};?/g, '');
                  
                  // Rename function P to avoid conflict with loadLanguage function P
                  // P is calcNewCumulativeGpa, we'll rename it to _calcNewCumulativeGpa inside IIFE
                  gpaJsContent = gpaJsContent.replace(/\bP\s*\(/g, '_calcNewCumulativeGpa(');
                  gpaJsContent = gpaJsContent.replace(/\bP\b/g, '_calcNewCumulativeGpa');
                  
                  // Also rename function D (validation function) to avoid conflict with variable D
                  // D is used as a variable name for calcNewCumulativeGpa, so rename the function D to _validateD
                  gpaJsContent = gpaJsContent.replace(/\bfunction\s+D\s*\(/g, 'function _validateD(');
                  gpaJsContent = gpaJsContent.replace(/\bD\s*\(/g, '_validateD(');
                  
                  // But we need to keep the original P reference for the mapping
                  const innerPName = '_calcNewCumulativeGpa';
                  
                  // Remove the import statement
                  contentScript = contentScript.replace(gpaImportMatch[0], '');
                  
                  // Create variable assignments outside IIFE to expose them
                  const varAssignments = Object.entries(mappings)
                    .map(([alias, varName]) => {
                      return `var ${varName};`;
                    })
                    .join('\n');
                  
                  // Wrap gpa.js content in IIFE to avoid variable conflicts, then assign to outer vars
                  const innerAssignments = Object.entries(mappings)
                    .map(([alias, varName]) => {
                      let funcName = exportMap[alias] || alias;
                      // Use renamed P function
                      if (funcName === 'P') {
                        funcName = innerPName;
                      }
                      return `${varName} = ${funcName};`;
                    })
                    .join('\n');
                  
                  contentScript = `${varAssignments}\n(function(){\n${gpaJsContent}\n${innerAssignments}\n})();\n${contentScript}`;
                }
              }
              
              // Wrap entire script in IIFE to prevent variable conflicts on multiple loads
              if (!contentScript.trim().startsWith('(function()')) {
                contentScript = `(function(){\n${contentScript}\n})();`;
              }
            }
            
            // Also wrap reviewAutofill.js in IIFE
            if (contentScriptPath.includes('reviewAutofill')) {
              // Wrap entire script in IIFE to prevent variable conflicts on multiple loads
              if (!contentScript.trim().startsWith('(function()')) {
                contentScript = `(function(){\n${contentScript}\n})();`;
              }
            }
            
            if (!contentScript.endsWith('\n')) {
              contentScript += '\n';
            }
            writeFileSync(contentScriptPath, contentScript);
          }
        });
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
        gpaCalculator: resolve(__dirname, 'src/content/gpaCalculator.ts'),
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
          if (chunkInfo.name === 'gpaCalculator') {
            return 'src/content/gpaCalculator.js';
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
        // Ensure content scripts are built as single files with all dependencies inlined
        inlineDynamicImports: false,
        manualChunks: (id) => {
          // Don't create separate chunks for content script dependencies
          // All content script imports should be inlined
          if (id.includes('src/content/') || id.includes('src/lib/')) {
            return undefined; // Inline into the entry file
          }
          // For dashboard and other files, allow chunking
          if (id.includes('node_modules') && !id.includes('src/content/')) {
            return 'vendor';
          }
        },
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

