import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tempOutputDir = path.join(os.tmpdir(), 'hardwarer-build-release-temp');
const localOutputDir = './release-dist';

try {
  // Enforce Release-Only Transaction Safety Gate before packaging
  console.log('🔒 Verifying transaction safety release gate...');
  execSync('node scripts/verify_no_legacy_transactions.js', {
    stdio: 'inherit'
  });

  if (fs.existsSync(tempOutputDir)) {
    console.log('🧹 Cleaning temporary output directory...');
    fs.rmSync(tempOutputDir, { recursive: true, force: true });
  }

  console.log('🚀 Packaging Electron application to temporary directory...');
  execSync(`npx electron-builder --config.directories.output=${tempOutputDir} --config.npmRebuild=false`, {
    stdio: 'inherit'
  });

  console.log('📂 Copying files back to release-dist...');
  if (!fs.existsSync(localOutputDir)) {
    fs.mkdirSync(localOutputDir, { recursive: true });
  }

  // Copy installer files and win-unpacked folder
  const files = fs.readdirSync(tempOutputDir);
  for (const file of files) {
    const src = path.join(tempOutputDir, file);
    const dest = path.join(localOutputDir, file);

    console.log(`Copying ${file}...`);
    try {
      fs.cpSync(src, dest, { recursive: true, force: true });
    } catch (copyErr) {
      console.error(`❌ Build failure: Could not copy ${file} to ${dest} (${copyErr.message}). Output artifact may be locked or in use.`);
      throw copyErr;
    }
  }

  console.log('✅ Packaging complete! Build artifacts are in release-dist/');
} catch (error) {
  console.error('❌ Build failed:', error);
  process.exit(1);
}
