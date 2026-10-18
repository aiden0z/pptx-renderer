import {
  OOXML_PRESET_GEOMETRY_DEFINITIONS,
  OOXML_PRESET_GEOMETRY_SOURCE_SHA256,
  OOXML_PRESET_TEXT_RECTANGLE_DEFINITIONS,
} from './generated/ooxmlPresetGeometrySubset';

type OoxmlFormulaOperator =
  | '*/'
  | '+-'
  | '+/'
  | '?:'
  | 'abs'
  | 'at2'
  | 'cat2'
  | 'cos'
  | 'max'
  | 'min'
  | 'mod'
  | 'pin'
  | 'sat2'
  | 'sin'
  | 'sqrt'
  | 'tan'
  | 'val';

type OoxmlReference =
  | { readonly kind: 'literal'; readonly value: number }
  | { readonly kind: 'guide'; readonly name: string };

interface OoxmlFormula {
  readonly operator: OoxmlFormulaOperator;
  readonly operands: readonly OoxmlReference[];
}

interface OoxmlGuide {
  readonly name: string;
  readonly formula: OoxmlFormula;
}

interface OoxmlPoint {
  readonly x: OoxmlReference;
  readonly y: OoxmlReference;
}

type OoxmlPathCommand =
  | ({ readonly type: 'moveTo' | 'lnTo' } & OoxmlPoint)
  | {
      readonly type: 'quadBezTo';
      readonly control: OoxmlPoint;
      readonly end: OoxmlPoint;
    }
  | {
      readonly type: 'cubicBezTo';
      readonly control1: OoxmlPoint;
      readonly control2: OoxmlPoint;
      readonly end: OoxmlPoint;
    }
  | {
      readonly type: 'arcTo';
      readonly widthRadius: OoxmlReference;
      readonly heightRadius: OoxmlReference;
      readonly startAngle: OoxmlReference;
      readonly sweepAngle: OoxmlReference;
    }
  | { readonly type: 'close' };

type OoxmlPresetPathFill = 'norm' | 'darken' | 'darkenLess' | 'lighten' | 'lightenLess' | 'none';

interface OoxmlPath {
  readonly width: OoxmlReference | null;
  readonly height: OoxmlReference | null;
  readonly fill: OoxmlPresetPathFill;
  readonly stroke: boolean;
  readonly extrusionOk: boolean;
  readonly commands: readonly OoxmlPathCommand[];
}

interface OoxmlGuideDefinition {
  readonly name: string;
  readonly adjustmentGuides: readonly OoxmlGuide[];
  readonly calculatedGuides: readonly OoxmlGuide[];
}

interface OoxmlPresetDefinition extends OoxmlGuideDefinition {
  readonly paths: readonly OoxmlPath[];
}

interface OoxmlTextRectangleDefinition extends OoxmlGuideDefinition {
  readonly textRectangle: {
    readonly left: OoxmlReference;
    readonly top: OoxmlReference;
    readonly right: OoxmlReference;
    readonly bottom: OoxmlReference;
  };
}

interface PresetTextRectangle {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface EvaluatedPoint {
  x: number;
  y: number;
}

type EvaluatedCommand =
  | ({ type: 'moveTo' | 'lnTo' } & EvaluatedPoint)
  | { type: 'quadBezTo'; control: EvaluatedPoint; end: EvaluatedPoint }
  | {
      type: 'cubicBezTo';
      control1: EvaluatedPoint;
      control2: EvaluatedPoint;
      end: EvaluatedPoint;
    }
  | {
      type: 'arcTo';
      widthRadius: number;
      heightRadius: number;
      startAngle: number;
      sweepAngle: number;
    }
  | { type: 'close' };

interface EvaluatedPath {
  width: number;
  height: number;
  fill: OoxmlPresetPathFill;
  stroke: boolean;
  extrusionOk: boolean;
  commands: EvaluatedCommand[];
}

interface OoxmlEmittedPresetPath {
  d: string;
  fill: OoxmlPresetPathFill;
  stroke: boolean;
  extrusionOk: boolean;
}

const ANGLE_UNITS_PER_DEGREE = 60000;
const ANGLE_UNITS_PER_RADIAN = (180 * ANGLE_UNITS_PER_DEGREE) / Math.PI;
const RADIANS_PER_ANGLE_UNIT = Math.PI / (180 * ANGLE_UNITS_PER_DEGREE);
const OUTPUT_PRECISION = 6;
const FORMULA_ARITIES: Readonly<Record<OoxmlFormulaOperator, number>> = Object.freeze({
  '*/': 3,
  '+-': 3,
  '+/': 3,
  '?:': 3,
  abs: 1,
  at2: 2,
  cat2: 3,
  cos: 2,
  max: 2,
  min: 2,
  mod: 3,
  pin: 3,
  sat2: 3,
  sin: 2,
  sqrt: 1,
  tan: 2,
  val: 1,
});

const runtimeDefinitions =
  OOXML_PRESET_GEOMETRY_DEFINITIONS as unknown as readonly OoxmlPresetDefinition[];
const runtimeByName = new Map(
  runtimeDefinitions.map((definition) => [definition.name.toLowerCase(), definition]),
);
const textRectangleByName = new Map(
  (
    OOXML_PRESET_TEXT_RECTANGLE_DEFINITIONS as unknown as readonly OoxmlTextRectangleDefinition[]
  ).map((definition) => [definition.name.toLowerCase(), definition]),
);

export const ooxmlPresetRuntimeShapeNames: readonly string[] = Object.freeze(
  runtimeDefinitions.map(({ name }) => name),
);
export const ooxmlPresetRuntimeMultiPathShapeNames: readonly string[] = Object.freeze(
  runtimeDefinitions.filter(({ paths }) => paths.length > 1).map(({ name }) => name),
);
export const ooxmlPresetRuntimeSourceSha256 = OOXML_PRESET_GEOMETRY_SOURCE_SHA256;

function finiteNumber(value: number, context: string): number {
  if (!Number.isFinite(value)) throw new Error(`${context} must be finite`);
  return Object.is(value, -0) ? 0 : value;
}

function positiveNumber(value: number, context: string): number {
  const finite = finiteNumber(value, context);
  if (finite <= 0) throw new Error(`${context} must be greater than zero`);
  return finite;
}

function divide(numerator: number, denominator: number, operator: string): number {
  if (denominator === 0) throw new Error(`Division by zero while evaluating ${operator}`);
  return numerator / denominator;
}

export function evaluateOoxmlGuideFormula(
  operator: string,
  inputValues: readonly number[],
): number {
  if (!Object.prototype.hasOwnProperty.call(FORMULA_ARITIES, operator)) {
    throw new Error(`Unknown OOXML guide formula operator: ${operator}`);
  }
  const typedOperator = operator as OoxmlFormulaOperator;
  const expected = FORMULA_ARITIES[typedOperator];
  if (inputValues.length !== expected) {
    throw new Error(
      `OOXML guide formula operator ${operator} expects ${expected} operands; received ${inputValues.length}`,
    );
  }
  const values = inputValues.map((value, index) =>
    finiteNumber(value, `OOXML guide formula operand ${index + 1}`),
  );
  let result: number;
  switch (typedOperator) {
    case '*/':
      result = divide(values[0] * values[1], values[2], '*/');
      break;
    case '+-':
      result = values[0] + values[1] - values[2];
      break;
    case '+/':
      result = divide(values[0] + values[1], values[2], '+/');
      break;
    case '?:':
      result = values[0] > 0 ? values[1] : values[2];
      break;
    case 'abs':
      result = Math.abs(values[0]);
      break;
    case 'at2':
      result =
        values[0] === 0 && values[1] === 0
          ? 0
          : Math.atan2(values[1], values[0]) * ANGLE_UNITS_PER_RADIAN;
      break;
    case 'cat2':
      result = values[0] * Math.cos(Math.atan2(values[2], values[1]));
      break;
    case 'cos':
      result = values[0] * Math.cos(values[1] * RADIANS_PER_ANGLE_UNIT);
      break;
    case 'max':
      result = Math.max(values[0], values[1]);
      break;
    case 'min':
      result = Math.min(values[0], values[1]);
      break;
    case 'mod':
      result = Math.hypot(values[0], values[1], values[2]);
      break;
    case 'pin':
      result = values[1] < values[0] ? values[0] : values[1] > values[2] ? values[2] : values[1];
      break;
    case 'sat2':
      result = values[0] * Math.sin(Math.atan2(values[2], values[1]));
      break;
    case 'sin':
      result = values[0] * Math.sin(values[1] * RADIANS_PER_ANGLE_UNIT);
      break;
    case 'sqrt':
      result = Math.sqrt(Math.abs(values[0]));
      break;
    case 'tan':
      result = values[0] * Math.tan(values[1] * RADIANS_PER_ANGLE_UNIT);
      break;
    case 'val':
      [result] = values;
      break;
  }
  return finiteNumber(result, `Non-finite result while evaluating ${operator}`);
}

function createGuideEnvironment(width: number, height: number): Map<string, number> {
  const w = positiveNumber(width, 'width');
  const h = positiveNumber(height, 'height');
  const ss = Math.min(w, h);
  const environment = new Map<string, number>([
    ['3cd4', 16200000],
    ['3cd8', 8100000],
    ['5cd8', 13500000],
    ['7cd8', 18900000],
    ['b', h],
    ['cd2', 10800000],
    ['cd3', 7200000],
    ['cd4', 5400000],
    ['cd8', 2700000],
    ['h', h],
    ['hc', w / 2],
    ['hd2', h / 2],
    ['hd3', h / 3],
    ['hd4', h / 4],
    ['hd5', h / 5],
    ['hd6', h / 6],
    ['hd8', h / 8],
    ['hd10', h / 10],
    ['l', 0],
    ['ls', Math.max(w, h)],
    ['r', w],
    ['ss', ss],
    ['ssd2', ss / 2],
    ['ssd4', ss / 4],
    ['ssd6', ss / 6],
    ['ssd8', ss / 8],
    ['ssd16', ss / 16],
    ['ssd32', ss / 32],
    ['t', 0],
    ['vc', h / 2],
    ['w', w],
    ['wd2', w / 2],
    ['wd3', w / 3],
    ['wd4', w / 4],
    ['wd5', w / 5],
    ['wd6', w / 6],
    ['wd8', w / 8],
    ['wd10', w / 10],
    ['wd12', w / 12],
    ['wd32', w / 32],
  ]);
  return environment;
}

function resolveReference(
  reference: OoxmlReference,
  environment: ReadonlyMap<string, number>,
  context: string,
): number {
  if (reference.kind === 'literal') return finiteNumber(reference.value, `${context} literal`);
  const value = environment.get(reference.name);
  if (value === undefined) throw new Error(`${context}: unknown guide ${reference.name}`);
  return finiteNumber(value, `${context} guide ${reference.name}`);
}

function evaluateFormula(formula: OoxmlFormula, environment: ReadonlyMap<string, number>): number {
  return evaluateOoxmlGuideFormula(
    formula.operator,
    formula.operands.map((operand) => resolveReference(operand, environment, 'Formula operand')),
  );
}

function evaluatePoint(
  point: OoxmlPoint,
  environment: ReadonlyMap<string, number>,
  context: string,
): EvaluatedPoint {
  return {
    x: resolveReference(point.x, environment, `${context} x`),
    y: resolveReference(point.y, environment, `${context} y`),
  };
}

function evaluateCommand(
  command: OoxmlPathCommand,
  environment: ReadonlyMap<string, number>,
  context: string,
): EvaluatedCommand {
  switch (command.type) {
    case 'moveTo':
    case 'lnTo':
      return { type: command.type, ...evaluatePoint(command, environment, context) };
    case 'quadBezTo':
      return {
        type: command.type,
        control: evaluatePoint(command.control, environment, `${context} control`),
        end: evaluatePoint(command.end, environment, `${context} end`),
      };
    case 'cubicBezTo':
      return {
        type: command.type,
        control1: evaluatePoint(command.control1, environment, `${context} control1`),
        control2: evaluatePoint(command.control2, environment, `${context} control2`),
        end: evaluatePoint(command.end, environment, `${context} end`),
      };
    case 'arcTo':
      return {
        type: command.type,
        widthRadius: resolveReference(command.widthRadius, environment, `${context} widthRadius`),
        heightRadius: resolveReference(
          command.heightRadius,
          environment,
          `${context} heightRadius`,
        ),
        startAngle: resolveReference(command.startAngle, environment, `${context} startAngle`),
        sweepAngle: resolveReference(command.sweepAngle, environment, `${context} sweepAngle`),
      };
    case 'close':
      return { type: command.type };
  }
}

function createDefinitionEnvironment(
  definition: OoxmlGuideDefinition,
  width: number,
  height: number,
  adjustments: ReadonlyMap<string, number>,
): Map<string, number> {
  const environment = createGuideEnvironment(width, height);
  const adjustmentNames = new Set(definition.adjustmentGuides.map(({ name }) => name));
  for (const [name, value] of adjustments) {
    if (adjustmentNames.has(name)) finiteNumber(value, `Adjustment ${name}`);
  }
  for (const guide of definition.adjustmentGuides) {
    const value = adjustments.has(guide.name)
      ? finiteNumber(adjustments.get(guide.name)!, `Adjustment ${guide.name}`)
      : evaluateFormula(guide.formula, environment);
    environment.set(guide.name, value);
  }
  for (const guide of definition.calculatedGuides) {
    environment.set(guide.name, evaluateFormula(guide.formula, environment));
  }
  return environment;
}

function evaluateDefinition(
  definition: OoxmlPresetDefinition,
  width: number,
  height: number,
  adjustments: ReadonlyMap<string, number>,
): EvaluatedPath[] {
  const environment = createDefinitionEnvironment(definition, width, height, adjustments);
  return definition.paths.map((path, pathIndex) => ({
    width:
      path.width === null
        ? width
        : positiveNumber(
            resolveReference(path.width, environment, `${definition.name} path ${pathIndex} width`),
            `${definition.name} path ${pathIndex} width`,
          ),
    height:
      path.height === null
        ? height
        : positiveNumber(
            resolveReference(
              path.height,
              environment,
              `${definition.name} path ${pathIndex} height`,
            ),
            `${definition.name} path ${pathIndex} height`,
          ),
    fill: path.fill,
    stroke: path.stroke,
    extrusionOk: path.extrusionOk,
    commands: path.commands.map((command, commandIndex) =>
      evaluateCommand(
        command,
        environment,
        `${definition.name} path ${pathIndex} command ${commandIndex}`,
      ),
    ),
  }));
}

function formatNumber(value: number, context: string): string {
  const rounded = Number(finiteNumber(value, context).toFixed(OUTPUT_PRECISION));
  return rounded === 0 || Object.is(rounded, -0) ? '0' : String(rounded);
}

function serializePoint(point: EvaluatedPoint, context: string): string {
  return `${formatNumber(point.x, `${context} x`)},${formatNumber(point.y, `${context} y`)}`;
}

function visualAnglePoint(
  center: EvaluatedPoint,
  widthRadius: number,
  heightRadius: number,
  angle: number,
): EvaluatedPoint {
  const visualRadians = angle * RADIANS_PER_ANGLE_UNIT;
  const parameter = Math.atan2(
    widthRadius * Math.sin(visualRadians),
    heightRadius * Math.cos(visualRadians),
  );
  return {
    x: center.x + widthRadius * Math.cos(parameter),
    y: center.y + heightRadius * Math.sin(parameter),
  };
}

function emitPath(
  definition: OoxmlPresetDefinition,
  path: EvaluatedPath,
  pathIndex: number,
  width: number,
  height: number,
): OoxmlEmittedPresetPath {
  const context = `${definition.name} path ${pathIndex}`;
  const scaleX = width / path.width;
  const scaleY = height / path.height;
  const scalePoint = (point: EvaluatedPoint): EvaluatedPoint => ({
    x: point.x * scaleX,
    y: point.y * scaleY,
  });
  const segments: string[] = [];
  let cursor: EvaluatedPoint | null = null;
  let subpathStart: EvaluatedPoint | null = null;
  for (const [commandIndex, command] of path.commands.entries()) {
    const commandContext = `${context} command ${commandIndex}`;
    switch (command.type) {
      case 'moveTo':
        cursor = command;
        subpathStart = command;
        segments.push(`M${serializePoint(scalePoint(command), commandContext)}`);
        break;
      case 'lnTo':
        if (!cursor) throw new Error(`${commandContext}: command requires a current point`);
        cursor = command;
        segments.push(`L${serializePoint(scalePoint(command), commandContext)}`);
        break;
      case 'quadBezTo':
        if (!cursor) throw new Error(`${commandContext}: command requires a current point`);
        segments.push(
          `Q${serializePoint(scalePoint(command.control), `${commandContext} control`)} ${serializePoint(scalePoint(command.end), `${commandContext} end`)}`,
        );
        cursor = command.end;
        break;
      case 'cubicBezTo':
        if (!cursor) throw new Error(`${commandContext}: command requires a current point`);
        segments.push(
          `C${serializePoint(scalePoint(command.control1), `${commandContext} control1`)} ${serializePoint(scalePoint(command.control2), `${commandContext} control2`)} ${serializePoint(scalePoint(command.end), `${commandContext} end`)}`,
        );
        cursor = command.end;
        break;
      case 'arcTo': {
        if (!cursor) throw new Error(`${commandContext}: command requires a current point`);
        let widthRadius = finiteNumber(command.widthRadius, `${commandContext} widthRadius`);
        let heightRadius = finiteNumber(command.heightRadius, `${commandContext} heightRadius`);
        const radiusTolerance =
          Number.EPSILON *
          Math.max(1, path.width, path.height, Math.abs(widthRadius), Math.abs(heightRadius)) *
          64;
        if (widthRadius < -radiusTolerance || heightRadius < -radiusTolerance) {
          throw new Error(`${commandContext}: arc radii must be non-negative`);
        }
        if (widthRadius < 0) widthRadius = 0;
        if (heightRadius < 0) heightRadius = 0;
        if (widthRadius === 0 || heightRadius === 0 || command.sweepAngle === 0) break;
        const startOffset = visualAnglePoint(
          { x: 0, y: 0 },
          widthRadius,
          heightRadius,
          command.startAngle,
        );
        const center = { x: cursor.x - startOffset.x, y: cursor.y - startOffset.y };
        const sweepDegrees = command.sweepAngle / ANGLE_UNITS_PER_DEGREE;
        const segmentCount =
          Math.abs(sweepDegrees) >= 360 ? Math.ceil(Math.abs(sweepDegrees) / 180) : 1;
        const segmentSweep = command.sweepAngle / segmentCount;
        const largeArc = Math.abs(segmentSweep / ANGLE_UNITS_PER_DEGREE) > 180 ? 1 : 0;
        const sweep = segmentSweep > 0 ? 1 : 0;
        const radii = serializePoint(
          { x: widthRadius * scaleX, y: heightRadius * scaleY },
          `${commandContext} radii`,
        );
        for (let index = 1; index <= segmentCount; index += 1) {
          cursor = visualAnglePoint(
            center,
            widthRadius,
            heightRadius,
            command.startAngle + segmentSweep * index,
          );
          segments.push(
            `A${radii} 0 ${largeArc},${sweep} ${serializePoint(scalePoint(cursor), `${commandContext} endpoint ${index}`)}`,
          );
        }
        break;
      }
      case 'close':
        if (!subpathStart) throw new Error(`${commandContext}: close requires a subpath start`);
        segments.push('Z');
        cursor = subpathStart;
        break;
    }
  }
  return {
    d: segments.join(' '),
    fill: path.fill,
    stroke: path.stroke,
    extrusionOk: path.extrusionOk,
  };
}

/** Resolve a preset's authored text rect in the same pixel space as its rendered geometry. */
export function getOoxmlPresetTextRectangle(
  shapeType: string,
  width: number,
  height: number,
  adjustments: ReadonlyMap<string, number> = new Map(),
): PresetTextRectangle | null {
  const definition = textRectangleByName.get(shapeType.toLowerCase());
  if (
    !definition ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  try {
    const environment = createDefinitionEnvironment(definition, width, height, adjustments);
    const rect = definition.textRectangle;
    const x = resolveReference(rect.left, environment, `${definition.name} rect left`);
    const y = resolveReference(rect.top, environment, `${definition.name} rect top`);
    const right = resolveReference(rect.right, environment, `${definition.name} rect right`);
    const bottom = resolveReference(rect.bottom, environment, `${definition.name} rect bottom`);
    return { x, y, w: right - x, h: bottom - y };
  } catch {
    // Valid degenerate paths (for example arrow adj2=0) can have undefined text guides.
    // Keep their geometry/label renderable with the existing full-bounds fallback.
    return null;
  }
}

export function getOoxmlPresetShapePaths(
  shapeType: string,
  width: number,
  height: number,
  adjustments: ReadonlyMap<string, number> = new Map(),
): OoxmlEmittedPresetPath[] | null {
  const definition = runtimeByName.get(shapeType.toLowerCase());
  if (!definition) return null;
  const normalizedWidth = positiveNumber(width, `${definition.name} width`);
  const normalizedHeight = positiveNumber(height, `${definition.name} height`);
  const paths = evaluateDefinition(definition, normalizedWidth, normalizedHeight, adjustments);
  return paths.map((path, pathIndex) =>
    emitPath(definition, path, pathIndex, normalizedWidth, normalizedHeight),
  );
}
