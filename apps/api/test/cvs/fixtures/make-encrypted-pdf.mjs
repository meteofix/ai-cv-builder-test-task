// Writes encrypted.pdf next to this file: a one-page PDF with the text "Encrypted CV", protected with the
// user password "secret" (Standard security handler, revision 2, RC4 40-bit; PDF 1.7 spec, algorithms
// 3.1–3.4). No PDF tool in the dependency set can encrypt, so the file is built by hand.
// Run: node apps/api/test/cvs/fixtures/make-encrypted-pdf.mjs
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest();
const padded = (password) => Buffer.concat([Buffer.from(password, 'latin1'), PAD]).subarray(0, 32);

function rc4(key, data) {
  const s = [...Array(256).keys()];
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

const id = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
const permissions = Buffer.alloc(4);
permissions.writeInt32LE(-4);
const owner = rc4(md5(padded('owner')).subarray(0, 5), padded('secret'));
const fileKey = md5(padded('secret'), owner, permissions, id).subarray(0, 5);
const user = rc4(fileKey, PAD);

function objectKey(objectNumber) {
  const suffix = Buffer.from([
    objectNumber & 255,
    (objectNumber >> 8) & 255,
    objectNumber >> 16,
    0,
    0,
  ]);
  return md5(fileKey, suffix).subarray(0, 10);
}

const content = Buffer.from('BT /F1 24 Tf 72 720 Td (Encrypted CV) Tj ET', 'latin1');
const encrypted = rc4(objectKey(4), content);

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 6 0 R >> >> >>',
  Buffer.concat([
    Buffer.from(`<< /Length ${encrypted.length} >>\nstream\n`, 'latin1'),
    encrypted,
    Buffer.from('\nendstream', 'latin1'),
  ]),
  `<< /Filter /Standard /V 1 /R 2 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P -4 >>`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];

const chunks = [Buffer.from('%PDF-1.4\n', 'latin1')];
const offsets = [];
let length = chunks[0].length;
objects.forEach((body, index) => {
  offsets.push(length);
  const chunk = Buffer.concat([
    Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
    Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'),
    Buffer.from('\nendobj\n', 'latin1'),
  ]);
  chunks.push(chunk);
  length += chunk.length;
});
const xref = [
  'xref',
  `0 ${objects.length + 1}`,
  '0000000000 65535 f ',
  ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
  'trailer',
  `<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 5 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>] >>`,
  'startxref',
  String(length),
  '%%EOF',
  '',
].join('\n');
chunks.push(Buffer.from(xref, 'latin1'));

writeFileSync(new URL('./encrypted.pdf', import.meta.url), Buffer.concat(chunks));
