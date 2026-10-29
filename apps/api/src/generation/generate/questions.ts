/** "Senior Engineer — Acme Corp"; the label of a position for the judge of the answer flow. */
export function positionLabel(position: { title: string; company: string }): string {
  return [position.title, position.company].filter(Boolean).join(' — ') || 'Position';
}
