import { z } from 'zod'

export const CVNodeTypeSchema = z.enum([
  'header',
  'summary',
  'experience',
  'projects',
  'education',
  'skills',
  'activities',
  'certifications',
  'languages',
  'footer',
])

/** A node is ordered by the array position; no pixel coordinates are persisted. */
const nodeBase = {
  id: z.string(),
  visible: z.boolean(),
}

const simpleNode = (type: Exclude<CVNodeType, 'experience' | 'projects' | 'education'>) =>
  z.object({ ...nodeBase, type: z.literal(type) }).strict()

const itemNode = (type: 'experience' | 'projects' | 'education') =>
  z.object({ ...nodeBase, type: z.literal(type), itemOrder: z.array(z.string()).optional() }).strict()

export const LayoutNodeSchema = z.discriminatedUnion('type', [
  simpleNode('header'),
  simpleNode('summary'),
  itemNode('experience'),
  itemNode('projects'),
  itemNode('education'),
  simpleNode('skills'),
  simpleNode('activities'),
  simpleNode('certifications'),
  simpleNode('languages'),
  simpleNode('footer'),
])

export const CVLayoutSchema = z
  .object({
    version: z.literal(1),
    nodes: z.array(LayoutNodeSchema),
  })
  .strict()
  .superRefine((layout, context) => {
    const seen = new Set<string>()
    for (const node of layout.nodes) {
      if (node.id !== node.type) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes'], message: `Node ${node.type} must use canonical id ${node.type}` })
      }
      if (seen.has(node.type)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes'], message: `Duplicate node type: ${node.type}` })
      }
      seen.add(node.type)
      if ('itemOrder' in node && node.itemOrder && new Set(node.itemOrder).size !== node.itemOrder.length) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes'], message: `Duplicate item reference in ${node.type}` })
      }
    }
    for (const type of CVNodeTypeSchema.options) {
      if (!seen.has(type)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes'], message: `Missing canonical node: ${type}` })
      }
    }
  })

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

export const CV_FIELD_CATALOG: CVFieldDefinition[] = [
  { key: 'role', label: 'Role', valueType: 'text', allowedIn: ['experience', 'projects'], printStyle: 'inline' },
  { key: 'company', label: 'Company', valueType: 'text', allowedIn: ['experience'], printStyle: 'inline' },
  { key: 'time', label: 'Time', valueType: 'date', allowedIn: ['experience', 'projects', 'education'], printStyle: 'date-range' },
  { key: 'teamSize', label: 'Team size', valueType: 'text', allowedIn: ['experience', 'projects'], printStyle: 'inline' },
  { key: 'techStack', label: 'Tech stack', valueType: 'tag-list', allowedIn: ['experience', 'projects'], printStyle: 'tags' },
  { key: 'highlights', label: 'Highlights', valueType: 'multiline', allowedIn: ['experience', 'projects'], printStyle: 'block' },
  { key: 'name', label: 'Name', valueType: 'text', allowedIn: ['projects'], printStyle: 'inline' },
  { key: 'contribution', label: 'Contribution', valueType: 'multiline', allowedIn: ['projects'], printStyle: 'block' },
  { key: 'careerObjective', label: 'Career objective', valueType: 'multiline', allowedIn: ['header', 'summary'], printStyle: 'block' },
  { key: 'availability', label: 'Availability', valueType: 'text', allowedIn: ['header', 'summary'], printStyle: 'inline' },
  { key: 'location', label: 'Location', valueType: 'text', allowedIn: ['header', 'summary'], printStyle: 'inline' },
  { key: 'school', label: 'School', valueType: 'text', allowedIn: ['education'], printStyle: 'inline' },
  { key: 'degree', label: 'Degree', valueType: 'text', allowedIn: ['education'], printStyle: 'inline' },
  { key: 'field', label: 'Field', valueType: 'text', allowedIn: ['education'], printStyle: 'inline' },
  { key: 'gpa', label: 'GPA', valueType: 'text', allowedIn: ['education'], printStyle: 'inline' },
]

const CV_FIELD_KEYS = CV_FIELD_CATALOG.map(({ key }) => key) as [string, ...string[]]
export const CVFieldKeySchema = z.enum(CV_FIELD_KEYS)
export const CVFieldDefinitionSchema = z.object({
  key: CVFieldKeySchema,
  label: z.string(),
  valueType: z.enum(['text', 'multiline', 'date', 'tag-list']),
  allowedIn: z.array(CVNodeTypeSchema),
  printStyle: z.enum(['inline', 'block', 'date-range', 'tags']),
}).strict()

export const CVFieldPlacementSchema = z.object({
  key: CVFieldKeySchema,
  nodeType: CVNodeTypeSchema,
}).superRefine(({ key, nodeType }, context) => {
  const definition = CV_FIELD_CATALOG.find((field) => field.key === key)
  if (!definition?.allowedIn.includes(nodeType)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `Field ${key} is not allowed in ${nodeType}` })
  }
})

export function validateCVFieldPlacement(key: unknown, nodeType: unknown): CVFieldDefinition {
  const placement = CVFieldPlacementSchema.parse({ key, nodeType })
  const definition = CV_FIELD_CATALOG.find((field) => field.key === placement.key)
  if (!definition) throw new Error(`Unknown CV field: ${String(key)}`)
  return definition
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
    { id: 'activities', type: 'activities', visible: true },
    { id: 'certifications', type: 'certifications', visible: true },
    { id: 'languages', type: 'languages', visible: true },
    { id: 'footer', type: 'footer', visible: true },
  ],
}
