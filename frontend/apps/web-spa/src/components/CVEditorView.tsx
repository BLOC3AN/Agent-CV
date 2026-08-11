import React, { useState } from 'react';
import { CV, CVDesign, CVLayout, LayoutNode } from '../types';
import {
  Check,
} from 'lucide-react';
import { PaginatedA4Document } from './PaginatedA4Document';
import { ComponentTree } from './ComponentTree';
import { CVBlockRenderer } from './CVBlockRenderer';
import { hasDefaultNodeOrder, materializeItemOrder, moveItem, moveNode, normalizeLayout, resetDefaultLayout, setNodeVisible } from '../lib/layout-draft';
import { CV_FIELDS } from '../lib/cv-fields';
import { InlineCVEditor } from './InlineCVEditor';
import { cvTypographyStyle, resolveCVTypography } from '../lib/cv-typography';
import { VersionHistoryPanel } from './VersionHistoryPanel';

interface CVEditorViewProps {
  cv: CV;
  layout?: CVLayout;
  onUpdateCV: (updatedCV: CV) => void;
  onUpdateLayout?: (layout: CVLayout) => void;
  onSave?: () => void;
  onDiscard?: () => void;
  dirty?: boolean;
  saving?: boolean;
  onOpenPreview: () => void;
  onOpenShare: () => void;
  /** @deprecated PDF download is owned by the global editor header. */
  onDownloadPDF?: () => void | Promise<void>;
  cvId?: string;
  onRestoreVersion?: (revisionId: string) => Promise<void>;
}

type InlineTarget = { node: LayoutNode; itemId?: string };

export const CVEditorView: React.FC<CVEditorViewProps> = ({
  cv,
  layout: providedLayout,
  onUpdateCV,
  onUpdateLayout,
  onSave,
  onDiscard,
  dirty = false,
  saving = false,
  onOpenPreview,
  onOpenShare,
  cvId,
  onRestoreVersion,
}) => {
  // Navigation & Edit state
  const [activeTab, setActiveTab] = useState<'SECTIONS' | 'DESIGN'>('SECTIONS');
  const [inlineTarget, setInlineTarget] = useState<InlineTarget | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyInvokerRef = React.useRef<HTMLButtonElement>(null);
  const layout = normalizeLayout(providedLayout ?? cv.layout);

  const openInlineEditor = (nodeId: string, itemId?: string) => {
    const node = layout.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    setSelectedNodeId(node.id);
    setInlineTarget({ node, itemId });
  };

  const itemIdsFor = (nodeId: string): string[] => {
    if (nodeId === 'experience') return cv.sections.experience.map((item) => item.id);
    if (nodeId === 'projects') return cv.sections.projects.map((item) => item.id);
    if (nodeId === 'education') return cv.sections.education.map((item) => item.id);
    if (nodeId === 'skills') return cv.sections.skills.map((item) => item.id);
    if (nodeId === 'activities') return cv.sections.activities.map((item) => item.id);
    if (nodeId === 'certifications') return cv.sections.certifications.map((item) => item.id);
    if (nodeId === 'languages') return cv.sections.languages.map((item) => item.id);
    return [];
  };

  const updateLayout = (next: CVLayout) => onUpdateLayout?.(next);

  // Update Design props
  const updateDesign = (field: keyof CVDesign, value: any) => {
    onUpdateCV({
      ...cv,
      design: {
        ...cv.design,
        [field]: value,
      },
    });
  };

  // Color options
  const colorOptions = [
    { name: 'Teal', hex: '#00897B' },
    { name: 'Blue', hex: '#2563EB' },
    { name: 'Indigo', hex: '#4F46E5' },
    { name: 'Purple', hex: '#7C3AED' },
    { name: 'Orange', hex: '#EA580C' },
  ];

  return (
    <div aria-hidden={historyOpen ? 'true' : undefined} data-testid="cv-editor" className="flex flex-1 h-[calc(100vh-4rem)] overflow-hidden bg-slate-100">
      {/* 1. Left Control Panel */}
      <div className="w-80 bg-white border-r border-slate-200/80 flex flex-col shrink-0 z-10 shadow-xs">
        {/* Sub-header Tabs: SECTIONS vs DESIGN */}
        <div className="flex border-b border-slate-200 bg-slate-50/80 p-1 gap-1">
          <button
            onClick={() => setActiveTab('SECTIONS')}
            id="tab-sections"
            className={`flex-1 py-2 text-center text-xs font-semibold rounded-lg transition ${
              activeTab === 'SECTIONS'
                ? 'bg-white text-indigo-600 shadow-2xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Nội dung (Sections)
          </button>
          <button
            onClick={() => setActiveTab('DESIGN')}
            id="tab-design"
            className={`flex-1 py-2 text-center text-xs font-semibold rounded-lg transition ${
              activeTab === 'DESIGN'
                ? 'bg-white text-indigo-600 shadow-2xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Thiết kế (Design)
          </button>
        </div>

        {dirty && <p role="status" className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800">Bản nháp chưa lưu</p>}

        {(onSave || onDiscard) && (
          <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
            {onDiscard && (
              <button
                type="button"
                onClick={onDiscard}
                disabled={!dirty || saving}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Bỏ thay đổi
              </button>
            )}
            {onSave && (
              <button
                type="button"
                onClick={onSave}
                disabled={!dirty || saving}
                className="ml-auto rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
              </button>
            )}
            {cvId && onRestoreVersion && (
              <button
                type="button"
                ref={historyInvokerRef}
                onClick={() => setHistoryOpen(true)}
                disabled={saving}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Lịch sử phiên bản
              </button>
            )}
          </div>
        )}

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeTab === 'SECTIONS' ? (
            <div className="space-y-4">
              <section aria-label="Bố cục CV" className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Bố cục CV</h3>
                  <button
                    type="button"
                    onClick={() => updateLayout(resetDefaultLayout(layout))}
                    disabled={hasDefaultNodeOrder(layout)}
                    className="rounded-md px-2 py-1 text-[10px] font-semibold text-indigo-600 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    Đặt lại mặc định
                  </button>
                </div>
                {!hasDefaultNodeOrder(layout) && <p className="rounded-md bg-amber-50 px-2 py-1 text-[10px] leading-relaxed text-amber-700">Thứ tự này khác bố cục CV tiêu chuẩn. Nội dung vẫn được in theo đúng thứ tự đang chọn.</p>}
                <ComponentTree
                  cv={cv}
                  layout={layout}
                  selectedNodeId={selectedNodeId}
                  onMoveNode={(nodeId, beforeNodeId) => updateLayout(moveNode(layout, nodeId, beforeNodeId))}
                  onMoveItem={(nodeId, itemId, beforeItemId) => updateLayout(moveItem(materializeItemOrder(layout, nodeId, itemIdsFor(nodeId)), nodeId, itemId, beforeItemId))}
                  onSetNodeVisible={(nodeId, visible) => updateLayout(setNodeVisible(layout, nodeId, visible))}
                  onSelect={(nodeId) => setSelectedNodeId(nodeId)}
                  onEdit={openInlineEditor}
                />
              </section>

              {inlineTarget && <InlineCVEditor
                key={`${inlineTarget.node.id}:${inlineTarget.itemId ?? 'node'}`}
                node={inlineTarget.node}
                item={inlineTarget.itemId ? { id: inlineTarget.itemId } : undefined}
                fieldDefinitions={CV_FIELDS}
                draft={cv}
                onDraftChange={onUpdateCV}
                onClose={() => setInlineTarget(null)}
              />}
            </div>
          ) : (
            /* DESIGN TAB */
            <div className="space-y-5 text-xs">
              {/* Template Picker */}
              <div className="space-y-2">
                <label className="block font-semibold text-slate-700 uppercase tracking-wider text-[11px]">
                  Mẫu CV (Template)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {['modern', 'classic', 'professional'].map((tpl) => (
                    <button
                      key={tpl}
                      onClick={() => updateDesign('template', tpl)}
                      className={`p-2 rounded-xl border text-xs font-semibold capitalize text-center transition ${
                        cv.design.template === tpl
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                          : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      {tpl}
                    </button>
                  ))}
                </div>
              </div>

              {/* Accent Color */}
              <div className="space-y-2">
                <label className="block font-semibold text-slate-700 uppercase tracking-wider text-[11px]">
                  Màu chủ đạo
                </label>
                <div className="flex items-center space-x-3">
                  {colorOptions.map((c) => (
                    <button
                      key={c.hex}
                      onClick={() => updateDesign('accentColor', c.hex)}
                      className={`w-7 h-7 rounded-full border border-slate-300 transition transform hover:scale-105 flex items-center justify-center ${
                        cv.design.accentColor === c.hex
                          ? 'ring-2 ring-offset-2 ring-indigo-600'
                          : ''
                      }`}
                      style={{ backgroundColor: c.hex }}
                      title={c.name}
                    >
                      {cv.design.accentColor === c.hex && (
                        <Check className="w-3.5 h-3.5 text-white stroke-[3]" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Font */}
              <div className="space-y-2">
                <label htmlFor="cv-font" className="block font-semibold text-slate-700 uppercase tracking-wider text-[11px]">
                  Font chữ
                </label>
                <select
                  id="cv-font"
                  aria-label="Font chữ"
                  value={cv.design.font}
                  onChange={(e) => updateDesign('font', e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-indigo-500"
                >
                  <option value="Auto">Auto (Calibri)</option>
                  <option value="Calibri">Calibri</option>
                  <option value="Arial">Arial</option>
                  <option value="Times New Roman">Times New Roman</option>
                  <option value="Roboto">Roboto</option>
                  <option value="Open Sans">Open Sans</option>
                  <option value="Lato">Lato</option>
                </select>
              </div>

              {([
                ['bodyFontSize', 'Cỡ chữ nội dung', 9, 14],
                ['sectionTitleFontSize', 'Cỡ tiêu đề section', 10, 16],
                ['headerFontSize', 'Cỡ header', 16, 28],
              ] as const).map(([field, label, min, max]) => {
                const typography = resolveCVTypography(cv.design)
                const value = field === 'bodyFontSize' ? typography.bodyFontSize : field === 'sectionTitleFontSize' ? typography.sectionTitleFontSize : typography.headerFontSize
                return <div className="space-y-2" key={field}>
                  <div className="flex justify-between text-xs font-semibold text-slate-700">
                    <label htmlFor={`cv-${field}`}>{label}</label>
                    <span className="text-indigo-600 font-bold">{value}pt</span>
                  </div>
                  <input id={`cv-${field}`} aria-label={label} type="range" min={min} max={max} step="0.5" value={value} onChange={(e) => updateDesign(field, parseFloat(e.target.value))} className="w-full accent-indigo-600 cursor-pointer" />
                </div>
              })}

              {/* Spacing Slider */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-semibold text-slate-700">
                  <span>Khoảng cách dòng</span>
                  <span className="text-indigo-600 font-bold capitalize">
                    {cv.design.spacing}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {['condensed', 'normal', 'wide'].map((sp) => (
                    <button
                      key={sp}
                      onClick={() => updateDesign('spacing', sp)}
                      className={`p-2 rounded-xl border text-xs font-semibold uppercase text-center transition ${
                        cv.design.spacing === sp
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {sp}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2. Middle - A4 Live Paper Preview */}
      <div className="flex-1 overflow-y-auto p-6 md:p-10 flex justify-center bg-slate-100/90 custom-scrollbar">
        <PaginatedA4Document
          id="a4-cv-paper"
          className="cv-font-surface transition-all duration-300 print:shadow-none print:m-0"
          contentClassName="px-[20mm] py-[24mm]"
          style={{
            ...cvTypographyStyle(cv.design),
            lineHeight: cv.design.spacing === 'condensed' ? '1.4' : cv.design.spacing === 'wide' ? '1.8' : '1.6',
          }}
        >
          <CVBlockRenderer cv={cv} layout={layout} variant="editor" onSelect={setSelectedNodeId} onEdit={openInlineEditor} />
        </PaginatedA4Document>
      </div>

      {historyOpen && cvId && onRestoreVersion && <VersionHistoryPanel cvId={cvId} dirty={dirty} returnFocusRef={historyInvokerRef} onClose={() => setHistoryOpen(false)} onRestore={onRestoreVersion} />}

    </div>
  );
};
