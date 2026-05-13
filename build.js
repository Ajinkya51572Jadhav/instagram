import { copyFileSync, mkdirSync, existsSync, rmSync, renameSync } from 'fs';
import { execSync } from 'child_process';

console.log('🚀 Building InstagramPro Extension...\n');

// Step 1: Clean dist folder
console.log('📁 Cleaning dist folder...');
if (existsSync('dist')) {
  rmSync('dist', { recursive: true, force: true });
}
mkdirSync('dist', { recursive: true });

// Step 2: Run Vite build
console.log('⚡ Running Vite build...');
try {
  execSync('npx vite build', { stdio: 'inherit' });
} catch (error) {
  console.error('❌ Vite build failed');
  process.exit(1);
}

// Step 3: Move popup.html from dist/src/ to dist/
console.log('\n📄 Moving popup.html...');
if (existsSync('dist/src/popup.html')) {
  renameSync('dist/src/popup.html', 'dist/popup.html');
  // Remove empty src folder
  if (existsSync('dist/src')) {
    rmSync('dist/src', { recursive: true, force: true });
  }
}

// Step 4: Create necessary directories
console.log('📂 Creating directories...');
mkdirSync('dist/background', { recursive: true });
mkdirSync('dist/content-scripts', { recursive: true });

// Step 5: Copy manifest
console.log('📋 Copying manifest...');
copyFileSync('manifest.json', 'dist/manifest.json');

// Step 6: Copy background service worker
console.log('🔧 Copying background service worker...');
copyFileSync('background/service-worker.js', 'dist/background/service-worker.js');

// Step 7: Copy content script
console.log('📜 Copying content script...');
copyFileSync('content-scripts/instagram-improved.js', 'dist/content-scripts/instagram-improved.js');

console.log('\n✅ Build complete!');
console.log('\n📦 Extension files are in: dist/');
console.log('   - manifest.json');
console.log('   - popup.html');
console.log('   - popup.js');
console.log('   - popup.css');
console.log('   - background/service-worker.js');
console.log('   - content-scripts/instagram-improved.js');
console.log('\n🎯 Next steps:');
console.log('1. Open Chrome → chrome://extensions/');
console.log('2. Enable "Developer mode"');
console.log('3. Click "Load unpacked"');
console.log('4. Select the "dist" folder');
console.log('\n🎉 Done!\n');
