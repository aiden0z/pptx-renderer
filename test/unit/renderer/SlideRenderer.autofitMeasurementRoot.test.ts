import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseShapeNode } from '../../../src/model/nodes/ShapeNode';
import type { PresentationData } from '../../../src/model/Presentation';
import type { SlideData } from '../../../src/model/Slide';
import { parseXml, SafeXmlNode } from '../../../src/parser/XmlParser';
import { renderSlide } from '../../../src/renderer/SlideRenderer';

const originalFontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
const emptyXml = new SafeXmlNode(null);

function makeMinimalPres(slide: SlideData): PresentationData {
  const layoutPath = 'ppt/slideLayouts/slideLayout1.xml';
  const masterPath = 'ppt/slideMasters/slideMaster1.xml';
  const themePath = 'ppt/theme/theme1.xml';

  return {
    width: 960,
    height: 540,
    slides: [slide],
    layouts: new Map([
      [
        layoutPath,
        {
          placeholders: [],
          spTree: emptyXml,
          rels: new Map(),
          showMasterSp: true,
        },
      ],
    ]),
    masters: new Map([
      [
        masterPath,
        {
          colorMap: new Map(),
          textStyles: {},
          placeholders: [],
          spTree: emptyXml,
          rels: new Map(),
        },
      ],
    ]),
    themes: new Map([
      [
        themePath,
        {
          colorScheme: new Map(),
          majorFont: { latin: 'Calibri', ea: '', cs: '' },
          minorFont: { latin: 'Calibri', ea: '', cs: '' },
          fillStyles: [],
          lineStyles: [],
          effectStyles: [],
        },
      ],
    ]),
    slideToLayout: new Map([[0, layoutPath]]),
    layoutToMaster: new Map([[layoutPath, masterPath]]),
    masterToTheme: new Map([[masterPath, themePath]]),
    media: new Map(),
    charts: new Map(),
    isWps: false,
  } as PresentationData;
}

function makeAutofitShape(id: string, x: number) {
  return parseShapeNode(
    parseXml(`
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="${id}" name="Autofit ${id}"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="${x}" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr>
          <a:lstStyle/>
          <a:p><a:r><a:rPr sz="1800"/><a:t>Autofit text ${id}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    `),
  );
}

describe('renderSlide dynamic autofit measurement root', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalFontsDescriptor) {
      Object.defineProperty(document, 'fonts', originalFontsDescriptor);
    } else {
      delete (document as Document & { fonts?: FontFaceSet }).fonts;
    }
  });

  it('uses one temporary slide-level body mount instead of per-shape body mounts', () => {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        status: 'loaded',
        ready: Promise.resolve(),
      },
    });
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const slide: SlideData = {
      index: 0,
      nodes: [makeAutofitShape('1', 0), makeAutofitShape('2', 914400)],
      rels: new Map(),
      showMasterSp: true,
    };
    const pres = makeMinimalPres(slide);

    const handle = renderSlide(pres, slide);

    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy.mock.calls[0][0]).toBe(handle.element);
    expect(handle.element.isConnected).toBe(false);
    handle.dispose();
    appendSpy.mockRestore();
  });
});
