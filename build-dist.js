import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tempOutputDir = path.join(os.tmpdir(), 'hardwarer-build-release-temp');
const localOutputDir = './release-dist';

try {
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

  // Clean any bundled database/env files from unpacked output resources
  const winUnpackedResources = path.join(tempOutputDir, 'win-unpacked', 'resources', 'app');
  if (fs.existsSync(winUnpackedResources)) {
    const dbFilesToClean = ['hardware.db', 'hardware.db-wal', 'hardware.db-shm', '.env'];
    for (const f of dbFilesToClean) {
      const targetPath = path.join(winUnpackedResources, f);
      if (fs.existsSync(targetPath)) {
        console.log(`🧹 Removing bundled file from package resources: ${f}`);
        fs.rmSync(targetPath, { force: true });
      }
    }
  }

  // Copy installer files and win-unpacked folder
  const files = fs.readdirSync(tempOutputDir);
  for (const file of files) {
    const src = path.join(tempOutputDir, file);
    const dest = path.join(localOutputDir, file);

    console.log(`Copying ${file}...`);
    fs.cpSync(src, dest, { recursive: true, force: true });
  }

  console.log('✅ Packaging complete! Build artifacts are in release-dist/');
} catch (error) {
  console.error('❌ Build failed:', error);
  process.exit(1);
}
