import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { projectRoot } from '../b01/targets.mjs';
import { validate, cleanEnvironment } from './safety.mjs';

export async function probeElectron(config) {
  const c = validate(config); // Parent preflight BEFORE native process startup.
  if (process.platform !== 'win32') throw new Error('Only the inspected Windows Electron binary is supported');
  const executable = path.join(projectRoot, 'node_modules/electron/dist/electron.exe');
  if (!fs.existsSync(executable)) throw new Error('Installed Electron unavailable');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [
      '--user-data-dir=' + c.userData,
      '--disable-background-networking', '--disable-component-update', '--disable-sync',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      path.join(projectRoot, 'scripts/b02/electron-probe.cjs')
    ], { cwd: c.root, env: cleanEnvironment(c), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => { output += data.toString(); });
    const eventLog = () => {
      const events = [];
      for (const line of output.split(/\r?\n/)) {
        if (!line.startsWith('B02_EVENT ')) continue;
        try {
          const raw = JSON.parse(line.slice(10));
          const entry = {};
          for (const key of ['source', 'sequence', 'timestamp', 'event', 'allowed', 'target', 'permission', 'granted', 'errorCode', 'errorDescription', 'validatedURL', 'isMainFrame', 'reason', 'exitCode', 'stage']) {
            const value = raw[key];
            if (typeof value === 'boolean' || value === null || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value))) entry[key] = value;
          }
          events.push(entry);
        } catch { /* Ignore malformed diagnostic lines, never forward raw child output. */ }
      }
      return events;
    };
    const failureWithEvents = message => {
      const events = eventLog();
      const error = new Error(message + '; events=' + JSON.stringify(events));
      error.diagnostics = events;
      return error;
    };
    const diagnostics = new Set();
    child.stderr.on('data', data => {
      // Fixed categories only; never forward arbitrary native text or paths.
      const text = data.toString();
      if (/access is denied|permission denied/i.test(text)) diagnostics.add('native-access-denied');
      if (/sandbox/i.test(text)) diagnostics.add('native-sandbox-error');
      if (/GPU process.*failed|GPU process.*crash/i.test(text)) diagnostics.add('native-gpu-error');
      if (/renderer.*failed|render.*crash/i.test(text)) diagnostics.add('native-renderer-error');
    });
    const timeout = setTimeout(() => { child.kill(); reject(failureWithEvents('Electron probe timeout')); }, 20000);
    child.once('error', () => { clearTimeout(timeout); reject(failureWithEvents('Electron probe could not launch')); });
    child.once('exit', () => clearTimeout(timeout));
    // Parse after stdio closes so final failure events are not lost at process exit.
    child.once('close', code => {
      clearTimeout(timeout);
      const line = output.split(/\r?\n/).find(s => s.startsWith('B02_RESULT '));
      const failure = output.split(/\r?\n/).find(s => /^B02_FAILURE (imports|configuration|ready|load|response) (ERR_[A-Z_]+|UNKNOWN)$/.test(s));
      if (code !== 0 || !line) {
        const observations = output.split(/\r?\n/).find(s => s.startsWith('B02_OBSERVATIONS '));
        const seen = observations ? JSON.parse(observations.slice(17)) : [];
        return reject(failureWithEvents('Electron probe failed closed: ' + (failure || 'native startup') + '; allowed=' + seen.filter(e => e.allowed).length + '; denied=' + seen.filter(e => !e.allowed).length + '; ' + [...diagnostics].join(',')));
      }
      try { resolve(JSON.parse(line.slice(11))); } catch { reject(new Error('Invalid probe observation')); }
    });
  });
}
