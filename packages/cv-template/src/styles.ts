/**
 * The stylesheet of `docs/design/cv-template/resume-a-en.html` (the part after the font faces, which
 * `fontFaceCss` generates), as it is. The `screen` rules make the preview one continuous A4-wide page;
 * the PDF is printed, so only the `@page` rule and the print rules apply to it.
 */
export const CV_CSS = `
:root{--ink:#1c1e22;--muted:#5a5e66;--faint:#9ba0a8;--rule:#d6d8dc;--accent:#1f4f7b}
@page{size:A4;margin:17mm}
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
.cv-entry__meta>:not(:empty)~:not(:empty)::before{content:"·";margin:0 .5em;color:var(--faint)}

.cv-section{margin-top:6mm}
.cv-section__title{margin-bottom:3mm;padding-bottom:1.2mm;border-bottom:.5pt solid var(--rule);font-size:8.5pt;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--accent);break-after:avoid;page-break-after:avoid}

.cv-entry{break-inside:avoid;page-break-inside:avoid}
.cv-entry+.cv-entry{margin-top:3.6mm}
.cv-entry--compact+.cv-entry--compact{margin-top:2.4mm}
.cv-entry__head{display:flex;justify-content:space-between;align-items:baseline;gap:4mm;break-after:avoid}
.cv-entry__title{font-size:10.5pt;font-weight:600;line-height:1.35}
.cv-entry__dates{flex:none;font-size:9.25pt;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.cv-entry__meta{color:var(--muted);break-after:avoid}
.cv-entry__org{font-weight:500;color:var(--ink)}
.cv-entry__bullets{margin-top:1.4mm}
.cv-entry__bullets li{position:relative;padding-left:4.2mm;break-inside:avoid}
.cv-entry__bullets li+li{margin-top:.9mm}
.cv-entry__bullets li::before{content:"";position:absolute;left:.4mm;top:.62em;width:1.2mm;height:1.2mm;border-radius:50%;background:var(--accent)}

.cv-list li{break-inside:avoid}
.cv-list li+li{margin-top:.9mm}

@media screen{
  html{background:#e5e5e3}
  body{padding:10mm 0}
  .cv{width:210mm;min-height:297mm;margin:0 auto;padding:17mm;background:#fff;box-shadow:0 1px 2px rgb(0 0 0/.06),0 8px 28px rgb(0 0 0/.08)}
}
@media print{.cv{width:auto}}
`;
