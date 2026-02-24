import { describe, it, expect } from 'vitest';
import { parseEmfContent } from '../../../src/utils/emfParser';

// ---------------------------------------------------------------------------
// Helpers to build synthetic EMF binary data
// ---------------------------------------------------------------------------

/** Write a little-endian uint32 into a buffer. */
function writeU32(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >> 8) & 0xff;
  buf[offset + 2] = (value >> 16) & 0xff;
  buf[offset + 3] = (value >> 24) & 0xff;
}

/** Write a little-endian int32 into a buffer. */
function writeI32(buf: Uint8Array, offset: number, value: number): void {
  writeU32(buf, offset, value >>> 0);
}

/** Write a little-endian uint16 into a buffer. */
function writeU16(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >> 8) & 0xff;
}

const EMF_SIGNATURE = 0x464d4520;
const EMR_HEADER = 1;
const EMR_EOF = 14;
const EMR_COMMENT = 70;
const EMR_STRETCHDIBITS = 81;
const GDIC_ID = 0x43494447;
const MULTIFORMATS_TYPE = 0x40000004;
const BEGINGROUP_TYPE = 0x00000002;

/** Minimal PDF data for testing — just enough to be recognized. */
const MINI_PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF');

/**
 * Build a minimal EMF header record (type=1).
 * Only the signature at offset 40 matters for validation.
 */
function buildEmfHeader(headerSize = 108): Uint8Array {
  const buf = new Uint8Array(headerSize);
  writeU32(buf, 0, EMR_HEADER);    // type
  writeU32(buf, 4, headerSize);     // size
  writeU32(buf, 40, EMF_SIGNATURE); // signature " EMF"
  return buf;
}

/** Build an EMR_EOF record. */
function buildEofRecord(): Uint8Array {
  const buf = new Uint8Array(20);
  writeU32(buf, 0, EMR_EOF);
  writeU32(buf, 4, 20);
  return buf;
}

/**
 * Build a GDI Comment record with MULTIFORMATS containing embedded PDF.
 * Mirrors the structure observed in real-world EMF files:
 *   +0:  type(4) + size(4)
 *   +8:  cbData(4)
 *   +12: commentIdentifier = GDIC (4)
 *   +16: publicCommentIdentifier = 0x40000004 (4)
 *   +20: outputRect (16 = RECTL)
 *   +36: countFormats(4)
 *   +40: EmrFormat { signature(4), version(4), cbData(4), offData(4) }
 *   +56: [format data: 12 bytes preamble + PDF bytes]
 */
function buildMultiformatsPdfComment(pdfData: Uint8Array): Uint8Array {
  const preambleSize = 12; // preamble before %PDF in format data, as observed in real files
  const formatDataSize = preambleSize + pdfData.length;
  const offData = 56; // offset from record start to format data area

  // Record: header(8) + cbData(4) + commentId(4) + publicType(4) + outputRect(16) + countFormats(4) + descriptor(16) + formatData
  const recordSize = offData + formatDataSize;
  // Pad to 4-byte boundary
  const paddedSize = Math.ceil(recordSize / 4) * 4;
  const buf = new Uint8Array(paddedSize);

  writeU32(buf, 0, EMR_COMMENT);         // type
  writeU32(buf, 4, paddedSize);           // size
  writeU32(buf, 8, paddedSize - 8);       // cbData
  writeU32(buf, 12, GDIC_ID);            // commentIdentifier
  writeU32(buf, 16, MULTIFORMATS_TYPE);   // publicCommentIdentifier
  // outputRect at +20..+35: leave as zeros
  writeU32(buf, 36, 1);                  // countFormats = 1

  // Format descriptor at +40
  writeU32(buf, 40, 0x50444620);          // signature = "PDF " (little-endian)
  writeU32(buf, 44, 1);                   // version
  writeU32(buf, 48, formatDataSize);      // cbData
  writeU32(buf, 52, offData);             // offData (relative to record start)

  // Format data at +56: preamble + PDF
  buf.set(pdfData, offData + preambleSize);

  return buf;
}

/**
 * Build a GDI Comment record with BEGINGROUP containing embedded PDF.
 */
function buildBegingroupPdfComment(pdfData: Uint8Array): Uint8Array {
  // Simpler structure: just embed PDF somewhere in the record data
  const dataStart = 20; // 8 (header) + 4 (cbData) + 4 (commentId) + 4 (publicType)
  const recordSize = Math.ceil((dataStart + pdfData.length) / 4) * 4;
  const buf = new Uint8Array(recordSize);

  writeU32(buf, 0, EMR_COMMENT);
  writeU32(buf, 4, recordSize);
  writeU32(buf, 8, recordSize - 8);
  writeU32(buf, 12, GDIC_ID);
  writeU32(buf, 16, BEGINGROUP_TYPE);
  buf.set(pdfData, dataStart);

  return buf;
}

/**
 * Build an EMR_COMMENT with raw (non-GDIC) PDF data — tests the brute-force fallback.
 */
function buildRawPdfComment(pdfData: Uint8Array): Uint8Array {
  const dataStart = 12; // 8 (header) + 4 (cbData)
  const recordSize = Math.ceil((dataStart + pdfData.length) / 4) * 4;
  const buf = new Uint8Array(recordSize);

  writeU32(buf, 0, EMR_COMMENT);
  writeU32(buf, 4, recordSize);
  writeU32(buf, 8, recordSize - 8);
  // commentIdentifier is just the first 4 bytes of data — NOT GDIC
  buf.set(pdfData, dataStart);

  return buf;
}

/**
 * Build an EMR_STRETCHDIBITS record with a small uncompressed 24-bit bitmap.
 */
function buildStretchDibitsRecord(width: number, height: number, bpp: 24 | 32): Uint8Array {
  const bytesPerPixel = bpp / 8;
  const rowStride = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const bitmapDataSize = rowStride * height;
  const bmiSize = 40; // BITMAPINFOHEADER

  const offBmiSrc = 80; // standard offset after STRETCHDIBITS fields
  const offBitsSrc = offBmiSrc + bmiSize;
  const recordSize = offBitsSrc + bitmapDataSize;
  const paddedSize = Math.ceil(recordSize / 4) * 4;
  const buf = new Uint8Array(paddedSize);

  // EMR header
  writeU32(buf, 0, EMR_STRETCHDIBITS);
  writeU32(buf, 4, paddedSize);

  // STRETCHDIBITS fields
  writeU32(buf, 48, offBmiSrc);
  writeU32(buf, 52, bmiSize);
  writeU32(buf, 56, offBitsSrc);
  writeU32(buf, 60, bitmapDataSize);

  // BITMAPINFOHEADER at offBmiSrc
  writeU32(buf, offBmiSrc, 40);          // biSize
  writeI32(buf, offBmiSrc + 4, width);   // biWidth
  writeI32(buf, offBmiSrc + 8, height);  // biHeight (positive = bottom-up)
  writeU16(buf, offBmiSrc + 12, 1);      // biPlanes
  writeU16(buf, offBmiSrc + 14, bpp);    // biBitCount
  writeU32(buf, offBmiSrc + 16, 0);      // biCompression = BI_RGB

  // Bitmap pixel data: fill with a recognizable pattern
  // Row 0 (bottom in bottom-up): red, Row 1: green, etc.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = offBitsSrc + y * rowStride + x * bytesPerPixel;
      // BGR format
      buf[idx + 0] = (y * 50) & 0xff; // B
      buf[idx + 1] = (x * 50) & 0xff; // G
      buf[idx + 2] = 255;              // R
      if (bpp === 32) buf[idx + 3] = 200; // A
    }
  }

  return buf;
}

/** Concatenate multiple Uint8Arrays. */
function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseEmfContent', () => {
  describe('validation', () => {
    it('returns unsupported for data too small', () => {
      const result = parseEmfContent(new Uint8Array(10));
      expect(result.type).toBe('unsupported');
    });

    it('returns unsupported for invalid EMF signature', () => {
      const buf = new Uint8Array(100);
      writeU32(buf, 0, EMR_HEADER);
      writeU32(buf, 4, 80);
      writeU32(buf, 40, 0xdeadbeef); // wrong signature
      const result = parseEmfContent(buf);
      expect(result.type).toBe('unsupported');
    });
  });

  describe('empty EMF', () => {
    it('returns empty for header + EOF only', () => {
      const emf = concat(buildEmfHeader(), buildEofRecord());
      const result = parseEmfContent(emf);
      expect(result.type).toBe('empty');
    });
  });

  describe('PDF extraction via MULTIFORMATS', () => {
    it('extracts PDF from GDIC MULTIFORMATS comment record', () => {
      const comment = buildMultiformatsPdfComment(MINI_PDF);
      const emf = concat(buildEmfHeader(), comment, buildEofRecord());

      const result = parseEmfContent(emf);
      expect(result.type).toBe('pdf');
      if (result.type === 'pdf') {
        const text = new TextDecoder().decode(result.data);
        expect(text).toContain('%PDF-1.4');
        expect(text).toContain('%%EOF');
      }
    });

    it('extracts complete PDF data (no truncation)', () => {
      const comment = buildMultiformatsPdfComment(MINI_PDF);
      const emf = concat(buildEmfHeader(), comment, buildEofRecord());

      const result = parseEmfContent(emf);
      expect(result.type).toBe('pdf');
      if (result.type === 'pdf') {
        const text = new TextDecoder().decode(result.data);
        // Should start exactly at %PDF and end at %%EOF
        expect(text.startsWith('%PDF')).toBe(true);
        expect(text.endsWith('%%EOF')).toBe(true);
      }
    });
  });

  describe('PDF extraction via BEGINGROUP', () => {
    it('extracts PDF from GDIC BEGINGROUP comment record', () => {
      const comment = buildBegingroupPdfComment(MINI_PDF);
      const emf = concat(buildEmfHeader(), comment, buildEofRecord());

      const result = parseEmfContent(emf);
      expect(result.type).toBe('pdf');
      if (result.type === 'pdf') {
        const text = new TextDecoder().decode(result.data);
        expect(text).toContain('%PDF');
        expect(text).toContain('%%EOF');
      }
    });
  });

  describe('PDF extraction via brute-force fallback', () => {
    it('extracts PDF from non-GDIC comment records (recordSize > 100)', () => {
      // The fallback only triggers for recordSize > 100, so pad the PDF data
      const paddedPdf = new Uint8Array(120);
      paddedPdf.set(MINI_PDF, 40); // pad 40 bytes before %PDF
      const comment = buildRawPdfComment(paddedPdf);
      const emf = concat(buildEmfHeader(), comment, buildEofRecord());

      const result = parseEmfContent(emf);
      expect(result.type).toBe('pdf');
      if (result.type === 'pdf') {
        const text = new TextDecoder().decode(result.data);
        expect(text).toContain('%PDF');
      }
    });
  });

  describe('PDF without %%EOF', () => {
    it('extracts to end of buffer if %%EOF is missing', () => {
      const pdfNoEof = new TextEncoder().encode('%PDF-1.4\nsome content');
      const comment = buildMultiformatsPdfComment(pdfNoEof);
      const emf = concat(buildEmfHeader(), comment, buildEofRecord());

      const result = parseEmfContent(emf);
      expect(result.type).toBe('pdf');
      if (result.type === 'pdf') {
        const text = new TextDecoder().decode(result.data);
        expect(text).toContain('%PDF-1.4');
        expect(text).toContain('some content');
      }
    });
  });

  describe('bitmap extraction via STRETCHDIBITS', () => {
    it('extracts 24-bit uncompressed bitmap', () => {
      const dib = buildStretchDibitsRecord(4, 3, 24);
      const emf = concat(buildEmfHeader(), dib, buildEofRecord());

      const result = parseEmfContent(emf);
      expect(result.type).toBe('bitmap');
      if (result.type === 'bitmap') {
        expect(result.imageData.width).toBe(4);
        expect(result.imageData.height).toBe(3);
        // Alpha should be 255 for 24-bit
        expect(result.imageData.data[3]).toBe(255);
      }
    });

    it('extracts 32-bit uncompressed bitmap with alpha', () => {
      const dib = buildStretchDibitsRecord(3, 2, 32);
      const emf = concat(buildEmfHeader(), dib, buildEofRecord());

      const result = parseEmfContent(emf);
      expect(result.type).toBe('bitmap');
      if (result.type === 'bitmap') {
        expect(result.imageData.width).toBe(3);
        expect(result.imageData.height).toBe(2);
        // Alpha should come from source (200)
        expect(result.imageData.data[3]).toBe(200);
      }
    });

    it('handles bottom-up row order (positive biHeight)', () => {
      const dib = buildStretchDibitsRecord(2, 2, 24);
      const emf = concat(buildEmfHeader(), dib, buildEofRecord());

      const result = parseEmfContent(emf);
      expect(result.type).toBe('bitmap');
      if (result.type === 'bitmap') {
        // Bottom-up: row 0 in DIB = last row in ImageData
        // Row 1 in DIB (y=1) has B=(1*50)&0xff=50
        // In ImageData row 0 (top), pixel (0,0) B channel = imageData[2] (since it's mapped to R in output)
        // Actually: DIB BGR → ImageData RGBA
        // DIB row y=1 (top in bottom-up → becomes ImageData row 0):
        //   B=50, G=0, R=255 → ImageData: R=255, G=0, B=50, A=255
        const r = result.imageData.data[0];
        const g = result.imageData.data[1];
        const b = result.imageData.data[2];
        expect(r).toBe(255);
        expect(g).toBe(0);
        expect(b).toBe(50);
      }
    });

    it('handles top-down row order (negative biHeight)', () => {
      // Build a custom STRETCHDIBITS with negative height
      const width = 2, height = 2, bpp = 24;
      const bytesPerPixel = 3;
      const rowStride = Math.ceil((width * bytesPerPixel) / 4) * 4;
      const bitmapDataSize = rowStride * height;
      const bmiSize = 40;
      const offBmiSrc = 80;
      const offBitsSrc = offBmiSrc + bmiSize;
      const recordSize = Math.ceil((offBitsSrc + bitmapDataSize) / 4) * 4;
      const rec = new Uint8Array(recordSize);

      writeU32(rec, 0, EMR_STRETCHDIBITS);
      writeU32(rec, 4, recordSize);
      writeU32(rec, 48, offBmiSrc);
      writeU32(rec, 52, bmiSize);
      writeU32(rec, 56, offBitsSrc);
      writeU32(rec, 60, bitmapDataSize);

      writeU32(rec, offBmiSrc, 40);
      writeI32(rec, offBmiSrc + 4, width);
      writeI32(rec, offBmiSrc + 8, -height); // negative = top-down
      writeU16(rec, offBmiSrc + 12, 1);
      writeU16(rec, offBmiSrc + 14, bpp);
      writeU32(rec, offBmiSrc + 16, 0);

      // Row 0: B=0, G=0, R=100
      rec[offBitsSrc + 0] = 0;   // B
      rec[offBitsSrc + 1] = 0;   // G
      rec[offBitsSrc + 2] = 100; // R

      const emf = concat(buildEmfHeader(), rec, buildEofRecord());
      const result = parseEmfContent(emf);
      expect(result.type).toBe('bitmap');
      if (result.type === 'bitmap') {
        // Top-down: row 0 in DIB = row 0 in ImageData
        expect(result.imageData.data[0]).toBe(100); // R
        expect(result.imageData.data[1]).toBe(0);   // G
        expect(result.imageData.data[2]).toBe(0);    // B
      }
    });
  });

  describe('priority', () => {
    it('returns PDF over bitmap when both present (PDF record comes first)', () => {
      const comment = buildMultiformatsPdfComment(MINI_PDF);
      const dib = buildStretchDibitsRecord(2, 2, 24);
      const emf = concat(buildEmfHeader(), comment, dib, buildEofRecord());

      const result = parseEmfContent(emf);
      // PDF record comes first, should be returned
      expect(result.type).toBe('pdf');
    });

    it('returns bitmap when no PDF is present', () => {
      const dib = buildStretchDibitsRecord(2, 2, 24);
      const emf = concat(buildEmfHeader(), dib, buildEofRecord());

      const result = parseEmfContent(emf);
      expect(result.type).toBe('bitmap');
    });
  });

  describe('unsupported cases', () => {
    it('returns unsupported for EMF with only drawing records', () => {
      // Build a record with type 17 (EMR_SETMAPMODE) — a drawing record
      const drawRecord = new Uint8Array(12);
      writeU32(drawRecord, 0, 17); // type
      writeU32(drawRecord, 4, 12); // size
      writeU32(drawRecord, 8, 1);  // data

      const emf = concat(buildEmfHeader(), drawRecord, buildEofRecord());
      const result = parseEmfContent(emf);
      expect(result.type).toBe('unsupported');
    });
  });

  describe('EMF+ dual mode', () => {
    it('skips EMF+ comment and extracts PDF from subsequent GDIC comment', () => {
      // First comment: EMF+ identifier (0x2B464D45)
      const emfPlusComment = new Uint8Array(24);
      writeU32(emfPlusComment, 0, EMR_COMMENT);
      writeU32(emfPlusComment, 4, 24);
      writeU32(emfPlusComment, 8, 16);
      writeU32(emfPlusComment, 12, 0x2b464d45); // "EMF+"

      // Second comment: GDIC with PDF
      const pdfComment = buildMultiformatsPdfComment(MINI_PDF);
      const emf = concat(buildEmfHeader(), emfPlusComment, pdfComment, buildEofRecord());

      const result = parseEmfContent(emf);
      expect(result.type).toBe('pdf');
      if (result.type === 'pdf') {
        const text = new TextDecoder().decode(result.data);
        expect(text).toContain('%PDF');
      }
    });
  });

  describe('edge cases', () => {
    it('handles Uint8Array that is a subarray of a larger buffer', () => {
      const comment = buildMultiformatsPdfComment(MINI_PDF);
      const emf = concat(buildEmfHeader(), comment, buildEofRecord());

      // Wrap in a larger buffer and create a subarray
      const padded = new Uint8Array(emf.length + 100);
      padded.set(emf, 50);
      const subarray = padded.subarray(50, 50 + emf.length);

      const result = parseEmfContent(subarray);
      expect(result.type).toBe('pdf');
    });

    it('handles corrupted record size gracefully', () => {
      const emf = concat(buildEmfHeader(), buildEofRecord());
      // Corrupt the EOF record size to be too large
      writeU32(emf, emf.length - 20 + 4, 999999);

      // Should not crash — just return based on records seen
      const result = parseEmfContent(emf);
      // Only header seen before bad record → empty (recordCount=1, then break)
      expect(result.type).toBe('empty');
    });
  });
});
