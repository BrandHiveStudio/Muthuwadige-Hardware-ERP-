// Test-only ESM loader for B04 isolation.
// Intercepts ONLY server.js's imports of ./backup-worker.js and node-cron.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const targetServerPath = path.resolve(projectRoot, 'server.js').toLowerCase();

const backupStubUrl = 'b04-test-isolation:backup-worker';
const cronStubUrl = 'b04-test-isolation:node-cron';

function isServerParent(parentURL) {
  if (!parentURL) return false;
  try {
    const parentPath = path.resolve(fileURLToPath(parentURL)).toLowerCase();
    return parentPath === targetServerPath;
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (isServerParent(context.parentURL)) {
    if (specifier === './backup-worker.js') {
      return { url: backupStubUrl, shortCircuit: true };
    }
    if (specifier === 'node-cron') {
      return { url: cronStubUrl, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === backupStubUrl) {
    return {
      format: 'module',
      shortCircuit: true,
      source: `
export async function executeBackupTask() {
  return { success: false, message: 'B04 test isolation: backup execution disabled' };
}
export default { executeBackupTask };
`
    };
  }

  if (url === cronStubUrl) {
    return {
      format: 'module',
      shortCircuit: true,
      source: `
const schedule = () => ({
  start() {},
  stop() {},
  destroy() {}
});
export { schedule };
export default { schedule };
`
    };
  }

  return nextLoad(url, context);
}
