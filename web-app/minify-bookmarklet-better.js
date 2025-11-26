/**
 * Better bookmarklet minifier
 * Preserves function structure and syntax
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const bookmarkletCode = fs.readFileSync(join(__dirname, 'bookmarklet.js'), 'utf8');

// Remove comments but preserve code structure
let minified = bookmarkletCode
  // Remove multi-line comments
  .replace(/\/\*[\s\S]*?\*\//g, '')
  // Remove single-line comments (but be careful with URLs)
  .replace(/\/\/[^\n]*/g, '')
  // Remove leading/trailing whitespace from lines
  .replace(/^\s+|\s+$/gm, '')
  // Remove empty lines
  .replace(/\n\s*\n+/g, '\n')
  // Collapse multiple spaces to single space (but preserve newlines for now)
  .replace(/[ \t]+/g, ' ')
  // Now remove newlines and collapse
  .replace(/\n/g, ' ')
  // Remove multiple spaces
  .replace(/\s+/g, ' ')
  // Fix common issues: ensure proper spacing around operators
  .replace(/([{}();,=+\-*/<>!?:])\s*([{}();,=+\-*/<>!?:])/g, '$1 $2')
  // Fix function declarations
  .replace(/\s*function\s*/g, ' function ')
  .replace(/\s*=\s*function\s*/g, '=function ')
  // Fix arrow functions
  .replace(/\s*=>\s*/g, '=>')
  // Fix template literals
  .replace(/\s*`\s*/g, '`')
  .replace(/\s*`\s*/g, '`')
  // Final cleanup
  .replace(/\s+/g, ' ')
  .trim();

// Wrap in javascript: protocol
const final = `javascript:${minified}`;

fs.writeFileSync(join(__dirname, 'bookmarklet-ready.js'), final);
console.log('✅ Bookmarklet minified!');
console.log(`Original: ${bookmarkletCode.length} chars`);
console.log(`Minified: ${minified.length} chars`);

