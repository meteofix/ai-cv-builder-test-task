/**
 * A line of skills cut into names at `, · | • ;`, never inside brackets:
 * "Python (pandas, NumPy), SQL" is two skills. A label before a colon ("Cloud: AWS, GCP") is not a skill.
 */
export function splitSkills(text: string): string[] {
  const body = text.replace(/^[^,:(]{1,40}:\s+/, '');
  const names: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
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
