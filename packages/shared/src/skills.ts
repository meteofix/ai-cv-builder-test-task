/**
 * Names in a list cut at `, · | • ;`, never inside brackets: "Python (pandas, NumPy), SQL" is two. The
 * editor's skills line and the server's kept skill lines both use it.
 */
export function splitList(text: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if ('([{'.includes(char)) depth++;
    if (')]}'.includes(char)) depth = Math.max(0, depth - 1);
    if (depth === 0 && ',·|•;'.includes(char)) {
      names.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  names.push(current);
  return names
    .map((name) =>
      name
        .trim()
        .replace(/^[-–—*▪●◦]\s*/, '')
        .replace(/\.$/, ''),
    )
    .filter(Boolean);
}

/** A kept line of a CV as skills: a label before a colon ("Cloud: AWS, GCP") is the group's, not a skill. */
export function splitSkills(text: string): string[] {
  return splitList(text.replace(/^[^,:(]{1,40}:\s+/, ''));
}
