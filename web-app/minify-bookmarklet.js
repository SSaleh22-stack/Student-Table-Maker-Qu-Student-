/**
 * Simple bookmarklet minifier
 * Run: node minify-bookmarklet.js
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const bookmarkletCode = fs.readFileSync(join(__dirname, 'bookmarklet.js'), 'utf8');

// Remove comments and extra whitespace (simple minification)
// Be careful to preserve function references
let minified = bookmarkletCode
  // Remove multi-line comments first (they might span lines)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  // Remove single-line comments (but be careful with URLs)
  .replace(/\/\/[^\n]*/g, '')
  // Remove leading/trailing whitespace from lines
  .replace(/^\s+|\s+$/gm, '')
  // Remove empty lines
  .replace(/\n\s*\n+/g, '\n')
  // Remove whitespace around certain operators (but preserve function calls)
  .replace(/\s*([{}();,=+\-*/<>!?:])\s*/g, '$1')
  // Collapse multiple spaces to single space (but preserve newlines for readability)
  .replace(/[ \t]+/g, ' ')
  // Remove newlines (now that we've cleaned up)
  .replace(/\n/g, ' ')
  // Remove multiple spaces
  .replace(/\s+/g, ' ')
  .trim();

// Wrap in javascript: protocol
const final = `javascript:${minified}`;

fs.writeFileSync(join(__dirname, 'bookmarklet-minified.js'), final);
console.log('✅ Bookmarklet minified!');
console.log(`Original: ${bookmarkletCode.length} chars`);
console.log(`Minified: ${minified.length} chars`);

