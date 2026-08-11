import { CV_FIELDS, validateCVFieldPlacement } from '../lib/cv-fields'
import { useLocale } from '../lib/i18n'
import type { CVFieldDefinition, LayoutNode } from '../types'

interface FieldCatalogProps {
  node: LayoutNode
  fieldDefinitions: readonly CVFieldDefinition[]
  selectedKeys: readonly string[]
  onAdd: (key: string, targetNode: LayoutNode) => void
}

/** Lists only registered, placement-valid fields; callers receive the target node too. */
export function FieldCatalog({ node, fieldDefinitions, selectedKeys, onAdd }: FieldCatalogProps) {
  const { t } = useLocale()
  const fields = fieldDefinitions.flatMap((candidate) => {
    const registered = CV_FIELDS.find((field) => field.key === candidate.key)
    if (!registered || selectedKeys.includes(registered.key)) return []
    try {
      return validateCVFieldPlacement(registered.key, node.type).key === registered.key ? [registered] : []
    } catch {
      return []
    }
  })

  if (!fields.length) return null
  return <section aria-label={t('addRegisteredField')} className="border-t border-slate-200 pt-3">
    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t('addField')}</p>
    <div className="flex flex-wrap gap-1.5">
      {fields.map((field) => <button key={field.key} type="button" onClick={() => onAdd(field.key, node)} className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100">Thêm {field.label}</button>)}
    </div>
  </section>
}
