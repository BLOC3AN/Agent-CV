/** Split a long CV section without depending on the removed Node worker. */
export function chunkSection(text: string, maxChars = 1_800): string[] {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return [trimmed]

  const lines = trimmed.split('\n')
  const boundaries: number[] = []
  const bullet = /^[\s​]*(?:[•▪▫◦●○◆◇■□▸▶►‣⁃➢✦✔✓*·]|[-–—]\s)/
  const date = /\b(19|20)\d{2}\b|\b(present|current|now|ongoing|nay|hiện tại)\b/i

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line.length >= 2 && line.length <= 70 && !bullet.test(lines[i]!) && date.test(line)) {
      boundaries.push(i)
    }
  }
  if (boundaries.length < 2) {
    for (let i = 1; i < lines.length; i++) if (bullet.test(lines[i]!)) boundaries.push(i)
  }
  if (boundaries.length < 2) return [trimmed]

  const prefix = lines.slice(0, boundaries[0]!).join('\n')
  const chunks: string[] = []
  let current = ''
  for (let i = 0; i < boundaries.length; i++) {
    const group = lines.slice(boundaries[i]!, boundaries[i + 1] ?? lines.length).join('\n')
    const candidate = current ? `${current}\n${group}` : group
    if (current && candidate.length > maxChars) {
      chunks.push(`${prefix}\n${current}`)
      current = group
    } else {
      current = candidate
    }
  }
  if (current) chunks.push(`${prefix}\n${current}`)
  return chunks.length > 0 ? chunks : [trimmed]
}
