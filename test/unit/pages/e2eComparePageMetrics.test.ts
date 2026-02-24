import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pagePath = resolve(__dirname, '../../pages/e2e-compare.html');
const html = readFileSync(pagePath, 'utf-8');

describe('e2e compare metric labels', () => {
  it('shows pass/fail threshold guide', () => {
    expect(html).toContain('Pass/Fail');
    expect(html).toContain('SSIM');
    expect(html).toContain('needs review');
  });

  it('summary bar has pass/fail indicator labels', () => {
    expect(html).toContain('P/F');
    expect(html).toContain('sum-ssim');
    expect(html).toContain('sum-color-hist');
    expect(html).toContain('sum-text-cov');
  });

  it('summary bar has diagnostic metrics', () => {
    expect(html).toContain('sum-fg-iou');
    expect(html).toContain('sum-fg-iou-raw');
    expect(html).toContain('sum-mae');
  });

  it('table header shows PASS / FAIL and DIAGNOSTIC groups', () => {
    expect(html).toContain('PASS / FAIL');
    expect(html).toContain('DIAGNOSTIC');
  });
});
