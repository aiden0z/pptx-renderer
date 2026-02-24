import { describe, expect, it } from 'vitest';
import { parseTheme } from '../../../src/model/Theme';
import { parseXml, SafeXmlNode } from '../../../src/parser/XmlParser';

function makeThemeXml(opts: {
  colors?: Record<string, { type: 'srgb' | 'sys'; val: string; lastClr?: string }>;
  majorFont?: { latin?: string; ea?: string; cs?: string };
  minorFont?: { latin?: string; ea?: string; cs?: string };
  fillStyles?: number;
  lineStyles?: number;
} = {}) {
  const colors = opts.colors ?? {
    dk1: { type: 'sys', val: 'windowText', lastClr: '000000' },
    lt1: { type: 'sys', val: 'window', lastClr: 'FFFFFF' },
    dk2: { type: 'srgb', val: '44546A' },
    lt2: { type: 'srgb', val: 'E7E6E6' },
    accent1: { type: 'srgb', val: '4472C4' },
    accent2: { type: 'srgb', val: 'ED7D31' },
    accent3: { type: 'srgb', val: 'A5A5A5' },
    accent4: { type: 'srgb', val: 'FFC000' },
    accent5: { type: 'srgb', val: '5B9BD5' },
    accent6: { type: 'srgb', val: '70AD47' },
    hlink: { type: 'srgb', val: '0563C1' },
    folHlink: { type: 'srgb', val: '954F72' },
  };

  const colorNodes = Object.entries(colors).map(([slot, def]) => {
    if (def.type === 'srgb') return `<${slot}><srgbClr val="${def.val}"/></${slot}>`;
    return `<${slot}><sysClr val="${def.val}"${def.lastClr ? ` lastClr="${def.lastClr}"` : ''}/></${slot}>`;
  }).join('\n');

  const mf = opts.majorFont ?? { latin: 'Calibri Light', ea: '', cs: '' };
  const nf = opts.minorFont ?? { latin: 'Calibri', ea: '', cs: '' };

  const fillCount = opts.fillStyles ?? 1;
  const lineCount = opts.lineStyles ?? 1;
  const fills = Array.from({ length: fillCount }, () => '<solidFill><srgbClr val="FFFFFF"/></solidFill>').join('');
  const lines = Array.from({ length: lineCount }, () => '<ln w="12700"><solidFill><srgbClr val="000000"/></solidFill></ln>').join('');

  return parseXml(`
    <theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <themeElements>
        <clrScheme name="Office">${colorNodes}</clrScheme>
        <fontScheme name="Office">
          <majorFont>
            <latin typeface="${mf.latin}"/>
            <ea typeface="${mf.ea ?? ''}"/>
            <cs typeface="${mf.cs ?? ''}"/>
          </majorFont>
          <minorFont>
            <latin typeface="${nf.latin}"/>
            <ea typeface="${nf.ea ?? ''}"/>
            <cs typeface="${nf.cs ?? ''}"/>
          </minorFont>
        </fontScheme>
        <fmtScheme name="Office">
          <fillStyleLst>${fills}</fillStyleLst>
          <lnStyleLst>${lines}</lnStyleLst>
          <effectStyleLst/>
        </fmtScheme>
      </themeElements>
    </theme>
  `);
}

describe('parseTheme', () => {
  it('parses all 12 color slots', () => {
    const theme = parseTheme(makeThemeXml());
    expect(theme.colorScheme.size).toBe(12);
    expect(theme.colorScheme.get('dk1')).toBe('000000');
    expect(theme.colorScheme.get('lt1')).toBe('FFFFFF');
    expect(theme.colorScheme.get('accent1')).toBe('4472C4');
    expect(theme.colorScheme.get('hlink')).toBe('0563C1');
    expect(theme.colorScheme.get('folHlink')).toBe('954F72');
  });

  it('handles srgbClr colors', () => {
    const theme = parseTheme(makeThemeXml({
      colors: { accent1: { type: 'srgb', val: 'FF0000' } },
    }));
    expect(theme.colorScheme.get('accent1')).toBe('FF0000');
  });

  it('handles sysClr colors with lastClr', () => {
    const theme = parseTheme(makeThemeXml({
      colors: { dk1: { type: 'sys', val: 'windowText', lastClr: '123456' } },
    }));
    expect(theme.colorScheme.get('dk1')).toBe('123456');
  });

  it('handles sysClr without lastClr, falls back to val', () => {
    const theme = parseTheme(makeThemeXml({
      colors: { dk1: { type: 'sys', val: 'AABBCC' } },
    }));
    expect(theme.colorScheme.get('dk1')).toBe('AABBCC');
  });

  it('parses major and minor fonts', () => {
    const theme = parseTheme(makeThemeXml({
      majorFont: { latin: 'Arial', ea: 'SimHei', cs: 'Times New Roman' },
      minorFont: { latin: 'Verdana', ea: 'SimSun', cs: 'Courier' },
    }));
    expect(theme.majorFont).toEqual({ latin: 'Arial', ea: 'SimHei', cs: 'Times New Roman' });
    expect(theme.minorFont).toEqual({ latin: 'Verdana', ea: 'SimSun', cs: 'Courier' });
  });

  it('parses fill styles', () => {
    const theme = parseTheme(makeThemeXml({ fillStyles: 3 }));
    expect(theme.fillStyles).toHaveLength(3);
    expect(theme.fillStyles[0].exists()).toBe(true);
  });

  it('parses line styles', () => {
    const theme = parseTheme(makeThemeXml({ lineStyles: 2 }));
    expect(theme.lineStyles).toHaveLength(2);
  });

  it('handles empty effect style list', () => {
    const theme = parseTheme(makeThemeXml());
    expect(theme.effectStyles).toHaveLength(0);
  });

  it('handles empty/missing theme elements gracefully', () => {
    const xml = parseXml('<theme><themeElements/></theme>');
    const theme = parseTheme(xml);
    expect(theme.colorScheme.size).toBe(0);
    expect(theme.majorFont.latin).toBe('');
    expect(theme.fillStyles).toHaveLength(0);
  });
});
