import { renderCvBody, renderCvShell } from '@cv/cv-template';
import type { CvDocument } from '@cv/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { previewPages } from '../editor/pages';

/** A4 at 96 dpi: the page is laid out at this width and scaled down to the column. */
const SHEET_WIDTH = 794;
/** The one DOM write into the preview page: everything else in it was set once with the shell. */
function writeBody(frame: HTMLIFrameElement | null, html: string): void {
  const body = frame?.contentDocument?.body;
  if (body) body.innerHTML = html;
}

interface CvPreviewProps {
  document: CvDocument;
  /** The estimated number of printed pages, each time the laid-out page changes. */
  onPages?: (pages: number) => void;
}

/**
 * The CV as the PDF will print it, in an iframe without scripts. The page (fonts and styles) is written once;
 * every change replaces only the body, so there is no reload and the scroll position stays.
 */
export function CvPreview({ document: cv, onPages }: CvPreviewProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  // The latest callback, read by `fit`, which the resize observer keeps for the life of the page.
  const pagesCallback = useRef(onPages);
  useEffect(() => {
    pagesCallback.current = onPages;
  });
  const sheet = useRef<HTMLDivElement>(null);
  // Set once, from the first document: later edits never touch the page, only its body.
  const [shell] = useState(() =>
    renderCvShell({ fonts: { baseUrl: '/fonts' } }, cv.locale, cv.contacts.fullName),
  );
  // The page loads asynchronously; writing into the initial blank document would be lost in some browsers.
  const [loaded, setLoaded] = useState(false);
  const html = renderCvBody(cv);

  /** Height follows the content, and the 794 px page is scaled down to the width the column gives it. */
  const fit = useCallback(() => {
    const body = frame.current?.contentDocument?.body;
    const box = sheet.current;
    if (!frame.current || !body || !box) return;
    const scale = Math.min(1, box.clientWidth / SHEET_WIDTH);
    const height = body.offsetHeight;
    frame.current.style.height = `${height}px`;
    frame.current.style.transform = `scale(${scale})`;
    box.style.height = `${height * scale}px`;
    const pages = previewPages(body.ownerDocument);
    if (pages !== null) pagesCallback.current?.(pages);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    writeBody(frame.current, html);
    fit();
  }, [loaded, html, fit]);

  // Late layout changes (fonts arriving, the column resizing) re-fit the page without a re-render.
  useEffect(() => {
    const body = frame.current?.contentDocument?.body;
    if (!loaded || !body || !sheet.current) return;
    const observer = new ResizeObserver(fit);
    observer.observe(sheet.current);
    observer.observe(body);
    return () => {
      observer.disconnect();
    };
  }, [loaded, fit]);

  return (
    <div className="sheet" ref={sheet}>
      <iframe
        ref={frame}
        className="sheet__frame"
        title="CV preview"
        sandbox="allow-same-origin"
        srcDoc={shell}
        onLoad={() => {
          setLoaded(true);
        }}
      />
    </div>
  );
}
