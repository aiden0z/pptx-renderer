import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const browserEntry = new URL(
  `..${packageJson.exports['./browser'].import.slice(1)}`,
  import.meta.url,
);
const browserSource = await readFile(browserEntry, 'utf8');

assert.equal(browserSource.includes('process.env'), false, 'browser entry contains process.env');
for (const dependency of ['echarts', 'jszip']) {
  assert.equal(
    browserSource.includes(`from "${dependency}"`) ||
      browserSource.includes(`from '${dependency}'`) ||
      browserSource.includes(`require("${dependency}")`) ||
      browserSource.includes(`require('${dependency}')`),
    false,
    `browser entry contains a bare ${dependency} import`,
  );
}

const esm = await import(packageJson.name);
const browser = await import(`${packageJson.name}/browser`);
const cjs = require(packageJson.name);

for (const [name, entry] of Object.entries({ esm, browser, cjs })) {
  assert.equal(typeof entry.PptxViewer, 'function', `${name} entry does not export PptxViewer`);
  assert.equal(typeof entry.parseZip, 'function', `${name} entry does not export parseZip`);
}

console.log('Verified ESM, CJS, and standalone browser package entry points.');
