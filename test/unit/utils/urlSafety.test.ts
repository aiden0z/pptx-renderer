import { describe, expect, it } from 'vitest';
import { isAllowedExternalUrl } from '../../../src/utils/urlSafety';

describe('isAllowedExternalUrl', () => {
  it('allows https URLs', () => {
    expect(isAllowedExternalUrl('https://example.com')).toBe(true);
  });

  it('allows http URLs', () => {
    expect(isAllowedExternalUrl('http://example.com')).toBe(true);
  });

  it('allows mailto URLs', () => {
    expect(isAllowedExternalUrl('mailto:user@example.com')).toBe(true);
  });

  it('rejects javascript: URLs', () => {
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects data: URLs', () => {
    expect(isAllowedExternalUrl('data:text/html,<h1>hi</h1>')).toBe(false);
  });

  it('rejects ftp: URLs', () => {
    expect(isAllowedExternalUrl('ftp://example.com')).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(isAllowedExternalUrl('not a url')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isAllowedExternalUrl('')).toBe(false);
  });

  it('rejects file: URLs', () => {
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false);
  });
});
