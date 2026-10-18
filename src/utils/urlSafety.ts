/**
 * URL safety utilities for external hyperlinks/media in untrusted PPTX content.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const ALLOWED_MEDIA_PROTOCOLS = new Set(['http:', 'https:']);

/** Whether rendering may resolve external picture, fill, audio, video, or poster relationships. */
export type ExternalMediaPolicy = 'allow' | 'block';

function getUrlProtocol(url: string): string | undefined {
  try {
    return new URL(url).protocol.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Returns true only for absolute URLs with an allowed protocol.
 */
export function isAllowedExternalUrl(url: string): boolean {
  const protocol = getUrlProtocol(url);
  return protocol !== undefined && ALLOWED_PROTOCOLS.has(protocol);
}

/**
 * Returns true only for absolute media URLs that browsers can fetch safely.
 */
export function isAllowedExternalMediaUrl(
  url: string,
  policy: ExternalMediaPolicy = 'allow',
): boolean {
  if (policy === 'block') return false;
  const protocol = getUrlProtocol(url);
  return protocol !== undefined && ALLOWED_MEDIA_PROTOCOLS.has(protocol);
}
