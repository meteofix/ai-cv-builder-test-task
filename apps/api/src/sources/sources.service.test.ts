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
});
