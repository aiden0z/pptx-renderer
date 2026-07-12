/**
 * Font resolution helpers shared by text-like renderers.
 */

import type { RenderContext } from './RenderContext';

type ThemeFontSlot = 'lt' | 'ea' | 'cs';
type ThemeFontKey = 'latin' | 'ea' | 'cs';
type LanguageHint = string | null | undefined;

const THEME_FONT_REF = /^\+(mj|mn)-(lt|ea|cs)$/;
const THEME_FONT_SLOT_MAP: Record<ThemeFontSlot, ThemeFontKey> = {
  lt: 'latin',
  ea: 'ea',
  cs: 'cs',
};

const EAST_ASIAN_SCRIPT_FALLBACKS = ['Hans', 'Hant', 'Jpan', 'Hang'];

function normalizeLanguageHints(hints?: LanguageHint | LanguageHint[]): string[] {
  if (Array.isArray(hints)) {
    return hints.filter((hint): hint is string => typeof hint === 'string' && hint.length > 0);
  }
  return typeof hints === 'string' && hints.length > 0 ? [hints] : [];
}

function scriptFromLanguage(lang: string): string | undefined {
  const normalized = lang.toLowerCase();
  if (normalized.startsWith('zh')) {
    return /-(tw|hk|mo)\b/.test(normalized) ? 'Hant' : 'Hans';
  }
  if (normalized.startsWith('ja')) return 'Jpan';
  if (normalized.startsWith('ko')) return 'Hang';
  if (normalized.startsWith('ar')) return 'Arab';
  if (normalized.startsWith('he')) return 'Hebr';
  if (normalized.startsWith('th')) return 'Thai';
  if (normalized.startsWith('hi') || normalized.startsWith('mr') || normalized.startsWith('ne')) {
    return 'Deva';
  }
  return undefined;
}

function resolveScriptFont(
  scripts: Record<string, string> | undefined,
  hints?: LanguageHint | LanguageHint[],
): string | undefined {
  if (!scripts) return undefined;
  for (const hint of normalizeLanguageHints(hints)) {
    const script = scriptFromLanguage(hint);
    if (script && scripts[script]) return scripts[script];
  }
  for (const script of EAST_ASIAN_SCRIPT_FALLBACKS) {
    if (scripts[script]) return scripts[script];
  }
  return undefined;
}

function resolveThemeFontName(
  typeface: string,
  ctx: RenderContext,
  languageHints?: LanguageHint | LanguageHint[],
): string {
  const match = typeface.match(THEME_FONT_REF);
  if (!match) return typeface;

  const scheme = match[1];
  const slot = match[2] as ThemeFontSlot;
  const fonts = scheme === 'mj' ? ctx.theme.majorFont : ctx.theme.minorFont;
  const key = THEME_FONT_SLOT_MAP[slot];
  const direct = fonts[key];
  if (direct) return direct;
  if (slot === 'ea') {
    const scriptFont = resolveScriptFont(fonts.scripts, languageHints);
    if (scriptFont) return scriptFont;
  }
  return fonts.latin || fonts.ea || fonts.cs || typeface;
}

/**
 * Resolve theme font placeholder references like "+mj-lt" or "+mn-ea".
 */
export function resolveThemeFont(
  typeface: string,
  ctx: RenderContext,
  languageHints?: LanguageHint | LanguageHint[],
): string {
  const resolved = resolveThemeFontName(typeface, ctx, languageHints);
  const embeddedFamily = ctx.presentation.embeddedFontFamilies?.get(resolved.trim().toLowerCase());
  if (!embeddedFamily) return resolved;
  ctx.usedEmbeddedFontFamilies?.add(embeddedFamily);
  return embeddedFamily;
}

export function resolveThemeFontStack(
  typefaces: (string | undefined)[],
  ctx: RenderContext,
  languageHints?: LanguageHint | LanguageHint[],
): string[] {
  const seen = new Set<string>();
  const stack: string[] = [];
  for (const typeface of typefaces) {
    if (!typeface) continue;
    const resolved = resolveThemeFontName(typeface, ctx, languageHints).trim();
    const embedded = ctx.presentation.embeddedFontFamilies?.get(resolved.toLowerCase());
    if (embedded) ctx.usedEmbeddedFontFamilies?.add(embedded);
    for (const font of embedded ? [embedded, resolved] : [resolved]) {
      const key = font.toLowerCase();
      if (!font || seen.has(key)) continue;
      seen.add(key);
      stack.push(font);
    }
  }
  return stack;
}

const CSS_GENERIC_FONT_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'emoji',
  'math',
  'fangsong',
]);

const CJK_SANS_FALLBACKS = [
  'PingFang SC',
  'Hiragino Sans GB',
  'Noto Sans CJK SC',
  'Source Han Sans SC',
  'Arial Unicode MS',
  'sans-serif',
];

const CJK_FONT_FAMILY_ALIAS_KEYS = new Set([
  'microsoft yahei',
  'microsoft yahei ui',
  '微软雅黑',
  'dengxian',
  '等线',
  'simhei',
  '黑体',
  'heiti sc',
]);

const FONT_FAMILY_ALIASES: Record<string, string[]> = {
  calibri: ['Calibri', 'Aptos', 'Carlito', 'system-ui', 'Arial', 'Helvetica', 'sans-serif'],
  'calibri light': [
    'Calibri Light',
    'Aptos Display',
    'Aptos',
    'Carlito',
    'system-ui',
    'Arial',
    'Helvetica',
    'sans-serif',
  ],
  aptos: ['Aptos', 'system-ui', 'Arial', 'Helvetica', 'sans-serif'],
  'aptos display': ['Aptos Display', 'Aptos', 'system-ui', 'Arial', 'Helvetica', 'sans-serif'],
  'microsoft yahei': ['Microsoft YaHei', '微软雅黑'],
  'microsoft yahei ui': ['Microsoft YaHei UI', 'Microsoft YaHei', '微软雅黑'],
  微软雅黑: ['微软雅黑', 'Microsoft YaHei'],
  dengxian: ['DengXian', '等线'],
  等线: ['等线', 'DengXian'],
  simhei: ['SimHei', '黑体'],
  黑体: ['黑体', 'SimHei'],
  'heiti sc': ['Heiti SC', '黑体', 'SimHei'],
};

function normalizeFontFamilyName(fontFamily: string): string {
  return fontFamily
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .toLowerCase();
}

function cssFontFamilyToken(fontFamily: string): string {
  const normalized = normalizeFontFamilyName(fontFamily);
  if (CSS_GENERIC_FONT_FAMILIES.has(normalized)) {
    return normalized;
  }
  return `"${fontFamily.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function expandFontFamilyAliases(fontFamily: string): string[] {
  const normalized = normalizeFontFamilyName(fontFamily);
  return FONT_FAMILY_ALIASES[normalized] ?? [fontFamily.trim()];
}

export function cssFontFamilyStack(fontFamily: string | string[]): string {
  const baseFonts = Array.isArray(fontFamily)
    ? fontFamily.flatMap(expandFontFamilyAliases)
    : expandFontFamilyAliases(fontFamily);
  const needsCjkFallbacks = baseFonts.some((font) =>
    CJK_FONT_FAMILY_ALIAS_KEYS.has(normalizeFontFamilyName(font)),
  );
  const stack = needsCjkFallbacks ? [...baseFonts, ...CJK_SANS_FALLBACKS] : baseFonts;
  const seen = new Set<string>();
  const unique = stack.filter((font) => {
    const key = normalizeFontFamilyName(font);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.map(cssFontFamilyToken).join(', ');
}
