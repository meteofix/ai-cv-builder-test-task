import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfRenderer } from './pdf-renderer.service.js';

interface Printer {
  print: () => Promise<Buffer>;
}

const newRenderer = () => new PdfRenderer(pino({ level: 'silent' }));
const printOf = (renderer: PdfRenderer) => vi.spyOn(renderer as unknown as Printer, 'print');

describe('PdfRenderer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers PDF_RENDER_FAILED when a render takes longer than 15 seconds', async () => {
    const renderer = newRenderer();
    printOf(renderer).mockReturnValue(new Promise(() => undefined));

    const settled = expect(renderer.render('<html></html>')).rejects.toMatchObject({
      code: 'PDF_RENDER_FAILED',
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await settled;
  });

  it('counts the wait for a free slot in the same 15 seconds and never starts a render after it', async () => {
    const renderer = newRenderer();
    const releases: (() => void)[] = [];
    const print = printOf(renderer).mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(() => {
            resolve(Buffer.from('%PDF-'));
          });
        }),
    );

    // Two renders hold both slots; the third waits for one.
    const holders = [renderer.render('a'), renderer.render('b')].map((p) =>
      p.catch(() => undefined),
    );
    const third = expect(renderer.render('c')).rejects.toMatchObject({ code: 'PDF_RENDER_FAILED' });
    await vi.advanceTimersByTimeAsync(15_000);
    await third;

    // The slots free up only now, after the third request was answered: it must not start printing.
    releases.forEach((release) => {
      release();
    });
    await Promise.all(holders);
    await vi.advanceTimersByTimeAsync(0);
    expect(print).toHaveBeenCalledTimes(2);
  });

  it('runs at most two renders at once and finishes them all', async () => {
    const renderer = newRenderer();
    let running = 0;
    let peak = 0;
    printOf(renderer).mockImplementation(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 100));
      running--;
      return Buffer.from('%PDF-');
    });

    const all = Promise.all(Array.from({ length: 5 }, () => renderer.render('x')));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await all).toHaveLength(5);
    expect(peak).toBe(2);
    // Every slot was handed back: two more renders start at once again.
    peak = 0;
    const again = Promise.all([renderer.render('y'), renderer.render('z')]);
    await vi.advanceTimersByTimeAsync(1_000);
    await again;
    expect(peak).toBe(2);
  });
});
