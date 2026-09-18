// Launch a test-only script under the B04 import, environment, and network boundary.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(directory, '..', '..');

const target = process.argv[2] || path.join('scripts', 'test-isolation', 'b04_isolated.test.mjs');
const resolvedTarget = path.resolve(projectRoot, target);
const allowedTargetRoot = path.resolve(directory);
const allowedSpecificTargets = new Set([
  path.resolve(projectRoot, 'scripts', 'multi_terminal_sync.test.mjs')
]);

const isInsideAllowedDir = resolvedTarget.startsWith(allowedTargetRoot + path.sep) || resolvedTarget === allowedTargetRoot;
const isExplicitlyAllowedTarget = allowedSpecificTargets.has(resolvedTarget);

if (!isInsideAllowedDir && !isExplicitlyAllowedTarget) {
  throw new Error('B04 test isolation: target must be inside scripts/test-isolation or explicitly allowlisted scripts/multi_terminal_sync.test.mjs');
}
if (path.extname(resolvedTarget) !== '.mjs') {
  throw new Error('B04 test isolation: target must be an .mjs file');
}

// Explicit minimal environment allowlist — strictly runtime/OS execution primitives only
const inheritedAllowlist = [
  'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'OS',
  'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'NUMBER_OF_PROCESSORS',
  'TEMP', 'TMP', 'PATH', 'Path'
];

const env = Object.fromEntries(
  inheritedAllowlist
    .filter((key) => typeof process.env[key] === 'string' && process.env[key] !== '')
    .map((key) => [key, process.env[key]])
);

// Explicit isolation overrides (zero credentials, test role, no options)
Object.assign(env, {
  NODE_ENV: 'test',
  APP_ROLE: 'test',
  DATABASE_ENGINE: 'sqlite',
  NODE_OPTIONS: ''
});

const loaderUrl = pathToFileURL(path.join(directory, 'b04-esm-loader.mjs')).href;
const networkDenyUrl = pathToFileURL(path.join(directory, 'network-deny.mjs')).href;

const child = spawn(process.execPath, [
  '--experimental-loader', loaderUrl,
  '--import', networkDenyUrl,
  resolvedTarget
], {
  cwd: projectRoot,
  env,
  shell: false,
  stdio: 'inherit'
});

child.once('exit', (code, signal) => {
  if (signal) process.exitCode = 1;
  else process.exitCode = code ?? 1;
});
