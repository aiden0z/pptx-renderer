import { describe, expect, it } from 'vitest';
import {
  getPredefinedTableStyle,
  getAllPredefinedStyleIds,
  PREDEFINED_STYLE_COUNT,
} from '../../../src/renderer/predefinedTableStyles';

describe('predefinedTableStyles', () => {
  it('has exactly 74 predefined styles', () => {
    expect(PREDEFINED_STYLE_COUNT).toBe(74);
    expect(getAllPredefinedStyleIds()).toHaveLength(74);
  });

  it('returns undefined for unknown style IDs', () => {
    expect(getPredefinedTableStyle('{00000000-0000-0000-0000-000000000000}')).toBeUndefined();
    expect(getPredefinedTableStyle('')).toBeUndefined();
    expect(getPredefinedTableStyle('not-a-uuid')).toBeUndefined();
  });

  it('all 74 UUIDs return valid SafeXmlNode with correct styleId', () => {
    for (const id of getAllPredefinedStyleIds()) {
      const node = getPredefinedTableStyle(id);
      expect(node, `style ${id} should exist`).toBeDefined();
      expect(node!.exists(), `style ${id} should have valid node`).toBe(true);
      expect(node!.attr('styleId'), `style ${id} should have matching styleId attr`).toBe(id);
      expect(node!.localName).toBe('tblStyle');
    }
  });

  it('caches results — same UUID returns same instance', () => {
    const id = '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}';
    const first = getPredefinedTableStyle(id);
    const second = getPredefinedTableStyle(id);
    expect(first).toBe(second); // strict reference equality
  });

  describe('Medium-Style-2 + Accent6', () => {
    const id = '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}';
    const style = getPredefinedTableStyle(id)!;

    it('has styleName attribute', () => {
      expect(style.attr('styleName')).toBe('Medium-Style-2');
    });

    it('wholeTbl has dk1 text color', () => {
      const tcTxStyle = style.child('wholeTbl').child('tcTxStyle');
      expect(tcTxStyle.exists()).toBe(true);
      const schemeClr = tcTxStyle.child('schemeClr');
      expect(schemeClr.attr('val')).toBe('dk1');
    });

    it('wholeTbl has accent6 + tint(20000) fill', () => {
      const fill = style.child('wholeTbl').child('tcStyle').child('fill');
      expect(fill.exists()).toBe(true);
      const solidFill = fill.child('solidFill');
      expect(solidFill.exists()).toBe(true);
      const clr = solidFill.child('schemeClr');
      expect(clr.attr('val')).toBe('accent6');
      const tint = clr.child('tint');
      expect(tint.attr('val')).toBe('20000');
    });

    it('wholeTbl has lt1 borders on all 6 sides', () => {
      const tcBdr = style.child('wholeTbl').child('tcStyle').child('tcBdr');
      expect(tcBdr.exists()).toBe(true);
      for (const side of ['left', 'right', 'top', 'bottom', 'insideH', 'insideV']) {
        const ln = tcBdr.child(side).child('ln');
        expect(ln.exists(), `${side} border should exist`).toBe(true);
        const clr = ln.child('solidFill').child('schemeClr');
        expect(clr.attr('val'), `${side} border color should be lt1`).toBe('lt1');
      }
    });

    it('firstRow has lt1 text, accent6 fill, bottom border=lt1', () => {
      const firstRow = style.child('firstRow');
      expect(firstRow.exists()).toBe(true);

      const tcTxStyle = firstRow.child('tcTxStyle');
      expect(tcTxStyle.child('schemeClr').attr('val')).toBe('lt1');

      const fill = firstRow.child('tcStyle').child('fill').child('solidFill');
      expect(fill.child('schemeClr').attr('val')).toBe('accent6');

      const bottom = firstRow.child('tcStyle').child('tcBdr').child('bottom').child('ln');
      expect(bottom.child('solidFill').child('schemeClr').attr('val')).toBe('lt1');
    });

    it('band1H has accent6 + tint(40000) fill', () => {
      const fill = style.child('band1H').child('tcStyle').child('fill').child('solidFill');
      const clr = fill.child('schemeClr');
      expect(clr.attr('val')).toBe('accent6');
      expect(clr.child('tint').attr('val')).toBe('40000');
    });

    it('firstCol and lastCol have lt1 text and accent6 fill', () => {
      for (const part of ['firstCol', 'lastCol']) {
        const section = style.child(part);
        expect(section.exists(), `${part} should exist`).toBe(true);
        expect(section.child('tcTxStyle').child('schemeClr').attr('val')).toBe('lt1');
        expect(
          section.child('tcStyle').child('fill').child('solidFill').child('schemeClr').attr('val'),
        ).toBe('accent6');
      }
    });
  });

  describe('Dark-Style-1 with accent uses shade transforms', () => {
    const id = '{125E5076-3810-47DD-B79F-674D7AD40C01}'; // Dark-Style-1 + Accent1
    const style = getPredefinedTableStyle(id)!;

    it('wholeTbl fill has shade(20000)', () => {
      const clr = style
        .child('wholeTbl')
        .child('tcStyle')
        .child('fill')
        .child('solidFill')
        .child('schemeClr');
      expect(clr.attr('val')).toBe('accent1');
      expect(clr.child('shade').attr('val')).toBe('20000');
    });

    it('band1H fill has shade(40000)', () => {
      const clr = style
        .child('band1H')
        .child('tcStyle')
        .child('fill')
        .child('solidFill')
        .child('schemeClr');
      expect(clr.attr('val')).toBe('accent1');
      expect(clr.child('shade').attr('val')).toBe('40000');
    });

    it('firstCol/lastCol fill has shade(60000)', () => {
      for (const part of ['firstCol', 'lastCol']) {
        const clr = style
          .child(part)
          .child('tcStyle')
          .child('fill')
          .child('solidFill')
          .child('schemeClr');
        expect(clr.attr('val')).toBe('accent1');
        expect(clr.child('shade').attr('val')).toBe('60000');
      }
    });
  });

  describe('Dark-Style-1 no-accent uses tint transforms', () => {
    const id = '{E8034E78-7F5D-4C2E-B375-FC64B27BC917}'; // Dark-Style-1 no accent
    const style = getPredefinedTableStyle(id)!;

    it('wholeTbl fill has dk1 + tint(20000)', () => {
      const clr = style
        .child('wholeTbl')
        .child('tcStyle')
        .child('fill')
        .child('solidFill')
        .child('schemeClr');
      expect(clr.attr('val')).toBe('dk1');
      expect(clr.child('tint').attr('val')).toBe('20000');
    });
  });

  describe('Dark-Style-2 accent-shift for firstRow', () => {
    it('accent1 → firstRow fill=accent2', () => {
      const style = getPredefinedTableStyle('{0660B408-B3CF-4A94-85FC-2B1E0A45F4A2}')!;
      const clr = style
        .child('firstRow')
        .child('tcStyle')
        .child('fill')
        .child('solidFill')
        .child('schemeClr');
      expect(clr.attr('val')).toBe('accent2');
    });

    it('accent3 → firstRow fill=accent4', () => {
      const style = getPredefinedTableStyle('{91EBBBCC-DAD2-459C-BE2E-F6DE35CF9A28}')!;
      const clr = style
        .child('firstRow')
        .child('tcStyle')
        .child('fill')
        .child('solidFill')
        .child('schemeClr');
      expect(clr.attr('val')).toBe('accent4');
    });

    it('accent5 → firstRow fill=accent6', () => {
      const style = getPredefinedTableStyle('{46F890A9-2807-4EBB-B81D-B2AA78EC7F39}')!;
      const clr = style
        .child('firstRow')
        .child('tcStyle')
        .child('fill')
        .child('solidFill')
        .child('schemeClr');
      expect(clr.attr('val')).toBe('accent6');
    });

    it('no accent → firstRow fill=dk1', () => {
      const style = getPredefinedTableStyle('{5202B0CA-FC54-4496-8BCA-5EF66A818D29}')!;
      const clr = style
        .child('firstRow')
        .child('tcStyle')
        .child('fill')
        .child('solidFill')
        .child('schemeClr');
      expect(clr.attr('val')).toBe('dk1');
    });
  });

  describe('Themed-Style-2 with accent has tblBg', () => {
    const id = '{D113A9D2-9D6B-4929-AA2D-F23B5EE8CBE7}'; // Themed-Style-2 + Accent1
    const style = getPredefinedTableStyle(id)!;

    it('has tblBg with accent1 fillRef', () => {
      const tblBg = style.child('tblBg');
      expect(tblBg.exists()).toBe(true);
      const fillRef = tblBg.child('fillRef');
      expect(fillRef.exists()).toBe(true);
      expect(fillRef.child('schemeClr').attr('val')).toBe('accent1');
    });

    it('wholeTbl text=lt1', () => {
      expect(style.child('wholeTbl').child('tcTxStyle').child('schemeClr').attr('val')).toBe('lt1');
    });

    it('band1H has lt1 + alpha(20000)', () => {
      const clr = style
        .child('band1H')
        .child('tcStyle')
        .child('fill')
        .child('solidFill')
        .child('schemeClr');
      expect(clr.attr('val')).toBe('lt1');
      expect(clr.child('alpha').attr('val')).toBe('20000');
    });
  });

  describe('Light-Style-1 has bold text on firstRow/firstCol/lastCol', () => {
    const id = '{3B4B98B0-60AC-42C2-AFA5-B58CD77FA1E5}'; // Light-Style-1 + Accent1
    const style = getPredefinedTableStyle(id)!;

    it('firstRow tcTxStyle has b="on"', () => {
      expect(style.child('firstRow').child('tcTxStyle').attr('b')).toBe('on');
    });

    it('firstCol tcTxStyle has b="on"', () => {
      expect(style.child('firstCol').child('tcTxStyle').attr('b')).toBe('on');
    });

    it('lastCol tcTxStyle has b="on"', () => {
      expect(style.child('lastCol').child('tcTxStyle').attr('b')).toBe('on');
    });
  });

  describe('style group coverage: each group generates valid XML', () => {
    const sampleIds: [string, string][] = [
      ['{2D5ABB26-0587-4C30-8999-92F81FD0307C}', 'Themed-Style-1 (no accent)'],
      ['{3C2FFA5D-87B4-456A-9821-1D502468CF0F}', 'Themed-Style-1 + Accent1'],
      ['{5940675A-B579-460E-94D1-54222C63F5DA}', 'Themed-Style-2 (no accent)'],
      ['{D113A9D2-9D6B-4929-AA2D-F23B5EE8CBE7}', 'Themed-Style-2 + Accent1'],
      ['{9D7B26C5-4107-4FEC-AEDC-1716B250A1EF}', 'Light-Style-1 (no accent)'],
      ['{7E9639D4-E3E2-4D34-9284-5A2195B3D0D7}', 'Light-Style-2 (no accent)'],
      ['{616DA210-FB5B-4158-B5E0-FEB733F419BA}', 'Light-Style-3 (no accent)'],
      ['{793D81CF-94F2-401A-BA57-92F5A7B2D0C5}', 'Medium-Style-1 (no accent)'],
      ['{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}', 'Medium-Style-2 (no accent)'],
      ['{8EC20E35-A176-4012-BC5E-935CFFF8708E}', 'Medium-Style-3 (no accent)'],
      ['{D7AC3CCA-C797-4891-BE02-D94E43425B78}', 'Medium-Style-4 (no accent)'],
      ['{E8034E78-7F5D-4C2E-B375-FC64B27BC917}', 'Dark-Style-1 (no accent)'],
      ['{5202B0CA-FC54-4496-8BCA-5EF66A818D29}', 'Dark-Style-2 (no accent)'],
    ];

    for (const [id, name] of sampleIds) {
      it(`${name} generates valid tblStyle with wholeTbl`, () => {
        const style = getPredefinedTableStyle(id)!;
        expect(style.exists()).toBe(true);
        expect(style.localName).toBe('tblStyle');
        // All styles should have at least wholeTbl
        expect(style.child('wholeTbl').exists()).toBe(true);
      });
    }
  });
});
