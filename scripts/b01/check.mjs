import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { projectRoot, loadTargets } from './targets.mjs';
import { sha256, fingerprint } from './schema.mjs';

const runtime = ['server.js', 'electron-main.js', 'preload.js', 'src/db/connection.js', 'src/services/syncService.js', 'api/index.js', 'api/health.js', 'lib/turso.js', 'backup-worker.js', 'build-dist.js'];
const sources = ['package.json', 'package-lock.json', ...runtime, 'src/db/connection.ts', 'src/services/syncService.ts', 'index.html', 'src/index.tsx', 'src/App.tsx', 'src/types/index.ts', 'vite.config.ts', 'vercel.json'];
const run = args => {
  const result = spawnSync(process.execPath, args, { cwd: projectRoot, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) throw new Error('Static check failed');
};
try {
  const [command, config] = process.argv.slice(2);
  switch (command) {
    case 'types': run(['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false', '--pretty', 'false']); break;
    case 'syntax': {
      const scripts = fs.readdirSync(path.join(projectRoot, 'scripts')).filter(p => p.startsWith('verify_') && p.endsWith('.js')).map(p => 'scripts/' + p);
      const own = fs.readdirSync(path.join(projectRoot, 'scripts/b01')).filter(p => /\.(mjs|cjs)$/.test(p)).map(p => 'scripts/b01/' + p);
      for (const file of [...runtime, ...scripts, ...own]) run(['--check', file]);
      console.log('PASS: runtime and verification JavaScript syntax'); break;
    }
    case 'targets': loadTargets(config, { cloud: process.argv.includes('--cloud') }); console.log('ACCEPTED: configuration only; no database or network connection'); break;
    case 'schema': console.log(JSON.stringify(fingerprint(loadTargets(config).local), null, 2)); break;
    case 'project-schema':
      if (config !== '--read-only-metadata') throw new Error('Explicit read-only metadata flag required');
      console.log(JSON.stringify(fingerprint(path.join(projectRoot, 'hardware.db')), null, 2)); break;
    case 'baseline': {
      const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' });
      if (revision.status !== 0) throw new Error('Git baseline unavailable');
      const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
      const dependencies = {};
      for (const name of ['typescript', 'vite', 'react', 'express', 'sqlite', 'sqlite3', '@libsql/client', 'electron', 'electron-builder', 'eslint']) {
        const installed = JSON.parse(fs.readFileSync(path.join(projectRoot, 'node_modules', name, 'package.json'), 'utf8')).version;
        dependencies[name] = { installed, locked: lock.packages['node_modules/' + name].version, match: installed === lock.packages['node_modules/' + name].version };
      }
      const hashes = Object.fromEntries(sources.map(p => [p, sha256(fs.readFileSync(path.join(projectRoot, p)))]));
      const archive = path.join(projectRoot, 'release-dist/win-unpacked/resources/app.asar');
      let packaged = { available: false };
      if (fs.existsSync(archive)) {
        const asar = createRequire(import.meta.url)('@electron/asar');
        const hash = sha256(asar.extractFile(archive, 'server.js'));
        packaged = { available: true, serverSha256: hash, matchesSource: hash === hashes['server.js'] };
      }
      console.log(JSON.stringify({ revision: revision.stdout.trim(), hashes, dependencies, packaged }, null, 2)); break;
    }
    default: throw new Error('Use: types | syntax | targets CONFIG [--cloud] | schema CONFIG | project-schema --read-only-metadata | baseline');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
