#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildPresetShapeCatalog,
  loadPinnedPresetShapeDefinitions,
  stableJson,
} from './source-validator.mjs';
import {
  compilePresetShapeDefinitions,
  evaluatePresetShape,
  summarizePresetGeometryIr,
} from './geometry-ir.mjs';
import { emitPresetShapePaths, summarizeEmittedPresetShape } from './path-emitter.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = resolve(scriptDirectory, '../..');
const defaultOutput = 'scripts/ooxml-geometry/generated/preset-shape-catalog.json';
const defaultRuntimeOutput = 'src/shapes/generated/ooxmlPresetGeometrySubset.ts';
const threePathStyleContract = (finalStroke = true) =>
  Object.freeze([
    Object.freeze({ fill: 'norm', stroke: false, extrusionOk: false }),
    Object.freeze({ fill: 'none', stroke: true, extrusionOk: false }),
    Object.freeze({ fill: 'none', stroke: finalStroke, extrusionOk: true }),
  ]);
const runtimeShapeCandidates = Object.freeze([
  { name: 'flowChartProcess', expectedPathCount: 1 }, // MsoAutoShapeType 61
  { name: 'flowChartAlternateProcess', expectedPathCount: 1 }, // 62
  { name: 'flowChartDecision', expectedPathCount: 1 }, // 63
  { name: 'flowChartInputOutput', expectedPathCount: 1 }, // 64 (PowerPoint label: Data)
  {
    name: 'flowChartPredefinedProcess',
    expectedPathCount: 3,
    expectedPathStyles: threePathStyleContract(),
  }, // 65
  {
    name: 'flowChartInternalStorage',
    expectedPathCount: 3,
    expectedPathStyles: threePathStyleContract(),
  }, // 66
  { name: 'flowChartDocument', expectedPathCount: 1 }, // 67
  {
    name: 'flowChartMultidocument',
    expectedPathCount: 3,
    expectedPathStyles: threePathStyleContract(false),
  }, // 68
  { name: 'flowChartTerminator', expectedPathCount: 1 }, // 69
  { name: 'flowChartPreparation', expectedPathCount: 1 }, // 70
  { name: 'flowChartManualInput', expectedPathCount: 1 }, // 71
  { name: 'flowChartManualOperation', expectedPathCount: 1 }, // 72
  { name: 'flowChartConnector', expectedPathCount: 1 }, // 73
  { name: 'flowChartOffpageConnector', expectedPathCount: 1 }, // 74
  { name: 'flowChartPunchedCard', expectedPathCount: 1 }, // 75 (PowerPoint label: Card)
  { name: 'flowChartPunchedTape', expectedPathCount: 1 }, // 76
  {
    name: 'flowChartSummingJunction',
    expectedPathCount: 3,
    expectedPathStyles: threePathStyleContract(),
  }, // 77
  { name: 'flowChartOr', expectedPathCount: 3, expectedPathStyles: threePathStyleContract() }, // 78
  { name: 'flowChartCollate', expectedPathCount: 1 }, // 79
  { name: 'flowChartSort', expectedPathCount: 3, expectedPathStyles: threePathStyleContract() }, // 80
  { name: 'flowChartExtract', expectedPathCount: 1 }, // 81
  { name: 'flowChartMerge', expectedPathCount: 1 }, // 82
  { name: 'flowChartOnlineStorage', expectedPathCount: 1 }, // 83 (PowerPoint label: Stored Data)
  { name: 'flowChartDelay', expectedPathCount: 1 }, // 84
  { name: 'flowChartMagneticTape', expectedPathCount: 1 }, // 85 (Sequential Access Storage)
  {
    name: 'flowChartMagneticDisk',
    expectedPathCount: 3,
    expectedPathStyles: threePathStyleContract(),
  }, // 86
  {
    name: 'flowChartMagneticDrum',
    expectedPathCount: 3,
    expectedPathStyles: threePathStyleContract(),
  }, // 87 (Direct Access Storage)
  { name: 'flowChartDisplay', expectedPathCount: 1 }, // 88
  {
    name: 'donut',
    expectedPathCount: 1,
    expectedAdjustments: Object.freeze([
      Object.freeze({
        name: 'adj',
        defaultValue: 25000,
        handle: Object.freeze({ type: 'polar', axis: 'radius', min: 0, max: 50000 }),
      }),
    ]),
  }, // MsoAutoShapeType 18; first bounded-adjustment production cohort
]);
const evaluationProfiles = Object.freeze([
  { name: 'square', width: 216, height: 216 },
  { name: 'wide', width: 400, height: 180 },
  { name: 'tall', width: 180, height: 400 },
]);

function literalReferenceValue(reference, context) {
  if (reference?.kind !== 'literal' || !Number.isFinite(reference.value)) {
    throw new Error(`${context} must be a finite literal in the adjustment contract`);
  }
  return reference.value;
}

function validateAdjustmentContract(shape, expectedAdjustments) {
  const expected = expectedAdjustments ?? [];
  const handles = shape.adjustHandles ?? [];
  if (shape.adjustmentGuides.length !== expected.length) {
    throw new Error(
      `OOXML runtime subset adjustment guides contract expected ${expected.length} guides but found ${shape.adjustmentGuides.length}: ${shape.name}`,
    );
  }
  if (handles.length !== expected.length) {
    throw new Error(
      `OOXML runtime subset adjustment handles contract expected ${expected.length} handles but found ${handles.length}: ${shape.name}`,
    );
  }
  for (const [index, contract] of expected.entries()) {
    const guide = shape.adjustmentGuides[index];
    if (
      guide.name !== contract.name ||
      guide.formula.operator !== 'val' ||
      guide.formula.operands.length !== 1 ||
      literalReferenceValue(
        guide.formula.operands[0],
        `${shape.name} adjustment ${contract.name} default`,
      ) !== contract.defaultValue
    ) {
      throw new Error(
        `OOXML runtime subset adjustment ${contract.name} default differs from its production contract: ${shape.name}`,
      );
    }
    const handle = handles[index];
    if (
      contract.handle?.type !== 'polar' ||
      contract.handle.axis !== 'radius' ||
      handle.type !== 'polar' ||
      handle.guideRefR !== contract.name ||
      handle.guideRefAngle !== null ||
      handle.minAngle !== null ||
      handle.maxAngle !== null ||
      literalReferenceValue(handle.minR, `${shape.name} adjustment ${contract.name} minimum`) !==
        contract.handle.min ||
      literalReferenceValue(handle.maxR, `${shape.name} adjustment ${contract.name} maximum`) !==
        contract.handle.max
    ) {
      throw new Error(
        `OOXML runtime subset adjustment ${contract.name} handle differs from its production contract: ${shape.name}`,
      );
    }
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function writeOrCheckGeneratedCatalog({
  artifactLabel = 'OOXML geometry catalog',
  check = false,
  generated,
  outputPath,
}) {
  if (check) {
    let current;
    try {
      current = await readFile(outputPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error(`Generated ${artifactLabel} is missing: ${outputPath}`);
      }
      throw error;
    }
    if (current !== generated) {
      throw new Error(
        `Generated ${artifactLabel} is stale: ${outputPath}. Run pnpm geometry:generate.`,
      );
    }
    return { outputPath, status: 'current' };
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated, 'utf8');
  return { outputPath, status: 'generated' };
}

function textRectangleDefinition(shape) {
  const guides = [...shape.adjustmentGuides, ...shape.calculatedGuides];
  const needed = new Set(
    Object.values(shape.textRectangle)
      .filter((ref) => ref.kind === 'guide')
      .map((ref) => ref.name),
  );
  const retained = new Set();
  // Guides execute in order and may reuse a name (for example ellipseRibbon's q1).
  // Reverse liveness retains the correct earlier value for each use before an overwrite.
  for (let index = guides.length - 1; index >= 0; index--) {
    const guide = guides[index];
    if (!needed.delete(guide.name)) continue;
    retained.add(guide);
    for (const ref of guide.formula.operands) {
      if (ref.kind === 'guide') needed.add(ref.name);
    }
  }
  return {
    name: shape.name,
    adjustmentGuides: shape.adjustmentGuides.filter((guide) => retained.has(guide)),
    calculatedGuides: shape.calculatedGuides.filter((guide) => retained.has(guide)),
    textRectangle: shape.textRectangle,
  };
}

export function buildRuntimeGeometryModule(ir, candidates = runtimeShapeCandidates) {
  const candidateNames = candidates.map(({ name }) => name);
  if (new Set(candidateNames).size !== candidateNames.length) {
    throw new Error('OOXML runtime subset shape names must be unique');
  }
  const shapeByName = new Map(ir.shapes.map((shape) => [shape.name, shape]));
  const definitions = candidates.map(
    ({ name, expectedPathCount, expectedPathStyles, expectedAdjustments }) => {
      if (expectedPathCount !== 1 && expectedPathCount !== 3) {
        throw new Error(
          `OOXML runtime subset shape has unsupported expected path count ${expectedPathCount}: ${name}`,
        );
      }
      const shape = shapeByName.get(name);
      if (!shape) throw new Error(`OOXML runtime subset shape is missing from source: ${name}`);
      if (shape.paths.length !== expectedPathCount) {
        throw new Error(
          `OOXML runtime subset shape expected ${expectedPathCount} paths but found ${shape.paths.length}: ${name}`,
        );
      }
      validateAdjustmentContract(shape, expectedAdjustments);
      if (expectedPathCount === 3) {
        if (!Array.isArray(expectedPathStyles) || expectedPathStyles.length !== 3) {
          throw new Error(
            `OOXML runtime subset shape is missing its three-path style contract: ${name}`,
          );
        }
        for (const [pathIndex, expectedStyle] of expectedPathStyles.entries()) {
          const path = shape.paths[pathIndex];
          if (
            path.fill !== expectedStyle.fill ||
            path.stroke !== expectedStyle.stroke ||
            path.extrusionOk !== expectedStyle.extrusionOk
          ) {
            throw new Error(
              `OOXML runtime subset shape ${name} path ${pathIndex} has unsupported multi-path style metadata`,
            );
          }
        }
      }
      return {
        name: shape.name,
        adjustmentGuides: shape.adjustmentGuides,
        calculatedGuides: shape.calculatedGuides,
        paths: shape.paths,
      };
    },
  );
  const sourceSha256 = ir.source?.presetShapeDefinitions?.sha256;
  if (!/^[a-f0-9]{64}$/.test(sourceSha256 ?? '')) {
    throw new Error('OOXML runtime subset requires a valid preset source SHA-256');
  }
  const serializedDefinitions = stableJson(definitions).trimEnd();
  // Text layout uses every authored preset rect independently of the bounded path rollout.
  const textRectangles = ir.shapes
    .filter((shape) => shape.textRectangle)
    .map(textRectangleDefinition);
  const serializedTextRectangles = stableJson(textRectangles).trimEnd();
  return `// Generated by scripts/ooxml-geometry/generate.mjs. Do not edit manually.
// Source: ECMA-376 DrawingML presetShapeDefinitions.xml (${sourceSha256})

export const OOXML_PRESET_GEOMETRY_SOURCE_SHA256 = '${sourceSha256}';

export const OOXML_PRESET_GEOMETRY_DEFINITIONS = ${serializedDefinitions} as const;

export const OOXML_PRESET_TEXT_RECTANGLE_DEFINITIONS = ${serializedTextRectangles} as const;
`;
}

export function buildGeometryIrContract(ir) {
  const structuralBytes = stableJson({ schemaVersion: ir.schemaVersion, shapes: ir.shapes });
  const profiles = evaluationProfiles.map((profile) => {
    for (const shape of ir.shapes) {
      evaluatePresetShape(shape, profile);
    }
    return { ...profile, evaluatedShapes: ir.shapes.length };
  });
  return {
    schemaVersion: ir.schemaVersion,
    structuralSha256: createHash('sha256').update(structuralBytes).digest('hex'),
    summary: summarizePresetGeometryIr(ir),
    evaluationProfiles: profiles,
  };
}

export function buildPathEmissionContract(ir) {
  const precision = 6;
  const profiles = evaluationProfiles.map((profile) => {
    const emittedShapes = ir.shapes.map((shape) =>
      emitPresetShapePaths(evaluatePresetShape(shape, profile), { precision }),
    );
    const summaries = emittedShapes.map((shape) => summarizeEmittedPresetShape(shape));
    const emittedPaths = summaries.reduce((total, summary) => total + summary.paths, 0);
    const nonEmptyPaths = summaries.reduce((total, summary) => total + summary.nonEmptyPaths, 0);
    if (nonEmptyPaths !== emittedPaths) {
      throw new Error(
        `OOXML path emission produced ${emittedPaths - nonEmptyPaths} empty paths for ${profile.name}`,
      );
    }
    return {
      ...profile,
      emittedShapes: emittedShapes.length,
      emittedPaths,
      nonEmptyPaths,
      nonFiniteTokens: summaries.reduce((total, summary) => total + summary.nonFiniteTokens, 0),
      sha256: createHash('sha256').update(stableJson(emittedShapes)).digest('hex'),
    };
  });
  return { schemaVersion: 1, precision, profiles };
}

function parseArguments(arguments_) {
  const options = {
    check: false,
    output: defaultOutput,
    runtimeOutput: defaultRuntimeOutput,
    repositoryRoot: defaultRepositoryRoot,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--check') {
      options.check = true;
      continue;
    }
    if (argument === '--output') {
      const value = arguments_[index + 1];
      if (!value) throw new Error('--output requires a path');
      options.output = value;
      index += 1;
      continue;
    }
    if (argument === '--root') {
      const value = arguments_[index + 1];
      if (!value) throw new Error('--root requires a path');
      options.repositoryRoot = resolve(value);
      index += 1;
      continue;
    }
    if (argument === '--runtime-output') {
      const value = arguments_[index + 1];
      if (!value) throw new Error('--runtime-output requires a path');
      options.runtimeOutput = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

export async function generatePresetShapeCatalog({
  check = false,
  output = defaultOutput,
  runtimeOutput = defaultRuntimeOutput,
  repositoryRoot = defaultRepositoryRoot,
} = {}) {
  const manifestPath = resolve(repositoryRoot, 'scripts/ooxml-geometry/source-manifest.json');
  const reconciliationPath = resolve(
    repositoryRoot,
    'scripts/ooxml-geometry/source-reconciliation.json',
  );
  const manifest = await readJson(manifestPath);
  const reconciliation = await readJson(reconciliationPath);
  const source = await loadPinnedPresetShapeDefinitions(repositoryRoot, manifest);
  const sourceCatalog = buildPresetShapeCatalog(source.xml, manifest, reconciliation);
  const geometryIr = compilePresetShapeDefinitions(source.xml, manifest, reconciliation);
  const catalog = {
    ...sourceCatalog,
    geometryIr: buildGeometryIrContract(geometryIr),
    pathEmission: buildPathEmissionContract(geometryIr),
  };
  const generated = stableJson(catalog);
  const outputPath = isAbsolute(output) ? output : resolve(repositoryRoot, output);
  const persisted = await writeOrCheckGeneratedCatalog({ check, generated, outputPath });
  const runtimeGenerated = buildRuntimeGeometryModule(geometryIr);
  const runtimeOutputPath = isAbsolute(runtimeOutput)
    ? runtimeOutput
    : resolve(repositoryRoot, runtimeOutput);
  const runtimePersisted = await writeOrCheckGeneratedCatalog({
    artifactLabel: 'OOXML geometry runtime subset',
    check,
    generated: runtimeGenerated,
    outputPath: runtimeOutputPath,
  });
  return { catalog, ...persisted, runtimeOutputPath, runtimeStatus: runtimePersisted.status };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await generatePresetShapeCatalog(options);
  const summary = result.catalog.summary;
  console.log(
    `${result.status}: ${result.outputPath} (${summary.uniqueShapes} shapes, ${summary.guideFormulas} formulas, ${summary.paths} paths)`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
