// One readable provenance line: the filename is omitted when the label is just that filename.
export function provenanceLine(
  number: number,
  q: { page: number; pageEnd: number },
  s: { label: string; fileName: string; year?: string | null },
): string {
  const label = s.label.trim();
  const name = label && label !== s.fileName.replace(/\.pdf$/i, '') ? `${label} · ${s.fileName}` : s.fileName;
  const pages = q.page === q.pageEnd ? `p. ${q.page}` : `pp. ${q.page}–${q.pageEnd}`;
  return `Source Q${number} · ${name} · ${s.year ?? 'Year not set'} · ${pages}`;
}
