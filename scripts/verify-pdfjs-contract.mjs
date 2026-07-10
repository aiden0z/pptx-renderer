import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function createBlankPdf() {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources <<>> /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += object;
  }
  const xrefOffset = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const moduleUrl = import.meta.resolve('pdfjs-dist/build/pdf.min.mjs');
const workerUrl = import.meta.resolve('pdfjs-dist/build/pdf.worker.min.mjs');
const legacyModuleUrl = import.meta.resolve('pdfjs-dist/legacy/build/pdf.min.mjs');
assert.equal(moduleUrl.startsWith('file:'), true, 'PDF.js module URL is not file-resolvable');
assert.equal(existsSync(fileURLToPath(moduleUrl)), true, 'PDF.js browser module is missing');
assert.equal(existsSync(fileURLToPath(workerUrl)), true, 'PDF.js worker module is missing');

const pdfjs = await import(legacyModuleUrl);
assert.equal(typeof pdfjs.getDocument, 'function', 'PDF.js does not export getDocument');
assert.ok(pdfjs.GlobalWorkerOptions, 'PDF.js does not export GlobalWorkerOptions');

const loadingTask = pdfjs.getDocument({ data: createBlankPdf() });
const document = await loadingTask.promise;
try {
  assert.equal(document.numPages, 1, 'PDF.js could not parse a one-page PDF');
} finally {
  if (typeof loadingTask.destroy === 'function') {
    await loadingTask.destroy();
  } else if (typeof document.destroy === 'function') {
    await document.destroy();
  }
}

console.log(`Verified PDF.js ${pdfjs.version} module, worker, and document contracts.`);
