import { ProfileSchema, type Profile } from '@hr/schema'

/**
 * Old imported documents may contain one extra array around a bullet point
 * (for example `highlights: [["..."]]`). Keep the stored data untouched, but
 * normalize this legacy shape at the server/render boundary so one malformed
 * imported row cannot blank the builder.
 */
export function parseStoredProfile(value: unknown): Profile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ProfileSchema.parse(value)
  }

  const data = structuredClone(value) as Record<string, unknown>
  for (const section of ['education', 'work', 'projects', 'activities']) {
    const items = data[section]
    if (!Array.isArray(items)) continue
    data[section] = items.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item
      const next = { ...(item as Record<string, unknown>) }
      for (const key of ['highlights', 'tech']) {
        const entries = next[key]
        if (Array.isArray(entries)) next[key] = entries.flat(Infinity).map(String)
      }
      return next
    })
  }

  return ProfileSchema.parse(data)
}
