/**
 * Create proper icon files using Node.js
 * Requires: npm install sharp
 * Run: node create-icons-node.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createIcons() {
  try {
    // Try to use sharp if available
    const sharp = await import('sharp').catch(() => null);
    
    if (sharp) {
      // Create icons using sharp
      const sizes = [192, 512];
      const publicDir = path.join(__dirname, 'public');
      
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }
      
      for (const size of sizes) {
        const svg = `
          <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
              </linearGradient>
            </defs>
            <rect width="${size}" height="${size}" fill="url(#grad)"/>
            <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="${size / 3}" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">QU</text>
          </svg>
        `;
        
        await sharp.default(Buffer.from(svg))
          .png()
          .toFile(path.join(publicDir, `icon-${size}.png`));
        
        console.log(`✅ Created icon-${size}.png`);
      }
      
      console.log('\n✅ All icons created successfully!');
    } else {
      console.log('⚠️  Sharp library not found.');
      console.log('📦 Install it: npm install sharp');
      console.log('🌐 Or use: public/create-icons-simple.html in your browser');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error creating icons:', error.message);
    console.log('\n💡 Alternative: Use public/create-icons-simple.html in your browser');
    process.exit(1);
  }
}

createIcons();

