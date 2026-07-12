import { describe, expect, it } from 'vitest';
import {
  cssFontFamilyStack,
  resolveThemeFont,
  resolveThemeFontStack,
} from '../../../src/renderer/fontResolver';
import { createMockRenderContext } from '../helpers/mockContext';

describe('fontResolver', () => {
  it('returns literal typefaces that are not theme placeholders', () => {
    const ctx = createMockRenderContext();

    expect(resolveThemeFont('Arial', ctx)).toBe('Arial');
  });

  it('resolves theme placeholders through direct major and minor slots', () => {
    const ctx = createMockRenderContext();
    ctx.theme.majorFont = { latin: 'Major Latin', ea: 'Major EA', cs: 'Major CS' };
    ctx.theme.minorFont = { latin: 'Minor Latin', ea: 'Minor EA', cs: 'Minor CS' };

    expect(resolveThemeFont('+mj-lt', ctx)).toBe('Major Latin');
    expect(resolveThemeFont('+mj-ea', ctx)).toBe('Major EA');
    expect(resolveThemeFont('+mj-cs', ctx)).toBe('Major CS');
    expect(resolveThemeFont('+mn-lt', ctx)).toBe('Minor Latin');
    expect(resolveThemeFont('+mn-ea', ctx)).toBe('Minor EA');
    expect(resolveThemeFont('+mn-cs', ctx)).toBe('Minor CS');
  });

  it('uses language-specific script fonts for East Asian theme placeholders', () => {
    const ctx = createMockRenderContext();
    ctx.theme.majorFont = {
      latin: 'Major Latin',
      ea: '',
      cs: '',
      scripts: {
        Hans: 'Hans Font',
        Hant: 'Hant Font',
        Jpan: 'Jpan Font',
        Hang: 'Hang Font',
        Arab: 'Arab Font',
        Hebr: 'Hebr Font',
        Thai: 'Thai Font',
        Deva: 'Deva Font',
      },
    };

    expect(resolveThemeFont('+mj-ea', ctx, 'zh-CN')).toBe('Hans Font');
    expect(resolveThemeFont('+mj-ea', ctx, 'zh-TW')).toBe('Hant Font');
    expect(resolveThemeFont('+mj-ea', ctx, 'ja-JP')).toBe('Jpan Font');
    expect(resolveThemeFont('+mj-ea', ctx, 'ko-KR')).toBe('Hang Font');
    expect(resolveThemeFont('+mj-ea', ctx, 'ar-SA')).toBe('Arab Font');
    expect(resolveThemeFont('+mj-ea', ctx, 'he-IL')).toBe('Hebr Font');
    expect(resolveThemeFont('+mj-ea', ctx, 'th-TH')).toBe('Thai Font');
    expect(resolveThemeFont('+mj-ea', ctx, 'hi-IN')).toBe('Deva Font');
  });

  it('falls back through script table, latin, ea, cs, and finally the placeholder text', () => {
    const ctx = createMockRenderContext();
    ctx.theme.majorFont = {
      latin: '',
      ea: '',
      cs: '',
      scripts: { Jpan: 'Jpan Fallback' },
    };
    ctx.theme.minorFont = { latin: '', ea: 'Minor EA Fallback', cs: 'Minor CS Fallback' };

    expect(resolveThemeFont('+mj-ea', ctx, 'en-US')).toBe('Jpan Fallback');
    expect(resolveThemeFont('+mn-lt', ctx)).toBe('Minor EA Fallback');

    ctx.theme.minorFont = { latin: '', ea: '', cs: 'Minor CS Fallback' };
    expect(resolveThemeFont('+mn-lt', ctx)).toBe('Minor CS Fallback');

    ctx.theme.minorFont = { latin: '', ea: '', cs: '' };
    expect(resolveThemeFont('+mn-lt', ctx)).toBe('+mn-lt');
  });

  it('builds a resolved font stack while filtering empty and duplicate typefaces', () => {
    const ctx = createMockRenderContext();
    ctx.theme.minorFont = { latin: 'Calibri', ea: 'Microsoft YaHei', cs: '' };

    expect(resolveThemeFontStack(['+mn-lt', '', undefined, 'Calibri', '+mn-ea'], ctx)).toEqual([
      'Calibri',
      'Microsoft YaHei',
    ]);
  });

  it('keeps the original family as fallback when an embedded face cannot load', () => {
    const ctx = createMockRenderContext();
    ctx.presentation.embeddedFontFamilies = new Map([['example sans', '__pptx_embedded_1_0']]);
    ctx.usedEmbeddedFontFamilies = new Set();

    expect(resolveThemeFontStack(['Example Sans'], ctx)).toEqual([
      '__pptx_embedded_1_0',
      'Example Sans',
    ]);
    expect(ctx.usedEmbeddedFontFamilies).toEqual(new Set(['__pptx_embedded_1_0']));
  });

  it('serializes CSS font family stacks with aliases, CJK fallbacks, generics, and escaping', () => {
    expect(cssFontFamilyStack('Calibri')).toBe(
      '"Calibri", "Aptos", "Carlito", system-ui, "Arial", "Helvetica", sans-serif',
    );
    expect(cssFontFamilyStack(['Calibri', 'sans-serif'])).toBe(
      '"Calibri", "Aptos", "Carlito", system-ui, "Arial", "Helvetica", sans-serif',
    );
    expect(cssFontFamilyStack('Calibri Light')).toBe(
      '"Calibri Light", "Aptos Display", "Aptos", "Carlito", system-ui, "Arial", "Helvetica", sans-serif',
    );
    expect(cssFontFamilyStack('Aptos')).toBe(
      '"Aptos", system-ui, "Arial", "Helvetica", sans-serif',
    );
    expect(cssFontFamilyStack('微软雅黑')).toContain('"PingFang SC"');
    expect(cssFontFamilyStack('A "Quoted" \\ Font')).toBe('"A \\"Quoted\\" \\\\ Font"');
  });
});
