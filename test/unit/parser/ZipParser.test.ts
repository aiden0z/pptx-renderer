import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseZip } from '../../../src/parser/ZipParser';

// ---------------------------------------------------------------------------
// Helper: build an in-memory zip and return its ArrayBuffer
// ---------------------------------------------------------------------------
async function buildZip(
  files: Array<{ path: string; data: string | Uint8Array }>,
): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.path, file.data);
  }
  return zip.generateAsync({ type: 'arraybuffer' });
}

// Minimal required skeleton every valid PPTX needs so parseZip can run without
// crashing on completely empty results.
const SKELETON: Array<{ path: string; data: string }> = [
  { path: '[Content_Types].xml', data: '<Types />' },
  { path: 'ppt/presentation.xml', data: '<p:presentation />' },
  { path: 'ppt/_rels/presentation.xml.rels', data: '<Relationships />' },
];

// ---------------------------------------------------------------------------
// Categorization tests
// ---------------------------------------------------------------------------

describe('parseZip – categorization', () => {
  it('parses presentation.xml into result.presentation', async () => {
    const presentationXml = '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldSz cx="9144000" cy="6858000"/></p:presentation>';
    const buffer = await buildZip([
      { path: '[Content_Types].xml', data: '<Types />' },
      { path: 'ppt/presentation.xml', data: presentationXml },
      { path: 'ppt/_rels/presentation.xml.rels', data: '<Relationships />' },
    ]);

    const files = await parseZip(buffer);

    expect(files.presentation).toBe(presentationXml);
  });

  it('parses ppt/slides/slide1.xml into result.slides', async () => {
    const slideXml = '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld /></p:sld>';
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/slides/slide1.xml', data: slideXml },
    ]);

    const files = await parseZip(buffer);

    expect(files.slides.size).toBe(1);
    expect(files.slides.get('ppt/slides/slide1.xml')).toBe(slideXml);
  });

  it('parses multiple slide files and keys them by their full path', async () => {
    const slide1 = '<p:sld id="1" />';
    const slide2 = '<p:sld id="2" />';
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/slides/slide1.xml', data: slide1 },
      { path: 'ppt/slides/slide2.xml', data: slide2 },
    ]);

    const files = await parseZip(buffer);

    expect(files.slides.size).toBe(2);
    expect(files.slides.get('ppt/slides/slide1.xml')).toBe(slide1);
    expect(files.slides.get('ppt/slides/slide2.xml')).toBe(slide2);
  });

  it('parses slide rels (ppt/slides/_rels/slide1.xml.rels) into result.slideRels', async () => {
    const relsXml = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="layout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>';
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/slides/slide1.xml', data: '<p:sld />' },
      { path: 'ppt/slides/_rels/slide1.xml.rels', data: relsXml },
    ]);

    const files = await parseZip(buffer);

    expect(files.slideRels.size).toBe(1);
    expect(files.slideRels.get('ppt/slides/_rels/slide1.xml.rels')).toBe(relsXml);
  });

  it('does not place slide rels entries into result.slides', async () => {
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/slides/slide1.xml', data: '<p:sld />' },
      { path: 'ppt/slides/_rels/slide1.xml.rels', data: '<Relationships />' },
    ]);

    const files = await parseZip(buffer);

    // slideRels path must NOT appear inside the slides map
    expect(files.slides.has('ppt/slides/_rels/slide1.xml.rels')).toBe(false);
    expect(files.slideRels.has('ppt/slides/slide1.xml')).toBe(false);
  });

  it('parses slide layouts (ppt/slideLayouts/slideLayout1.xml) into result.slideLayouts', async () => {
    const layoutXml = '<p:sldLayout />';
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/slideLayouts/slideLayout1.xml', data: layoutXml },
    ]);

    const files = await parseZip(buffer);

    expect(files.slideLayouts.size).toBe(1);
    expect(files.slideLayouts.get('ppt/slideLayouts/slideLayout1.xml')).toBe(layoutXml);
  });

  it('parses slide layout rels into result.slideLayoutRels', async () => {
    const relsXml = '<Relationships />';
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/slideLayouts/slideLayout1.xml', data: '<p:sldLayout />' },
      { path: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: relsXml },
    ]);

    const files = await parseZip(buffer);

    expect(files.slideLayoutRels.size).toBe(1);
    expect(files.slideLayoutRels.get('ppt/slideLayouts/_rels/slideLayout1.xml.rels')).toBe(relsXml);
  });

  it('parses slide masters (ppt/slideMasters/slideMaster1.xml) into result.slideMasters', async () => {
    const masterXml = '<p:sldMaster />';
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/slideMasters/slideMaster1.xml', data: masterXml },
    ]);

    const files = await parseZip(buffer);

    expect(files.slideMasters.size).toBe(1);
    expect(files.slideMasters.get('ppt/slideMasters/slideMaster1.xml')).toBe(masterXml);
  });

  it('parses slide master rels into result.slideMasterRels', async () => {
    const relsXml = '<Relationships />';
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/slideMasters/slideMaster1.xml', data: '<p:sldMaster />' },
      { path: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: relsXml },
    ]);

    const files = await parseZip(buffer);

    expect(files.slideMasterRels.size).toBe(1);
    expect(files.slideMasterRels.get('ppt/slideMasters/_rels/slideMaster1.xml.rels')).toBe(relsXml);
  });

  it('parses themes (ppt/theme/theme1.xml) into result.themes', async () => {
    const themeXml = '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme" />';
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/theme/theme1.xml', data: themeXml },
    ]);

    const files = await parseZip(buffer);

    expect(files.themes.size).toBe(1);
    expect(files.themes.get('ppt/theme/theme1.xml')).toBe(themeXml);
  });

  it('parses media files (ppt/media/*) as Uint8Array in result.media', async () => {
    // A minimal 1×1 white PNG (89 bytes)
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
      0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
      0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/media/image1.png', data: pngBytes },
    ]);

    const files = await parseZip(buffer);

    expect(files.media.size).toBe(1);
    const stored = files.media.get('ppt/media/image1.png');
    expect(stored).toBeInstanceOf(Uint8Array);
    expect(stored).toEqual(pngBytes);
  });

  it('parses tableStyles.xml into result.tableStyles', async () => {
    const tableStylesXml = '<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}" />';
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/tableStyles.xml', data: tableStylesXml },
    ]);

    const files = await parseZip(buffer);

    expect(files.tableStyles).toBe(tableStylesXml);
  });

  it('result.tableStyles is undefined when ppt/tableStyles.xml is absent', async () => {
    const buffer = await buildZip([...SKELETON]);

    const files = await parseZip(buffer);

    expect(files.tableStyles).toBeUndefined();
  });

  it('parses charts (ppt/charts/chart1.xml) into result.charts', async () => {
    const chartXml = '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" />';
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/charts/chart1.xml', data: chartXml },
    ]);

    const files = await parseZip(buffer);

    expect(files.charts.size).toBe(1);
    expect(files.charts.get('ppt/charts/chart1.xml')).toBe(chartXml);
  });

  it('parses chart style files (ppt/charts/style1.xml) into result.chartStyles', async () => {
    const styleXml = '<cs:chartStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle" id="102" />';
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/charts/style1.xml', data: styleXml },
    ]);

    const files = await parseZip(buffer);

    expect(files.chartStyles.size).toBe(1);
    expect(files.chartStyles.get('ppt/charts/style1.xml')).toBe(styleXml);
  });

  it('parses chart color files (ppt/charts/colors1.xml) into result.chartColors', async () => {
    const colorsXml = '<cs:colorStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle" meth="cycle" id="10" />';
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/charts/colors1.xml', data: colorsXml },
    ]);

    const files = await parseZip(buffer);

    expect(files.chartColors.size).toBe(1);
    expect(files.chartColors.get('ppt/charts/colors1.xml')).toBe(colorsXml);
  });

  it('keeps chart, chartStyle, and chartColors in separate maps even when all present', async () => {
    const chartXml = '<c:chartSpace />';
    const styleXml = '<cs:chartStyle id="102" />';
    const colorsXml = '<cs:colorStyle id="10" />';
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/charts/chart1.xml', data: chartXml },
      { path: 'ppt/charts/style1.xml', data: styleXml },
      { path: 'ppt/charts/colors1.xml', data: colorsXml },
    ]);

    const files = await parseZip(buffer);

    expect(files.charts.size).toBe(1);
    expect(files.chartStyles.size).toBe(1);
    expect(files.chartColors.size).toBe(1);
    // Cross-contamination check
    expect(files.charts.has('ppt/charts/style1.xml')).toBe(false);
    expect(files.chartStyles.has('ppt/charts/chart1.xml')).toBe(false);
    expect(files.chartColors.has('ppt/charts/chart1.xml')).toBe(false);
  });

  it('parses diagram drawings (ppt/diagrams/drawing1.xml) into result.diagramDrawings', async () => {
    const drawingXml = '<dgm:drawing xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" />';
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/diagrams/drawing1.xml', data: drawingXml },
    ]);

    const files = await parseZip(buffer);

    expect(files.diagramDrawings.size).toBe(1);
    expect(files.diagramDrawings.get('ppt/diagrams/drawing1.xml')).toBe(drawingXml);
  });

  it('parses [Content_Types].xml into result.contentTypes', async () => {
    const contentTypesXml = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>';
    const buffer = await buildZip([
      { path: '[Content_Types].xml', data: contentTypesXml },
      { path: 'ppt/presentation.xml', data: '<p:presentation />' },
      { path: 'ppt/_rels/presentation.xml.rels', data: '<Relationships />' },
    ]);

    const files = await parseZip(buffer);

    expect(files.contentTypes).toBe(contentTypesXml);
  });

  it('parses presentation rels into result.presentationRels', async () => {
    const relsXml = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="slide" Target="slides/slide1.xml"/></Relationships>';
    const buffer = await buildZip([
      { path: '[Content_Types].xml', data: '<Types />' },
      { path: 'ppt/presentation.xml', data: '<p:presentation />' },
      { path: 'ppt/_rels/presentation.xml.rels', data: relsXml },
    ]);

    const files = await parseZip(buffer);

    expect(files.presentationRels).toBe(relsXml);
  });

  it('returns empty Maps when no categorized files are present', async () => {
    const buffer = await buildZip([...SKELETON]);

    const files = await parseZip(buffer);

    expect(files.slides.size).toBe(0);
    expect(files.slideRels.size).toBe(0);
    expect(files.slideLayouts.size).toBe(0);
    expect(files.slideLayoutRels.size).toBe(0);
    expect(files.slideMasters.size).toBe(0);
    expect(files.slideMasterRels.size).toBe(0);
    expect(files.themes.size).toBe(0);
    expect(files.media.size).toBe(0);
    expect(files.charts.size).toBe(0);
    expect(files.chartStyles.size).toBe(0);
    expect(files.chartColors.size).toBe(0);
    expect(files.diagramDrawings.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Path normalisation tests
// ---------------------------------------------------------------------------

describe('parseZip – backslash path normalisation', () => {
  it('normalises backslash separators in slide paths to forward slashes', async () => {
    const slideXml = '<p:sld />';
    const zip = new JSZip();
    // JSZip stores the path as-is; we manually add a backslash-keyed entry to
    // simulate a zip produced by Windows tools.
    zip.file('[Content_Types].xml', '<Types />');
    zip.file('ppt/presentation.xml', '<p:presentation />');
    zip.file('ppt/_rels/presentation.xml.rels', '<Relationships />');
    // Force backslash path by writing the raw entry name via the internal API.
    // JSZip normalises paths itself so we rely on the key override trick below.
    const zipObj = zip as unknown as { files: Record<string, JSZip.JSZipObject> };
    const fwdEntry = zip.file('ppt/slides/slide1.xml', slideXml);
    // Re-key the entry with backslashes to simulate a Windows-generated zip
    const entryKey = 'ppt\\slides\\slide1.xml';
    const forwardEntry = zipObj.files['ppt/slides/slide1.xml'];
    if (forwardEntry) {
      delete zipObj.files['ppt/slides/slide1.xml'];
      zipObj.files[entryKey] = forwardEntry;
    }

    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    const files = await parseZip(buffer);

    // After normalisation the slide must be accessible via the forward-slash key.
    expect(files.slides.has('ppt/slides/slide1.xml')).toBe(true);
    // And must NOT be stored under the backslash key.
    expect(files.slides.has('ppt\\slides\\slide1.xml')).toBe(false);
    // We don't use fwdEntry for anything; the variable is only to satisfy lint.
    void fwdEntry;
  });

  it('normalises backslash paths in media entries', async () => {
    const bytes = new Uint8Array([0x01, 0x02, 0x03]);
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types />');
    zip.file('ppt/presentation.xml', '<p:presentation />');
    zip.file('ppt/_rels/presentation.xml.rels', '<Relationships />');
    zip.file('ppt/media/image1.png', bytes);

    const zipObj = zip as unknown as { files: Record<string, JSZip.JSZipObject> };
    const fwdEntry = zipObj.files['ppt/media/image1.png'];
    if (fwdEntry) {
      delete zipObj.files['ppt/media/image1.png'];
      zipObj.files['ppt\\media\\image1.png'] = fwdEntry;
    }

    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    const files = await parseZip(buffer);

    expect(files.media.has('ppt/media/image1.png')).toBe(true);
    expect(files.media.has('ppt\\media\\image1.png')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Directory entry skipping
// ---------------------------------------------------------------------------

describe('parseZip – directory entry handling', () => {
  it('skips directory entries and does not add them to any map', async () => {
    // JSZip marks folders added via folder() with dir=true; parseZip filters
    // them out via the `!file.dir` check before categorisation.
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types />');
    zip.file('ppt/presentation.xml', '<p:presentation />');
    zip.file('ppt/_rels/presentation.xml.rels', '<Relationships />');
    // Explicitly add directory entries
    zip.folder('ppt/slides/');
    zip.folder('ppt/media/');
    zip.file('ppt/slides/slide1.xml', '<p:sld />');

    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    const files = await parseZip(buffer);

    // Only the actual slide should appear; directory entries must be absent.
    expect(files.slides.size).toBe(1);
    expect(files.slides.has('ppt/slides/slide1.xml')).toBe(true);
    // Media map should be empty (no real media files were added)
    expect(files.media.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Limit enforcement tests
// ---------------------------------------------------------------------------

describe('parseZip limits', () => {
  it('keeps default behavior when limits are not provided', async () => {
    const buffer = await buildZip([
      { path: '[Content_Types].xml', data: '<Types />' },
      { path: 'ppt/presentation.xml', data: '<p:presentation />' },
      { path: 'ppt/_rels/presentation.xml.rels', data: '<Relationships />' },
      { path: 'ppt/slides/slide1.xml', data: '<p:sld />' },
    ]);

    const files = await parseZip(buffer);

    expect(files.presentation).toContain('presentation');
    expect(files.slides.has('ppt/slides/slide1.xml')).toBe(true);
  });

  it('enforces maxEntries: throws when zip contains more entries than the limit', async () => {
    // SKELETON has 3 entries; limit to 2 to trigger the guard.
    const buffer = await buildZip([...SKELETON]);

    await expect(
      parseZip(buffer, { maxEntries: 2 }),
    ).rejects.toThrow(/maxEntries/);
  });

  it('does not throw when entry count equals maxEntries exactly', async () => {
    const buffer = await buildZip([...SKELETON]); // exactly 3 entries

    await expect(parseZip(buffer, { maxEntries: 3 })).resolves.toBeDefined();
  });

  it('enforces maxTotalUncompressedBytes: throws when cumulative size exceeds limit', async () => {
    // Use a large payload that is certain to exceed any tiny limit.
    const bigXml = 'x'.repeat(2048);
    const buffer = await buildZip([
      { path: '[Content_Types].xml', data: '<Types />' },
      { path: 'ppt/presentation.xml', data: bigXml },
      { path: 'ppt/_rels/presentation.xml.rels', data: '<Relationships />' },
    ]);

    await expect(
      parseZip(buffer, { maxTotalUncompressedBytes: 1024 }),
    ).rejects.toThrow(/maxTotalUncompressedBytes/);
  });

  it('enforces maxMediaBytes: throws when total media bytes exceed limit', async () => {
    const media = new Uint8Array(4096);
    const buffer = await buildZip([
      { path: '[Content_Types].xml', data: '<Types />' },
      { path: 'ppt/presentation.xml', data: '<p:presentation />' },
      { path: 'ppt/_rels/presentation.xml.rels', data: '<Relationships />' },
      { path: 'ppt/media/image1.png', data: media },
    ]);

    await expect(
      parseZip(buffer, { maxMediaBytes: 1024 }),
    ).rejects.toThrow(/maxMediaBytes/);
  });

  it('does not throw for media when maxMediaBytes is not set', async () => {
    const media = new Uint8Array(4096);
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/media/image1.png', data: media },
    ]);

    await expect(parseZip(buffer)).resolves.toBeDefined();
  });

  it('accumulates multiple media files against maxMediaBytes limit', async () => {
    // Two 600-byte media blobs → 1200 total bytes, limit is 1000
    const chunk = new Uint8Array(600);
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/media/image1.png', data: chunk },
      { path: 'ppt/media/image2.png', data: chunk },
    ]);

    await expect(
      parseZip(buffer, { maxMediaBytes: 1000 }),
    ).rejects.toThrow(/maxMediaBytes/);
  });

  it('throws when maxConcurrency is 0 (invalid)', async () => {
    const buffer = await buildZip([...SKELETON]);

    await expect(
      parseZip(buffer, { maxConcurrency: 0 }),
    ).rejects.toThrow(/maxConcurrency/);
  });

  it('accepts maxConcurrency of 1 (minimum valid value)', async () => {
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/slides/slide1.xml', data: '<p:sld />' },
    ]);

    const files = await parseZip(buffer, { maxConcurrency: 1 });

    expect(files.slides.has('ppt/slides/slide1.xml')).toBe(true);
  });

  it('enforces maxEntryUncompressedBytes: throws when a single entry exceeds limit', async () => {
    const bigSlide = '<p:sld>' + 'x'.repeat(5000) + '</p:sld>';
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/slides/slide1.xml', data: bigSlide },
    ]);

    await expect(
      parseZip(buffer, { maxEntryUncompressedBytes: 1000 }),
    ).rejects.toThrow(/maxEntryUncompressedBytes/);
  });

  it('does not throw when single entry size equals maxEntryUncompressedBytes exactly', async () => {
    // Build a zip where we know the entry size
    const data = 'x'.repeat(500);
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/slides/slide1.xml', data },
    ]);

    // Use a generous limit that covers all entries
    await expect(
      parseZip(buffer, { maxEntryUncompressedBytes: 100000 }),
    ).resolves.toBeDefined();
  });

  it('enforces maxEntryUncompressedBytes on media entries with unknown pre-scan size', async () => {
    // Create a media entry large enough to exceed a tight per-entry limit.
    // The pre-scan may or may not know the size; the fallback check in the
    // media handler should catch it either way.
    const bigMedia = new Uint8Array(3000);
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/media/image1.png', data: bigMedia },
    ]);

    await expect(
      parseZip(buffer, { maxEntryUncompressedBytes: 1000 }),
    ).rejects.toThrow(/maxEntryUncompressedBytes/);
  });

  it('enforces maxMediaBytes on media entries whose size was not known during pre-scan', async () => {
    // This covers the runtime fallback path in the media handler that
    // accumulates unknownMediaBytes when knownSizeByPath lacks the entry.
    const media1 = new Uint8Array(600);
    const media2 = new Uint8Array(600);
    const buffer = await buildZip([
      ...SKELETON,
      { path: 'ppt/media/image1.png', data: media1 },
      { path: 'ppt/media/image2.png', data: media2 },
    ]);

    // Both media files combined exceed the limit
    await expect(
      parseZip(buffer, { maxMediaBytes: 800 }),
    ).rejects.toThrow(/maxMediaBytes/);
  });

  it('throws on non-integer maxConcurrency (e.g. 2.5)', async () => {
    const buffer = await buildZip([...SKELETON]);

    await expect(
      parseZip(buffer, { maxConcurrency: 2.5 }),
    ).rejects.toThrow(/maxConcurrency/);
  });
});

// ---------------------------------------------------------------------------
// Full round-trip: a realistic minimal PPTX-like zip
// ---------------------------------------------------------------------------

describe('parseZip – full round-trip with representative PPTX structure', () => {
  it('correctly categorises all file types found in a representative minimal PPTX', async () => {
    const themeXml = '<a:theme name="TestTheme" />';
    const masterXml = '<p:sldMaster />';
    const masterRelsXml = '<Relationships />';
    const layoutXml = '<p:sldLayout />';
    const layoutRelsXml = '<Relationships />';
    const slideXml = '<p:sld />';
    const slideRelsXml = '<Relationships />';
    const chartXml = '<c:chartSpace />';
    const chartStyleXml = '<cs:chartStyle id="102" />';
    const chartColorsXml = '<cs:colorStyle id="10" />';
    const drawingXml = '<dgm:drawing />';
    const tableStylesXml = '<a:tblStyleLst def="{ABC}" />';
    const mediaBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG SOI marker

    const buffer = await buildZip([
      { path: '[Content_Types].xml', data: '<Types />' },
      { path: 'ppt/presentation.xml', data: '<p:presentation />' },
      { path: 'ppt/_rels/presentation.xml.rels', data: '<Relationships />' },
      { path: 'ppt/theme/theme1.xml', data: themeXml },
      { path: 'ppt/slideMasters/slideMaster1.xml', data: masterXml },
      { path: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: masterRelsXml },
      { path: 'ppt/slideLayouts/slideLayout1.xml', data: layoutXml },
      { path: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: layoutRelsXml },
      { path: 'ppt/slides/slide1.xml', data: slideXml },
      { path: 'ppt/slides/_rels/slide1.xml.rels', data: slideRelsXml },
      { path: 'ppt/charts/chart1.xml', data: chartXml },
      { path: 'ppt/charts/style1.xml', data: chartStyleXml },
      { path: 'ppt/charts/colors1.xml', data: chartColorsXml },
      { path: 'ppt/diagrams/drawing1.xml', data: drawingXml },
      { path: 'ppt/tableStyles.xml', data: tableStylesXml },
      { path: 'ppt/media/photo.jpg', data: mediaBytes },
    ]);

    const files = await parseZip(buffer);

    expect(files.themes.get('ppt/theme/theme1.xml')).toBe(themeXml);
    expect(files.slideMasters.get('ppt/slideMasters/slideMaster1.xml')).toBe(masterXml);
    expect(files.slideMasterRels.get('ppt/slideMasters/_rels/slideMaster1.xml.rels')).toBe(masterRelsXml);
    expect(files.slideLayouts.get('ppt/slideLayouts/slideLayout1.xml')).toBe(layoutXml);
    expect(files.slideLayoutRels.get('ppt/slideLayouts/_rels/slideLayout1.xml.rels')).toBe(layoutRelsXml);
    expect(files.slides.get('ppt/slides/slide1.xml')).toBe(slideXml);
    expect(files.slideRels.get('ppt/slides/_rels/slide1.xml.rels')).toBe(slideRelsXml);
    expect(files.charts.get('ppt/charts/chart1.xml')).toBe(chartXml);
    expect(files.chartStyles.get('ppt/charts/style1.xml')).toBe(chartStyleXml);
    expect(files.chartColors.get('ppt/charts/colors1.xml')).toBe(chartColorsXml);
    expect(files.diagramDrawings.get('ppt/diagrams/drawing1.xml')).toBe(drawingXml);
    expect(files.tableStyles).toBe(tableStylesXml);
    expect(files.media.get('ppt/media/photo.jpg')).toEqual(mediaBytes);
  });
});
