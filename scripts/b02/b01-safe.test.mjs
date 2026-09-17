// Re-run B01's unchanged tests without reading real environment files/AppData.
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRoot, cleanup } from './safety.mjs';
import { installNetworkBoundary } from './network.mjs';

installNetworkBoundary();
const root = createRoot();
const appData = path.join(root, 'app-data');
fs.mkdirSync(appData);
process.env.APPDATA = appData;
const exists = fs.existsSync;
fs.existsSync = file => path.basename(String(file)).toLowerCase() === '.env' ? false : exists(file);
await import('../b01/targets.test.mjs');
test.after(() => { fs.existsSync = exists; cleanup(root); });
