import { z } from 'zod'

export const CVNodeTypeSchema = z.enum([
  'header',
  'summary',
  'experience',
  'projects',
  'education',
  'skills',
  'certifications',
  'languages',
  'footer',
])

/** A node is ordered by the array position; no pixel coordinates are persisted. */
export const LayoutNodeSchema = z
  .object({
    id: z.string(),
    type: CVNodeTypeSchema,
    visible: z.boolean(),
    itemOrder: z.array(z.string()).optional(),
  })
  .strict()

export const CVLayoutSchema = z
  .object({
    version: z.literal(1),
    nodes: z.array(LayoutNodeSchema),
  })
  .strict()

export type CVNodeType = z.infer<typeof CVNodeTypeSchema>
export type LayoutNode = z.infer<typeof LayoutNodeSchema>
export type CVLayout = z.infer<typeof CVLayoutSchema>

export type CVFieldValueType = 'text' | 'multiline' | 'date' | 'tag-list'
export type CVFieldPrintStyle = 'inline' | 'block' | 'date-range' | 'tags'

export interface CVFieldDefinition {
  key: string
  label: string
  valueType: CVFieldValueType
  allowedIn: CVNodeType[]
  printStyle: CVFieldPrintStyle
}

export const DEFAULT_CV_LAYOUT: CVLayout = {
  version: 1,
  nodes: [
    { id: 'header', type: 'header', visible: true },
    { id: 'summary', type: 'summary', visible: true },
    { id: 'experience', type: 'experience', visible: true },
    { id: 'projects', type: 'projects', visible: true },
    { id: 'education', type: 'education', visible: true },
    { id: 'skills', type: 'skills', visible: true },
    { id: 'certifications', type: 'certifications', visible: true },
    { id: 'languages', type: 'languages', visible: true },
    { id: 'footer', type: 'footer', visible: true },
  ],
}
