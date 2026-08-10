import { z } from 'zod'

export const LanguageSchema = z.enum(['vi', 'en'])
export type Language = z.infer<typeof LanguageSchema>
