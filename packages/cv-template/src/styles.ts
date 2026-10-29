import { PAGE_MARGIN_MM } from './page.js';

/**
 * The stylesheet of `docs/design/cv-template/resume-a-en.html` (the part after the font faces, which
 * `fontFaceCss` generates), as it is. The `screen` rules make the preview one continuous A4-wide page;
 * the PDF is printed, so only the `@page` rule and the print rules apply to it.
 * Nothing with text is positioned (the bullet dot is an inline box): Chromium paints positioned boxes last,
 * which would move their text to the end of the PDF (docs/specs/cv-template.md, behaviour 1).
 *
 * Additions the reference has no analogue for (behaviour 10): group titles, the company period, summary
 * paragraphs and the page-break rules. One departure: a titled skill group's list is inline, each skill an
 * inline block, where the reference has an inline flex box — that box moved whole to the next line and
 * left the title alone on its own (a line per group); rows inside a group now sit at the line height. A long entry may break between its lines, because an unbreakable
 * company block that does not fit the rest of a page leaves that page nearly empty; a heading never ends
 * a page, and a line never splits across two.
 */
export const CV_CSS = `
:root{--ink:#1c1e22;--muted:#5a5e66;--faint:#9ba0a8;--rule:#d6d8dc;--accent:#1f4f7b}
@page{size:A4;margin:${PAGE_MARGIN_MM}mm}
*{box-sizing:border-box;margin:0;padding:0}
html{font:400 10pt/1.45 "IBM Plex Sans",Arial,sans-serif;color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact;-webkit-text-size-adjust:100%}
body{overflow-wrap:anywhere;text-wrap:pretty}
a{color:inherit;text-decoration:none}
ul{list-style:none}

.cv-header{padding-bottom:4.5mm;border-bottom:1pt solid var(--ink)}
.cv-name{font-size:24pt;font-weight:600;line-height:1.1;letter-spacing:-.015em}
.cv-headline{margin-top:1.2mm;font-size:12pt;font-weight:500;color:var(--accent)}
.cv-contacts{margin-top:3mm;font-size:9.25pt;color:var(--muted)}
.cv-contacts,.cv-skills{display:flex;flex-wrap:wrap;row-gap:.6mm}
.cv-contacts li,.cv-skills li{min-width:0}
.cv-contacts li:not(:empty):has(~li:not(:empty))::after,
.cv-skills li:not(:empty):has(~li:not(:empty))::after{content:"·";margin:0 .55em;color:var(--faint)}
.cv-skill-group .cv-skills{display:inline}
.cv-skill-group{text-align:left}
.cv-skill-group .cv-skills li{display:inline-block;max-width:100%}
.cv-skill-group .cv-skills li:not(:empty):has(~li:not(:empty))::after{margin:0 .4em}
.cv-skill-group+.cv-skill-group{margin-top:.8mm}
.cv-skill-group__title{font-weight:500}
.cv-entry__meta>:not(:empty)~:not(:empty)::before{content:"·";margin:0 .5em;color:var(--faint)}

.cv-section{margin-top:6mm}
.cv-summary{white-space:pre-line}
.cv-section__title{margin-bottom:3mm;padding-bottom:1.2mm;border-bottom:.5pt solid var(--rule);font-size:8.5pt;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--accent);break-after:avoid;page-break-after:avoid}

.cv-entry--compact{break-inside:avoid;page-break-inside:avoid}
.cv-entry+.cv-entry{margin-top:3.6mm}
.cv-entry--compact+.cv-entry--compact{margin-top:2.4mm}
.cv-entry__head{display:flex;justify-content:space-between;align-items:baseline;gap:4mm;break-after:avoid;page-break-after:avoid}
.cv-entry__title{font-size:10.5pt;font-weight:600;line-height:1.35}
.cv-entry__dates{flex:none;font-size:9.25pt;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.cv-entry__continued{margin-bottom:1.2mm;font-size:9.5pt;color:var(--muted)}
.cv-entry__meta{color:var(--muted);break-after:avoid;page-break-after:avoid}
.cv-entry__org{font-weight:500;color:var(--ink)}
.cv-entry--group>.cv-entry__meta .cv-entry__org{font-size:10.5pt;font-weight:600}
.cv-entry--group>.cv-entry__meta{display:flex;align-items:baseline}
.cv-entry--group>.cv-entry__meta .cv-entry__dates--company{margin-left:auto;padding-left:4mm}
.cv-entry--group>.cv-entry__meta .cv-entry__dates--company::before{content:none}
.cv-entry__role{margin-top:1mm}
.cv-entry__bullets{margin-top:1.4mm}
.cv-entry__bullets li{padding-left:4.2mm;break-inside:avoid}
.cv-entry__bullets li+li{margin-top:.9mm}
.cv-entry__group-title{margin-top:1.8mm;font-size:9.5pt;font-weight:500;break-after:avoid;page-break-after:avoid}
.cv-entry__group-title+ul{margin-top:.6mm}
.cv-entry__bullets li::before{content:"";display:inline-block;width:1.2mm;height:1.2mm;margin:0 2.6mm 0 -3.8mm;vertical-align:.15em;border-radius:50%;background:var(--accent)}

.cv-list li{break-inside:avoid}
.cv-list li+li{margin-top:.9mm}
.cv-list+.cv-list,.cv-list+.cv-entry,.cv-entry+.cv-list{margin-top:2.4mm}

@media screen{
  html{background:#e5e5e3}
  body{padding:10mm 0}
  .cv{width:210mm;min-height:297mm;margin:0 auto;padding:${PAGE_MARGIN_MM}mm;background:#fff;box-shadow:0 1px 2px rgb(0 0 0/.06),0 8px 28px rgb(0 0 0/.08)}
}
@media print{.cv{width:auto}}
`;
