import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pagePath = resolve(__dirname, '../../pages/e2e-compare.html');
const html = readFileSync(pagePath, 'utf-8');

describe('e2e compare page lifecycle cleanup', () => {
  it('destroys the previous hidden PptxViewer before a new evaluation replaces it', () => {
    expect(html).toContain('let activeCompareViewer = null');
    expect(html).toContain('activeCompareViewer.destroy()');
    expect(html).toContain('cleanupRenderedEvaluation()');
  });

  it('revokes PNG ground-truth object URLs when evaluations are replaced or unloaded', () => {
    expect(html).toContain('activePngObjectUrls');
    expect(html).toContain('URL.revokeObjectURL(url)');
    expect(html).toContain("window.addEventListener('beforeunload', cleanupRenderedEvaluation)");
  });

  it('destroys the pdfjs document after extracting pages and text', () => {
    expect(html).toContain('pdfDoc.destroy()');
  });

  it('resets expanded diff-first cards when the view mode changes', () => {
    expect(html).toContain(
      "viewMode.addEventListener('change', () => {\n        expandedDiffCards.clear();\n        writeViewModeToUrl();\n        applyViewAndFilter();",
    );
  });
});
