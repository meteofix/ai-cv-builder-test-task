import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { extractPdfText } from './extract-pdf-text.js';
import { SourcesService } from './sources.service.js';

vi.mock('./extract-pdf-text.js', () => ({ extractPdfText: vi.fn() }));

describe('SourcesService', () => {
  it('runs at most three extractions at once and lets the others wait', async () => {
    let running = 0;
    let peak = 0;
    vi.mocked(extractPdfText).mockImplementation(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running--;
      return { ok: true, text: 'Iryna Kovalenko' };
    });
    const service = new SourcesService(pino({ level: 'silent' }));

    const texts = await Promise.all(
      Array.from({ length: 8 }, () => service.textFromPdf(Buffer.from('%PDF-1.7'))),
    );

    expect(texts).toHaveLength(8);
    expect(peak).toBe(3);
  });

  it('frees the slot when an extraction fails', async () => {
    vi.mocked(extractPdfText).mockResolvedValue({ ok: false, reason: 'too_many_pages' });
    const service = new SourcesService(pino({ level: 'silent' }));
    for (let i = 0; i < 5; i++) {
      await expect(service.textFromPdf(Buffer.from('%PDF-1.7'))).rejects.toMatchObject({
        code: 'PDF_TOO_MANY_PAGES',
      });
    }
  });

  it.each([
    ['an empty file', Buffer.alloc(0)],
    ['PNG bytes', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['a BOM before the signature', Buffer.from('\ufeff%PDF-1.7')],
    ['white space before the signature', Buffer.from(' %PDF-1.7')],
    ['a signature without the dash', Buffer.from('%PDF1.7')],
    ['text that merely mentions %PDF-', Buffer.from('Hello %PDF- world')],
  ])('refuses %s by its signature, without starting a worker', async (_case, bytes) => {
    vi.mocked(extractPdfText).mockClear();
    const service = new SourcesService(pino({ level: 'silent' }));
    await expect(service.textFromPdf(bytes)).rejects.toMatchObject({ code: 'PDF_INVALID' });
    expect(extractPdfText).not.toHaveBeenCalled();
  });
});
