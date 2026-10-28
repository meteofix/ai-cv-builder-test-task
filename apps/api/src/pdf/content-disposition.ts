/**
 * `attachment` header with the person's name: an ASCII fallback for old clients and the exact UTF-8 name
 * (RFC 5987) for everyone else. Characters that could end the quoted string or a path are dropped.
 */
export function attachmentHeader(fullName: string): string {
  const base = fullName
    // A lone surrogate would make encodeURIComponent throw; `toWellFormed()` is not in the ES2023 lib.
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd')
    .replace(/[\p{Cc}\p{Cf}"\\/;%]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const name = base ? `${base} CV` : 'CV';
  const ascii =
    name
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'CV';
  // encodeURIComponent keeps ' ( ) * which RFC 5987 does not allow unescaped.
  const encoded = encodeURIComponent(`${name}.pdf`).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}.pdf"; filename*=UTF-8''${encoded}`;
}
