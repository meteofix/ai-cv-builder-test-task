const STRONG = '·|•;';
/** Ends a line whose only name has a comma of its own, so that it reads back as one name. */
export const SPLIT_AT_DOTS_ONLY = ' ·';

/** `text` cut at every character outside brackets that `cut` accepts. */
function cutOutsideBrackets(text: string, cut: (char: string) => boolean): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if ('([{'.includes(char)) depth++;
    if (')]}'.includes(char)) depth = Math.max(0, depth - 1);
    if (depth === 0 && cut(char)) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/**
 * Names in a list, never cut inside brackets: "Python (pandas, NumPy), SQL" is two. A line with `· | • ;`
 * between two names outside brackets is cut only there, because its commas belong to names ("A · B, C &
 * D · E" is three); any other line is cut at commas ("Python, SQL;" is two). A marker that opens the
 * line is not a separator; a ` ·` that ends it keeps its commas (`SPLIT_AT_DOTS_ONLY`: the editor shows
 * one name with a comma that way). The editor's skills line and the server's kept skill lines both use it.
 */
export function splitList(text: string): string[] {
  const line = text.replace(/^\s*[·|•;]\s*/u, '');
  const strong = cutOutsideBrackets(line, (char) => STRONG.includes(char));
  const named = strong.filter((part) => part.trim() !== '').length;
  const dotsOnly = named > 1 || line.trimEnd().endsWith(SPLIT_AT_DOTS_ONLY.trim());
  return (
    dotsOnly ? strong : cutOutsideBrackets(line, (char) => char === ',' || STRONG.includes(char))
  )
    .map((name) =>
      name
        .trim()
        .replace(/^[-–—*▪●◦]\s*/, '')
        .replace(/\.$/, ''),
    )
    .filter(Boolean);
}

/**
 * A kept line of a CV as skills: a short label before a colon ("Cloud: AWS, GCP") is the group's, not a
 * skill. A label with a comma ("Process, Tooling & Enablement: …") only when a list follows it: in
 * "Figma, Sketch, Miro: expert" the names come before the colon.
 */
export function splitSkills(text: string): string[] {
  const label = /^[^:(]{1,40}:\s+/.exec(text)?.[0];
  if (!label) return splitList(text);
  const rest = text.slice(label.length);
  return !label.includes(',') || splitList(rest).length > 1 ? splitList(rest) : splitList(text);
}
