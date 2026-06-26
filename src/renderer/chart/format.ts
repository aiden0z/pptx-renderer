import { SafeXmlNode } from '../../parser/XmlParser';

const MAX_CHART_CACHE_POINTS = 10_000;

function getCachePointLimit(cache: SafeXmlNode): number {
  const declared = cache.child('ptCount').numAttr('val');
  let maxPresentIndex = -1;

  for (const pt of cache.children('pt')) {
    const idx = pt.numAttr('idx');
    if (idx !== undefined && Number.isInteger(idx) && idx >= 0 && idx < MAX_CHART_CACHE_POINTS) {
      maxPresentIndex = Math.max(maxPresentIndex, idx);
    }
  }

  const presentCount = maxPresentIndex + 1;
  if (declared === undefined || !Number.isFinite(declared) || declared < 0) {
    return presentCount;
  }

  const declaredCount = Math.floor(declared);
  if (declaredCount > MAX_CHART_CACHE_POINTS) {
    return presentCount;
  }

  return Math.min(Math.max(declaredCount, presentCount), MAX_CHART_CACHE_POINTS);
}

function isCachePointInRange(idx: number | undefined, pointLimit: number): idx is number {
  return (
    idx !== undefined &&
    Number.isInteger(idx) &&
    idx >= 0 &&
    idx < pointLimit &&
    idx < MAX_CHART_CACHE_POINTS
  );
}

export function extractStringValues(refNode: SafeXmlNode): string[] {
  const cache = refNode.child('strRef').exists()
    ? refNode.child('strRef').child('strCache')
    : refNode.child('strCache');

  if (!cache.exists()) {
    const numCache = refNode.child('numRef').exists()
      ? refNode.child('numRef').child('numCache')
      : refNode.child('numCache');
    if (numCache.exists()) {
      return extractNumericValuesAsStrings(numCache);
    }
    return [];
  }

  const pointLimit = getCachePointLimit(cache);
  const values: string[] = new Array(pointLimit).fill('');

  for (const pt of cache.children('pt')) {
    const idx = pt.numAttr('idx');
    if (isCachePointInRange(idx, pointLimit)) {
      const v = pt.child('v').text();
      values[idx] = v;
    }
  }

  return values;
}

export function extractFormatCode(refNode: SafeXmlNode): string | undefined {
  const cache = refNode.child('numRef').exists()
    ? refNode.child('numRef').child('numCache')
    : refNode.child('numCache');

  if (!cache.exists()) return undefined;

  const fc = cache.child('formatCode');
  if (!fc.exists()) return undefined;

  const text = fc.text();
  return text || undefined;
}

export function formatValue(value: number, formatCode: string | undefined): string {
  if (!formatCode || formatCode === 'General') {
    if (Number.isInteger(value)) return String(value);
    return parseFloat(value.toFixed(2)).toString();
  }

  if (formatCode.includes('%')) {
    const match = formatCode.match(/0\.(0+)%/);
    const decimals = match ? match[1].length : 0;
    const pctValue = value * 100;
    return `${pctValue.toFixed(decimals)}%`;
  }

  const decMatch = formatCode.match(/\.(0+|#+)/);
  if (decMatch) {
    const decimals = decMatch[1].length;
    return parseFloat(value.toFixed(decimals)).toString();
  }

  if (/^[#0,]+$/.test(formatCode.replace(/[[\]"\\]/g, ''))) {
    return Math.round(value).toString();
  }

  if (Number.isInteger(value)) return String(value);
  return parseFloat(value.toFixed(2)).toString();
}

export function extractNumericValues(refNode: SafeXmlNode): number[] {
  return extractNumericValuesWithBlanks(refNode).values;
}

export interface NumericValuesWithBlanks {
  values: number[];
  blankIndices: Set<number>;
}

export function extractNumericValuesWithBlanks(refNode: SafeXmlNode): NumericValuesWithBlanks {
  const cache = refNode.child('numRef').exists()
    ? refNode.child('numRef').child('numCache')
    : refNode.child('numCache');

  if (!cache.exists()) return { values: [], blankIndices: new Set() };

  const pointLimit = getCachePointLimit(cache);
  const values: number[] = new Array(pointLimit).fill(0);
  const blankIndices = new Set<number>();
  for (let i = 0; i < pointLimit; i++) blankIndices.add(i);

  for (const pt of cache.children('pt')) {
    const idx = pt.numAttr('idx');
    if (isCachePointInRange(idx, pointLimit)) {
      const raw = pt.child('v').text().trim();
      const v = parseFloat(raw);
      if (raw !== '' && !isNaN(v)) {
        values[idx] = v;
        blankIndices.delete(idx);
      }
    }
  }

  return { values, blankIndices };
}

function extractNumericValuesAsStrings(cache: SafeXmlNode): string[] {
  const pointLimit = getCachePointLimit(cache);
  const values: string[] = new Array(pointLimit).fill('');

  const fc = cache.child('formatCode').text();
  const isDateFmt = fc && /[yYmMdD]/.test(fc) && !/[#0]/.test(fc);

  for (const pt of cache.children('pt')) {
    const idx = pt.numAttr('idx');
    if (isCachePointInRange(idx, pointLimit)) {
      const raw = pt.child('v').text();
      if (isDateFmt && raw) {
        values[idx] = excelSerialToDateString(parseFloat(raw));
      } else {
        values[idx] = raw;
      }
    }
  }

  return values;
}

export function excelSerialToDateString(serial: number): string {
  if (!Number.isFinite(serial) || serial < 1) return String(serial);
  const adjusted = serial > 59 ? serial - 1 : serial;
  const epochUtc = Date.UTC(1899, 11, 31);
  const date = new Date(epochUtc + adjusted * 86400000);
  return `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}
