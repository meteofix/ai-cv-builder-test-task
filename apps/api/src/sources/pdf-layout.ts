// Loaded by the PDF worker (pdf-text.worker.ts) as well as by the tests: plain TypeScript that Node runs
// by stripping types, with no imports — which is why it stays one file a little over the usual size.

/** A text run of a PDF page as PDF.js reports it: baseline origin `x`, `y` (y grows upwards). */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  /** Font size. */
  height: number;
  hasEOL: boolean;
}

interface Run {
  x0: number;
  x1: number;
  size: number;
  text: string;
}

interface Row {
  y: number;
  size: number;
  runs: Run[];
}

interface Gutter {
  from: number;
  to: number;
}

/** Runs farther apart than this many font sizes print with two spaces between them. */
const WIDE_GAP = 1.2;
/** The narrowest gutter, in font sizes: wider than any word space, narrower than a tight column gap. */
const MIN_GUTTER = 0.6;
/** At most this share of a region's rows may cross a gutter (full-width headers and the like). */
const MAX_CROSSING_SHARE = 0.1;
/** Share of one side's rows that must sit on a row of the other side for the rows to be one table. */
const TABLE_ALIGNED_SHARE = 0.8;
/**
 * Tables in a CV (awards, a title with its dates) are short; two columns set in the same font and
 * spacing align row by row too, and reading them as one table would weave the columns together.
 */
const MAX_TABLE_ROWS = 12;
/** A side column of dates or places: mostly aligned with the main side, fewer rows and narrow. */
const SIDE_ALIGNED_SHARE = 0.7;
const SIDE_MAX_ROW_SHARE = 0.6;
const SIDE_MAX_WIDTH_SHARE = 0.35;
const MAX_DEPTH = 2;
/** Wider regions are not laid out (coverage is counted per point of width). */
const MAX_WIDTH = 10_000;
/** A CV page has well under a hundred rows and a few thousand runs; a crafted page keeps the stream order. */
const MAX_ROWS = 500;
const MAX_RUNS = 5_000;
/** A block of a side column holds an entry's place, dates and duration, not a paragraph. */
const MAX_SIDE_BLOCK = 4;

/**
 * The text of one page in reading order. Columns are found as vertical gutters; a row that crosses the
 * gutter (a full-width header) cuts the page into bands, and each band is read column by column. A
 * narrow column of dates or places next to entries is attached to the entry line it starts at instead of
 * being read as a column of its own, and rows aligned on both sides (a table) stay rows. A page where no
 * gutter is found keeps the order of its content stream, as PDF text extraction gives it without layout.
 */
export function pageText(items: readonly PdfTextItem[]): string {
  const rows = toRows(items);
  const runs = rows.reduce((count, row) => count + row.runs.length, 0);
  const laidOut =
    rows.length === 0 || rows.length > MAX_ROWS || runs > MAX_RUNS ? null : layout(rows, 0);
  return laidOut === null ? streamText(items) : laidOut.join('\n');
}

/** The page as the content stream orders it, with PDF.js's own line ends. */
export function streamText(items: readonly PdfTextItem[]): string {
  return items.map((item) => item.str + (item.hasEOL ? '\n' : '')).join('');
}

function toRows(items: readonly PdfTextItem[]): Row[] {
  const visible = items
    .filter(
      (item) =>
        item.str.trim() !== '' &&
        item.height > 0 &&
        Number.isFinite(item.x) &&
        Number.isFinite(item.y) &&
        Number.isFinite(item.width),
    )
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Row[] = [];
  for (const item of visible) {
    const run = {
      x0: item.x,
      x1: item.x + Math.max(0, item.width),
      size: item.height,
      text: item.str,
    };
    const row = rows.at(-1);
    if (row && Math.abs(row.y - item.y) <= 0.5 * Math.min(row.size, item.height)) {
      row.runs.push(run);
      row.size = Math.max(row.size, item.height);
    } else {
      rows.push({ y: item.y, size: item.height, runs: [run] });
    }
  }
  return withSuperscripts(rows);
}

/** A row of small text just above the next row (a superscript such as "1st") belongs to that row. */
function withSuperscripts(rows: Row[]): Row[] {
  const merged: Row[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const next = rows[i + 1];
    if (!row) continue;
    if (next && row.size < 0.8 * next.size && row.y - next.y < 0.7 * next.size) {
      rows[i + 1] = { ...next, runs: [...next.runs, ...row.runs] };
      continue;
    }
    merged.push(row);
  }
  return merged;
}

/** The row's runs in x order: a space at a word gap, two spaces at a wide gap. */
function rowText(row: Row): string {
  const runs = [...row.runs].sort((a, b) => a.x0 - b.x0);
  let text = '';
  let last: Run | null = null;
  for (const run of runs) {
    if (last) {
      const gap = run.x0 - last.x1;
      const size = Math.max(run.size, last.size);
      const spaced = /\s$/.test(text) || /^\s/.test(run.text);
      if (gap > WIDE_GAP * size) text = `${text.trimEnd()}  `;
      else if (gap > 0.15 * size && !spaced) text += ' ';
    }
    text += run.text;
    last = run;
  }
  return text.trim();
}

/** The lines of a region, or null at the top level when it has no gutter (the caller falls back). */
function layout(rows: Row[], depth: number): string[] | null {
  const gutter = depth < MAX_DEPTH ? findGutter(rows) : null;
  if (gutter === null) return depth === 0 ? null : rows.map(rowText);
  const lines: string[] = [];
  let band: Row[] = [];
  const flush = () => {
    if (band.length > 0) lines.push(...readBand(band, gutter, depth));
    band = [];
  };
  for (const row of rows) {
    if (crosses(row, gutter)) {
      flush();
      lines.push(rowText(row));
    } else {
      band.push(row);
    }
  }
  flush();
  return lines;
}

function crosses(row: Row, gutter: Gutter): boolean {
  return row.runs.some((run) => run.x0 < gutter.to && run.x1 > gutter.from);
}

/**
 * An empty vertical strip with text on both sides: the fewest crossing rows first (a strip crossed by one
 * full-width line beats none at all, and rows reaching into a strip narrow it), then the widest. Coverage
 * is counted per run, not per merged line, so a line ending close to a column of dates does not bridge it.
 */
function findGutter(rows: Row[]): Gutter | null {
  const runs = rows.flatMap((row) => row.runs);
  if (runs.length < 2) return null;
  const { x0, x1 } = extent(runs);
  const left = Math.floor(x0);
  const right = Math.ceil(x1);
  const width = right - left;
  if (!(width > 0) || width > MAX_WIDTH) return null;
  const coverage = new Array<number>(width).fill(0);
  for (const row of rows) {
    const covered = new Uint8Array(width);
    for (const run of row.runs) {
      const from = Math.max(0, Math.floor(run.x0) - left);
      covered.fill(1, from, Math.min(width, Math.ceil(run.x1) - left));
    }
    covered.forEach((value, x) => (coverage[x] = (coverage[x] ?? 0) + value));
  }
  const sizes = rows.map((row) => row.size).sort((a, b) => a - b);
  const minWidth = MIN_GUTTER * (sizes[Math.floor(sizes.length / 2)] ?? 10);
  // One full-width line (a name above two columns) may cross even a short region.
  const limit = Math.max(1, Math.floor(MAX_CROSSING_SHARE * rows.length));
  for (let crossing = 0; crossing <= limit; crossing++) {
    let best: Gutter | null = null;
    for (let x = 0; x < width;) {
      if ((coverage[x] ?? 0) > crossing) {
        x++;
        continue;
      }
      let end = x;
      while (end < width && (coverage[end] ?? 0) <= crossing) end++;
      const gutter = { from: left + x, to: left + end };
      const wider = best === null || gutter.to - gutter.from > best.to - best.from;
      // Each point of the strip is covered by few rows, but different rows may cover different points.
      const fits = () => rows.filter((row) => crosses(row, gutter)).length <= limit;
      if (
        end - x >= minWidth &&
        x > 0 &&
        end < width &&
        wider &&
        fits() &&
        bothSides(rows, gutter)
      ) {
        best = gutter;
      }
      x = end;
    }
    if (best !== null) return best;
  }
  return null;
}

function extent(runs: readonly Run[]): { x0: number; x1: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const run of runs) {
    x0 = Math.min(x0, run.x0);
    x1 = Math.max(x1, run.x1);
  }
  return { x0, x1 };
}

function bothSides(rows: Row[], gutter: Gutter): boolean {
  const count = (test: (run: Run) => boolean) =>
    rows.filter((row) => !crosses(row, gutter) && row.runs.some(test)).length;
  return count((run) => run.x1 <= gutter.from) >= 2 && count((run) => run.x0 >= gutter.to) >= 2;
}

interface Split {
  row: Row;
  left: Row | null;
  right: Row | null;
}

function side(row: Row, runs: Run[]): Row | null {
  return runs.length === 0 ? null : { ...row, runs };
}

/** One band between full-width rows: a table, a column attached to entries, or two columns. */
function readBand(band: Row[], gutter: Gutter, depth: number): string[] {
  const splits: Split[] = band.map((row) => ({
    row,
    left: side(
      row,
      row.runs.filter((run) => run.x1 <= gutter.from),
    ),
    right: side(
      row,
      row.runs.filter((run) => run.x0 >= gutter.to),
    ),
  }));
  const lefts = splits.filter((split) => split.left !== null).length;
  const rights = splits.filter((split) => split.right !== null).length;
  const both = splits.filter((split) => split.left !== null && split.right !== null).length;
  if (lefts === 0 || rights === 0) return band.map(rowText);
  const aligned = both >= TABLE_ALIGNED_SHARE * lefts && both >= TABLE_ALIGNED_SHARE * rights;
  // A list whose markers are runs of their own aligns too, however long it is.
  const markers = (pick: (split: Split) => Row | null) =>
    splits.every((split) => (pick(split)?.runs ?? []).every((run) => run.x1 - run.x0 <= run.size));
  if (aligned && (band.length <= MAX_TABLE_ROWS || markers((split) => split.left))) {
    return band.map(rowText);
  }
  const { x0, x1 } = extent(band.flatMap((row) => row.runs));
  const narrow = (pick: (split: Split) => Row | null) =>
    splits.every((split) => {
      const part = pick(split);
      if (part === null) return true;
      const width = extent(part.runs);
      return width.x1 - width.x0 <= SIDE_MAX_WIDTH_SHARE * (x1 - x0);
    });
  const sideColumn = (sideRows: number, mainRows: number, pick: (split: Split) => Row | null) =>
    both >= SIDE_ALIGNED_SHARE * sideRows &&
    sideRows <= SIDE_MAX_ROW_SHARE * mainRows &&
    narrow(pick) &&
    longestBlock(splits, pick) <= MAX_SIDE_BLOCK;
  if (sideColumn(rights, lefts, (split) => split.right)) return attach(splits, 'right');
  if (sideColumn(lefts, rights, (split) => split.left)) return attach(splits, 'left');
  const column = (pick: (split: Split) => Row | null) =>
    layout(
      splits.flatMap((split) => pick(split) ?? []),
      depth + 1,
    ) ?? [];
  return [...column((split) => split.left), ...column((split) => split.right)];
}

/** The most consecutive rows of one side with no gap of more than two lines between them. */
function longestBlock(splits: Split[], pick: (split: Split) => Row | null): number {
  let longest = 0;
  let current = 0;
  let previous: Split | null = null;
  for (const split of splits) {
    if (pick(split) === null) continue;
    const joins = previous !== null && previous.row.y - split.row.y <= 2 * split.row.size;
    current = joins ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = split;
  }
  return longest;
}

/**
 * Lines of the main side, each followed (or, for a column on the left, preceded) by the side lines that
 * start next to it: a block of consecutive side lines (an entry's place, dates and duration) goes with the
 * main line at its first line's height, or the nearest main line above it. A block above every main line
 * stays a line of its own.
 */
function attach(splits: Split[], sideName: 'left' | 'right'): string[] {
  const main = (split: Split) => (sideName === 'right' ? split.left : split.right);
  const extra = (split: Split) => (sideName === 'right' ? split.right : split.left);
  const attached = new Map<Split, string[]>();
  const loose = new Map<Split, string>();
  let anchor: Split | null = null;
  let owner: Split | null = null;
  let previous: Split | null = null;
  for (const split of splits) {
    if (main(split) !== null) anchor = split;
    const part = extra(split);
    if (part === null) continue;
    // A gap in the side column starts a new block, which looks for its own main line; so does a block
    // that started above every main line, once one appears.
    const gap = previous === null || previous.row.y - split.row.y > 2 * split.row.size;
    if (gap || owner === null) owner = anchor;
    if (owner === null) loose.set(split, rowText(part));
    else attached.set(owner, [...(attached.get(owner) ?? []), rowText(part)]);
    previous = split;
  }
  return splits.flatMap((split) => {
    const own = main(split);
    if (own === null) return loose.has(split) ? [loose.get(split) ?? ''] : [];
    const parts = [rowText(own)];
    const added = attached.get(split) ?? [];
    return [(sideName === 'right' ? [...parts, ...added] : [...added, ...parts]).join('  ')];
  });
}
