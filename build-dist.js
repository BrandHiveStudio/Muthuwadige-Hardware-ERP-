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

  // Clean any bundled database files from unpacked output resources (preserve .env)
  const winUnpackedResources = path.join(tempOutputDir, 'win-unpacked', 'resources', 'app');
  if (fs.existsSync(winUnpackedResources)) {
    const dbFilesToClean = ['hardware.db', 'hardware.db-wal', 'hardware.db-shm'];
    for (const f of dbFilesToClean) {
      const targetPath = path.join(winUnpackedResources, f);
      if (fs.existsSync(targetPath)) {
        console.log(`🧹 Removing bundled database file from package resources: ${f}`);
        fs.rmSync(targetPath, { force: true });
      }
    }

    // Ensure default .env is bundled with package resources
    const targetEnv = path.join(winUnpackedResources, '.env');
    if (!fs.existsSync(targetEnv)) {
      const sourceEnv = path.join(process.cwd(), '.env');
      if (fs.existsSync(sourceEnv)) {
        console.log('📦 Bundling .env into package resources...');
        fs.copyFileSync(sourceEnv, targetEnv);
      } else {
        console.log('📦 Seeding default .env into package resources...');
        const defaultEnv = [
          '# Turso Cloud libSQL Database Credentials',
          'TURSO_DATABASE_URL=libsql://mwhardware-db-sanoj-hardware.aws-ap-south-1.turso.io',
          'TURSO_AUTH_TOKEN=eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODkyNTY3MzAsImlkIjoiMDFhMDY3Y2YtZWQwMS03MDYzLWE3MjQtNmIyZTE1ZjJmZWU5Iiwia2lkIjoiSUNBcmxEQWtuSmRPOVBfalA3WG03dDlvdE91NGI1SjFTbWpmY281b1dJayIsInJpZCI6IjQzNzRjMmFjLThiZjQtNDczNi05NzllLTdlYTUyNTk1MWVjNiJ9.Rhr2wtm6EDBOJC959E4ZL_Ta7vp1brzJ6FsEcriblyAKYvbd3b3a2HBryb12qHxfKUEQ7o-QfOvabsukXFwICw',
          'JWT_SECRET=muthuwadige_static_production_secret_key_2026',
          ''
        ].join('\n');
        fs.writeFileSync(targetEnv, defaultEnv, 'utf-8');
      }
    }
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
      if (file === 'win-unpacked') {
        console.warn(`⚠️ Warning: Could not overwrite ${file} (likely in use). Installer .exe was generated successfully.`);
      } else {
        throw copyErr;
      }
    }
  }

  console.log('✅ Packaging complete! Build artifacts are in release-dist/');
} catch (error) {
  console.error('❌ Build failed:', error);
  process.exit(1);
}
