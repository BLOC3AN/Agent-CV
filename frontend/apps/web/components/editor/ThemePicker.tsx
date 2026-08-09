'use client'

import { TEMPLATES, TEMPLATE_IDS, type TemplateId } from '@hr/templates'
import { useEditor } from '@/lib/editor-store'

/**
 * Chọn mẫu + tinh chỉnh theme — UC-31, mức A (FRONTEND.md §12).
 *
 * BR-31.1: chỉ theme token + thứ tự mục. KHÔNG đặt phần tử theo toạ độ —
 * layout phải mô tả bằng cấu trúc để AI vẫn sửa được (TDD A2).
 */

const ACCENTS = [
  { hex: '#1f4e79', name: 'Xanh navy' },
  { hex: '#111827', name: 'Đen' },
  { hex: '#0f766e', name: 'Xanh ngọc' },
  { hex: '#7c2d12', name: 'Nâu đỏ' },
  { hex: '#4c1d95', name: 'Tím' },
]

export function ThemePicker({ showTemplate = false }: { showTemplate?: boolean } = {}) {
  const theme = useEditor((s) => s.theme)
  const setTheme = useEditor((s) => s.setTheme)
  const templateId = useEditor((s) => s.templateId)
  const setTemplate = useEditor((s) => s.setTemplate)

  return (
    <div className="builder-theme-picker flex flex-col gap-3 px-2 text-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Trình bày
      </h2>

      {showTemplate && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">Mẫu</span>
          <select
            value={templateId}
            onChange={(e) => setTemplate(e.target.value as TemplateId)}
            className="rounded-md border border-border-strong px-2 py-1"
          >
            {TEMPLATE_IDS.map((id) => (
              <option key={id} value={id}>
                {TEMPLATES[id].name.vi}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-xs text-ink-muted">Màu nhấn</span>
        <div className="flex gap-1.5">
          {ACCENTS.map((a) => (
            <button
              key={a.hex}
              type="button"
              title={a.name}
              aria-label={`Màu nhấn ${a.name}`}
              aria-pressed={theme.accent === a.hex}
              onClick={() => setTheme({ accent: a.hex })}
              className={`h-6 w-6 rounded-full border-2 ${
                theme.accent === a.hex ? 'border-ink' : 'border-transparent'
              }`}
              style={{ background: a.hex }}
            />
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-muted">
          Cỡ chữ · {Math.round((theme.scale ?? 1) * 100)}%
        </span>
        <input
          type="range" min={0.85} max={1.15} step={0.05}
          value={theme.scale ?? 1}
          onChange={(e) => setTheme({ scale: Number(e.target.value) })}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-muted">Giãn dòng</span>
        <input
          type="range" min={1.3} max={1.8} step={0.05}
          value={theme.lineHeight ?? 1.5}
          onChange={(e) => setTheme({ lineHeight: Number(e.target.value) })}
        />
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={theme.showDividers ?? true}
          onChange={(e) => setTheme({ showDividers: e.target.checked })}
        />
        <span className="text-xs">Gạch chân tiêu đề mục</span>
      </label>
    </div>
  )
}
