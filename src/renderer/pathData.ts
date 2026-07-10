interface PathPoint {
  x: number;
  y: number;
}

interface PathCubicSegment {
  c1: PathPoint;
  c2: PathPoint;
  end: PathPoint;
}

interface PathArcSegment {
  rx: number;
  ry: number;
  xAxisRotation: number;
  largeArc: 0 | 1;
  sweep: 0 | 1;
  end: PathPoint;
}

const DEFAULT_MAX_PATH_DATA_CHARS = 100_000;

export function flipAbsoluteSvgPathData(
  pathD: string,
  width: number,
  height: number,
  flipH: boolean,
  flipV: boolean,
): string {
  if (!pathD || (!flipH && !flipV)) return pathD;

  const tokens = tokenizeSvgPathData(pathD);
  if (!tokens) return pathD;

  const out: string[] = [];
  let i = 0;
  const readNumbers = (count: number): number[] | null => {
    if (i + count > tokens.length) return null;
    const values = tokens.slice(i, i + count).map(Number);
    if (values.some((value) => !Number.isFinite(value))) return null;
    i += count;
    return values;
  };
  const pointString = (x: number, y: number): string => {
    const nextX = flipH ? width - x : x;
    const nextY = flipV ? height - y : y;
    return `${formatPathNumber(nextX)},${formatPathNumber(nextY)}`;
  };

  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === 'Z' || command === 'z') {
      out.push('Z');
      continue;
    }

    const arity = command === 'C' ? 6 : command === 'Q' ? 4 : command === 'A' ? 7 : 2;
    if (
      command !== 'M' &&
      command !== 'L' &&
      command !== 'C' &&
      command !== 'Q' &&
      command !== 'A'
    ) {
      return pathD;
    }
    const values = readNumbers(arity);
    if (!values) return pathD;

    if (command === 'M' || command === 'L') {
      out.push(`${command}${pointString(values[0], values[1])}`);
    } else if (command === 'C') {
      out.push(
        `C${pointString(values[0], values[1])} ${pointString(values[2], values[3])} ${pointString(values[4], values[5])}`,
      );
    } else if (command === 'Q') {
      out.push(`Q${pointString(values[0], values[1])} ${pointString(values[2], values[3])}`);
    } else {
      const [rx, ry, axisRotation, largeArc, originalSweep, x, y] = values;
      const sweep = flipH !== flipV ? (originalSweep ? 0 : 1) : originalSweep;
      const nextX = flipH ? width - x : x;
      const nextY = flipV ? height - y : y;
      out.push(
        `A${formatPathNumber(rx)},${formatPathNumber(ry)} ${formatPathNumber(
          flipH !== flipV ? -axisRotation : axisRotation,
        )} ${largeArc},${sweep} ${formatPathNumber(nextX)},${formatPathNumber(nextY)}`,
      );
    }
  }

  return out.join(' ');
}

export function tokenizeSvgPathData(
  pathD: string,
  maxChars = DEFAULT_MAX_PATH_DATA_CHARS,
): string[] | null {
  if (!pathD || pathD.length > maxChars) return null;

  const tokens: string[] = [];
  let i = 0;

  while (i < pathD.length) {
    const code = pathD.charCodeAt(i);
    if (isSeparator(code)) {
      i++;
      continue;
    }

    if (isAsciiAlpha(code)) {
      tokens.push(pathD[i++]);
      continue;
    }

    const next = readSvgNumber(pathD, i);
    if (next > i) {
      tokens.push(pathD.slice(i, next));
      i = next;
      continue;
    }

    i++;
  }

  return tokens;
}

export function parseSimpleMoveLinePathData(
  pathD: string,
): { start: PathPoint; end: PathPoint } | null {
  const tokens = tokenizeSvgPathData(pathD);
  if (!tokens || tokens.length !== 6 || tokens[0] !== 'M' || tokens[3] !== 'L') return null;

  const start = readPoint(tokens, 1);
  const end = readPoint(tokens, 4);
  return start && end ? { start, end } : null;
}

export function parseMoveLinePathData(pathD: string): PathPoint[] | null {
  const tokens = tokenizeSvgPathData(pathD);
  if (!tokens || tokens.length < 3 || tokens[0] !== 'M') return null;

  const points: PathPoint[] = [];
  let i = 1;
  const first = readPoint(tokens, i);
  if (!first) return null;
  points.push(first);
  i += 2;

  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd !== 'L') return null;
    const point = readPoint(tokens, i);
    if (!point) return null;
    points.push(point);
    i += 2;
  }

  return points.length >= 2 ? points : null;
}

export function parseMoveCubicPathData(
  pathD: string,
): { start: PathPoint; segments: PathCubicSegment[] } | null {
  const tokens = tokenizeSvgPathData(pathD);
  if (!tokens || tokens.length < 8 || tokens[0] !== 'M') return null;

  const start = readPoint(tokens, 1);
  if (!start) return null;

  const segments: PathCubicSegment[] = [];
  let i = 3;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd !== 'C') return null;
    const c1 = readPoint(tokens, i);
    const c2 = readPoint(tokens, i + 2);
    const end = readPoint(tokens, i + 4);
    if (!c1 || !c2 || !end) return null;
    segments.push({ c1, c2, end });
    i += 6;
  }

  return segments.length > 0 ? { start, segments } : null;
}

export function parseMoveArcPathData(
  pathD: string,
): { start: PathPoint; arc: PathArcSegment } | null {
  const tokens = tokenizeSvgPathData(pathD);
  if (!tokens || tokens.length !== 11 || tokens[0] !== 'M' || tokens[3] !== 'A') return null;

  const start = readPoint(tokens, 1);
  const rx = Number(tokens[4]);
  const ry = Number(tokens[5]);
  const xAxisRotation = Number(tokens[6]);
  const largeArc = Number(tokens[7]) ? 1 : 0;
  const sweep = Number(tokens[8]) ? 1 : 0;
  const end = readPoint(tokens, 9);

  if (
    !start ||
    !end ||
    !Number.isFinite(rx) ||
    !Number.isFinite(ry) ||
    !Number.isFinite(xAxisRotation)
  ) {
    return null;
  }

  return { start, arc: { rx, ry, xAxisRotation, largeArc, sweep, end } };
}

function readPoint(tokens: string[], start: number): PathPoint | null {
  if (start + 1 >= tokens.length) return null;
  const x = Number(tokens[start]);
  const y = Number(tokens[start + 1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function formatPathNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function readSvgNumber(value: string, start: number): number {
  let i = start;
  if (value[i] === '-' || value[i] === '+') i++;

  let digits = 0;
  while (isAsciiDigit(value.charCodeAt(i))) {
    i++;
    digits++;
  }

  if (value[i] === '.') {
    i++;
    while (isAsciiDigit(value.charCodeAt(i))) {
      i++;
      digits++;
    }
  }

  if (digits === 0) return start;

  if (value[i] === 'e' || value[i] === 'E') {
    const exponentStart = i;
    i++;
    if (value[i] === '-' || value[i] === '+') i++;
    let exponentDigits = 0;
    while (isAsciiDigit(value.charCodeAt(i))) {
      i++;
      exponentDigits++;
    }
    if (exponentDigits === 0) return exponentStart;
  }

  return i;
}

function isSeparator(code: number): boolean {
  return code === 44 || code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

function isAsciiDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isAsciiAlpha(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
