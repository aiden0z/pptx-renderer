import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pagePath = resolve(__dirname, '../../pages/e2e-compare.html');
const html = readFileSync(pagePath, 'utf-8');

function between(startMarker: string, endMarker: string): string {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

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

  it('uses auto gate wording for automated results', () => {
    const summaryHtml = between(
      '<div class="summary-bar" id="summary-bar">',
      '<div class="log-section"',
    );
    expect(summaryHtml).toContain('Auto Gate');
    expect(summaryHtml).not.toContain('Visual Verdict');

    const summaryScript = between(
      'const verdictEl = document.getElementById',
      'updateMetricThresholdGuide',
    );
    expect(summaryScript).toContain("quality.passed ? 'PASS' : 'FAIL'");
    expect(summaryScript).not.toContain('SUPPORTED');
    expect(summaryScript).not.toContain('UNSUPPORTED');

    expect(html).toContain('<th rowspan="2">Auto Gate</th>');
    expect(html).toContain("gateLabel = 'FAIL'");
    expect(html).toContain("gateLabel = 'PASS'");
    expect(html).toContain('P:${gatePass}');
    expect(html).toContain('F:${gateFail}');
  });

  it('summary bar keeps diagnostic metrics collapsed by default', () => {
    const summaryHtml = between(
      '<div class="summary-bar" id="summary-bar">',
      '<div class="log-section"',
    );

    expect(summaryHtml).toContain('summary-diagnostics');
    expect(summaryHtml).toContain('<summary>Diagnostics</summary>');
    expect(summaryHtml.indexOf('sum-verdict')).toBeLessThan(
      summaryHtml.indexOf('summary-diagnostics'),
    );

    const diagnosticsHtml = summaryHtml.slice(summaryHtml.indexOf('summary-diagnostics'));
    expect(diagnosticsHtml).toContain('sum-text-cov');
    expect(diagnosticsHtml).toContain('sum-fg-iou');
    expect(diagnosticsHtml).toContain('sum-fg-iou-raw');
    expect(diagnosticsHtml).toContain('sum-mae');
    expect(diagnosticsHtml).toContain('sum-shape-count');
  });

  it('expands summary diagnostics horizontally instead of adding a vertical panel', () => {
    expect(html).toContain('.summary-diagnostics[open]');
    expect(html).toContain('.summary-diagnostics[open] .summary-diagnostics-grid');
    expect(html).toContain('margin-top: 0;');
    expect(html).toContain('background: transparent;');
  });

  it('slide headers show decision metrics while slide diagnostics stay expandable', () => {
    const scoreStart = html.indexOf('scores.innerHTML = `');
    const scoreEnd = html.indexOf('`;', scoreStart);
    expect(scoreStart).toBeGreaterThanOrEqual(0);
    expect(scoreEnd).toBeGreaterThan(scoreStart);

    const scoreTemplate = html.slice(scoreStart, scoreEnd);
    expect(scoreTemplate).toContain('ssim↑');
    expect(scoreTemplate).toContain('color↑');
    expect(scoreTemplate).toContain('gate');
    expect(scoreTemplate).not.toContain('fgIoU↑');
    expect(scoreTemplate).not.toContain('text↑');
    expect(scoreTemplate).not.toContain('shapes');

    expect(html).toContain("diagnostics.className = 'slide-diagnostics'");
    expect(html).toContain('<summary>Diagnostics</summary>');
  });

  it('table header shows PASS / FAIL and DIAGNOSTIC groups', () => {
    expect(html).toContain('PASS / FAIL');
    expect(html).toContain('DIAGNOSTIC');
  });

  it('persists the selected slide filter in the URL', () => {
    expect(html).toContain("parseRequestedSlideNumber(params.get('slide'))");
    expect(html).toContain('applyRequestedSlideFilter(slideCount)');
    expect(html).toContain("url.searchParams.set('slide', String(slideNumber))");
    expect(html).toContain("url.searchParams.delete('slide')");
  });

  it('uses side-by-side as the default view while keeping diff-first available', () => {
    expect(html).toContain(`<select id="view-mode">
          <option value="side-by-side">Side by Side</option>
          <option value="diff-first">Diff First</option>
          <option value="triple">Triple (+Diff)</option>`);
    expect(html).toContain("if (viewMode.value === 'side-by-side')");
    expect(html).toContain("url.searchParams.set('view', viewMode.value)");
  });
});
