import { spawn } from 'node:child_process';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

function runNode(script, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      reject(new Error(`Build subprocess failed (${signal ?? `exit ${code}`})`));
    });
  });
}

await rm(dist, { recursive: true, force: true });
await build({ configFile: resolve(root, 'vite.config.ts') });
await build({ configFile: resolve(root, 'vite.config.browser.ts') });

const typescriptRoot = dirname(require.resolve('typescript/package.json'));
await runNode(resolve(typescriptRoot, 'bin/tsc'), [
  '--emitDeclarationOnly',
  '--declarationMap',
  'false',
  '--outDir',
  'dist/types',
]);

await mkdir(resolve(dist, 'types'), { recursive: true });
await copyFile(resolve(dist, 'types/index.d.ts'), resolve(dist, 'types/index.d.cts'));
