/**
 * Create a working bookmarklet from bookmarklet.js
 * Uses a simpler minification approach
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const bookmarkletCode = fs.readFileSync(join(__dirname, 'bookmarklet.js'), 'utf8');

// Simple minification - just remove comments and extra whitespace
// Don't touch operators or syntax
// First, protect string literals to prevent breaking URLs
const stringRegex = /(['"`])(?:(?=(\\?))\2.)*?\1/g;
const strings = [];
let protectedCode = bookmarkletCode.replace(stringRegex, (match) => {
  const placeholder = `__STRING_${strings.length}__`;
  strings.push(match);
  return placeholder;
});

let minified = protectedCode
  // Remove multi-line comments
  .replace(/\/\*[\s\S]*?\*\//g, '')
  // Remove single-line comments
  .replace(/\/\/[^\n]*/g, '')
  // Remove leading/trailing whitespace from lines
  .replace(/^\s+|\s+$/gm, '')
  // Remove empty lines
  .replace(/\n\s*\n+/g, '\n')
  // Collapse multiple spaces/tabs to single space (but keep newlines)
  .replace(/[ \t]+/g, ' ')
  // Remove newlines (now safe)
  .replace(/\n/g, ' ')
  // Final cleanup - remove multiple spaces (but preserve single spaces)
  .replace(/[ \t]{2,}/g, ' ')
  .trim();

// Restore string literals
strings.forEach((str, idx) => {
  minified = minified.replace(`__STRING_${idx}__`, str);
});

// Wrap in javascript: protocol
const final = `javascript:${minified}`;

fs.writeFileSync(join(__dirname, 'bookmarklet-ready.js'), final);
console.log('✅ Bookmarklet created!');
console.log(`Original: ${bookmarkletCode.length} chars`);
console.log(`Minified: ${minified.length} chars`);
console.log(`Final: ${final.length} chars`);
