/**
 * The file name of a download from its `Content-Disposition`: the exact UTF-8 `filename*` (RFC 5987)
 * first, so a Ukrainian name survives, then the ASCII `filename` the server sends for old clients.
 */
export function fileNameOf(disposition: string, fallback: string): string {
  const encoded = /filename\*\s*=\s*UTF-8''([^;\s]+)/i.exec(disposition)?.[1];
  if (encoded !== undefined) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // A malformed escape: the ASCII name below is still a usable answer.
    }
  }
  return /(?:^|;)\s*filename\s*=\s*"?([^";]+)"?/i.exec(disposition)?.[1] ?? fallback;
}
