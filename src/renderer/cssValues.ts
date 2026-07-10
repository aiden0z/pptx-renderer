const MAX_CSS_LENGTH_VALUE_CHARS = 128;

export function scaleCssLengthForTransform(length: string, scale: number): string {
  if (!(scale > 0)) return length;

  const trimmed = length.trim();
  if (!trimmed) return `${100 / scale}%`;
  if (trimmed.length > MAX_CSS_LENGTH_VALUE_CHARS) return length;

  const parsed = parseCssLength(trimmed);
  if (!parsed) return length;

  return `${parsed.value / scale}${parsed.unit || '%'}`;
}

function parseCssLength(input: string): { value: number; unit: string } | null {
  let i = 0;
  if (input[i] === '-' || input[i] === '+') i++;

  let digits = 0;
  while (isAsciiDigit(input.charCodeAt(i))) {
    i++;
    digits++;
  }

  if (input[i] === '.') {
    i++;
    while (isAsciiDigit(input.charCodeAt(i))) {
      i++;
      digits++;
    }
  }

  if (digits === 0) return null;

  if (input[i] === 'e' || input[i] === 'E') {
    const exponentStart = i;
    i++;
    if (input[i] === '-' || input[i] === '+') i++;
    let exponentDigits = 0;
    while (isAsciiDigit(input.charCodeAt(i))) {
      i++;
      exponentDigits++;
    }
    if (exponentDigits === 0) i = exponentStart;
  }

  const value = Number(input.slice(0, i));
  if (!Number.isFinite(value)) return null;

  const unit = input.slice(i);
  if (!isCssLengthUnit(unit)) return null;

  return { value, unit };
}

export function splitTiledPatternFillCss(
  fillCss: string,
): { imageLayers: string; color: string } | null {
  const commaIndex = findLastTopLevelComma(fillCss);
  if (commaIndex < 0) return null;

  const color = fillCss.slice(commaIndex + 1).trim();
  if (!isSupportedCssColorToken(color)) return null;

  return {
    imageLayers: removeTiledPatternLayerSize(fillCss.slice(0, commaIndex)),
    color,
  };
}

function findLastTopLevelComma(value: string): number {
  let depth = 0;
  for (let i = value.length - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch === ')') {
      depth++;
    } else if (ch === '(') {
      if (depth > 0) depth--;
    } else if (ch === ',' && depth === 0) {
      return i;
    }
  }
  return -1;
}

function removeTiledPatternLayerSize(value: string): string {
  const marker = '0 0 / 8px 8px';
  return value.split(marker).join('').trimEnd();
}

function isSupportedCssColorToken(value: string): boolean {
  if (!value) return false;
  if (value[0] === '#') {
    const length = value.length - 1;
    if (![3, 4, 6, 8].includes(length)) return false;
    for (let i = 1; i < value.length; i++) {
      if (!isAsciiHex(value.charCodeAt(i))) return false;
    }
    return true;
  }

  const lower = value.toLowerCase();
  if (lower.startsWith('rgb(') || lower.startsWith('rgba(')) {
    return value.endsWith(')') && !value.slice(0, -1).includes(')');
  }

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (!isAsciiAlpha(code)) return false;
  }
  return true;
}

function isCssLengthUnit(unit: string): boolean {
  if (!unit) return true;
  if (unit === '%') return true;
  for (let i = 0; i < unit.length; i++) {
    if (!isAsciiAlpha(unit.charCodeAt(i))) return false;
  }
  return true;
}

function isAsciiDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isAsciiAlpha(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiHex(code: number): boolean {
  return isAsciiDigit(code) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}
