import React, { useState } from 'react';
import { CV, CVDesign, CVLayout, LayoutNode } from '../types';
import {
  Edit2,
  X,
  Check,
} from 'lucide-react';
import { PaginatedA4Document } from './PaginatedA4Document';
import { ComponentTree } from './ComponentTree';
import { CVBlockRenderer } from './CVBlockRenderer';
import { hasDefaultNodeOrder, materializeItemOrder, moveItem, moveNode, normalizeLayout, resetDefaultLayout, setNodeVisible } from '../lib/layout-draft';
import { CV_FIELDS } from '../lib/cv-fields';
import { InlineCVEditor } from './InlineCVEditor';
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
  onDownloadPDF: () => void | Promise<void>;
  cvId?: string;
  onRestoreVersion?: (revisionId: string) => Promise<void>;
}

/**
 * Ba mục có `highlights: string[]` — chỉ khay sửa "Kinh nghiệm làm việc"
 * đang có giao diện chỉnh sửa từng dòng (Task 8); dự án/hoạt động dùng chung
 * kiểu này để SP-3/SP-4 nối chat vào không phải đổi type lần nữa.
 */
type BulletSection = 'experience' | 'projects' | 'activities';
type InlineTarget = { node: LayoutNode; itemId?: string };

function mapHighlights(
  cv: CV,
  section: BulletSection,
  index: number,
  fn: (lines: string[]) => string[],
): CV {
  const items = cv.sections[section].map((item, i) =>
    i === index ? { ...item, highlights: fn(item.highlights) } : item,
  );
  return { ...cv, sections: { ...cv.sections, [section]: items } };
}

const setHighlight = (cv: CV, s: BulletSection, idx: number, line: number, value: string) =>
  mapHighlights(cv, s, idx, (lines) => lines.map((l, i) => (i === line ? value : l)));

const removeHighlight = (cv: CV, s: BulletSection, idx: number, line: number) =>
  mapHighlights(cv, s, idx, (lines) => lines.filter((_, i) => i !== line));

const addHighlight = (cv: CV, s: BulletSection, idx: number) =>
  mapHighlights(cv, s, idx, (lines) => [...lines, '']);

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
  onDownloadPDF,
  cvId,
  onRestoreVersion,
}) => {
  // Navigation & Edit state
  const [activeTab, setActiveTab] = useState<'SECTIONS' | 'DESIGN'>('SECTIONS');
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [inlineTarget, setInlineTarget] = useState<InlineTarget | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyInvokerRef = React.useRef<HTMLButtonElement>(null);
  const layout = normalizeLayout(providedLayout ?? cv.layout);

  const editNode = (nodeId: string) => {
    const section = nodeId === 'header' || nodeId === 'summary' ? 'intro' : nodeId;
    if (section !== 'footer') setEditingSection(section);
  };

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
    return [];
  };

  const updateLayout = (next: CVLayout) => onUpdateLayout?.(next);

  const downloadPDF = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await onDownloadPDF();
    } catch {
      setExportError('Không thể chuẩn bị PDF. Bản nháp chưa được xuất.');
    } finally {
      setExporting(false);
    }
  };

  // Toggle active sections in CV
  const toggleSectionActive = (sectionKey: keyof typeof cv.activeSections) => {
    onUpdateCV({
      ...cv,
      activeSections: {
        ...cv.activeSections,
        [sectionKey]: !cv.activeSections[sectionKey],
      },
    });
  };

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
            <button
              type="button"
              onClick={() => void downloadPDF()}
              disabled={exporting || saving}
              className="rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting ? 'Đang chuẩn bị PDF…' : 'Tải PDF'}
            </button>
          </div>
        )}
        {exportError && <p role="alert" className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700">{exportError}</p>}

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeTab === 'SECTIONS' ? (
            <div className="space-y-4">
              {/* Sections list with checks and edit icons */}
              <div className="space-y-2">
                {[
                  { key: 'intro', label: 'Thông tin cá nhân' },
                  { key: 'experience', label: 'Kinh nghiệm làm việc' },
                  { key: 'projects', label: 'Dự án nổi bật' },
                  { key: 'education', label: 'Học vấn & Bằng cấp' },
                  { key: 'skills', label: 'Kỹ năng & Công nghệ' },
                  { key: 'activities', label: 'Hoạt động & Ngoại khóa' },
                  { key: 'certifications', label: 'Chứng chỉ chuyên môn' },
                  { key: 'languages', label: 'Ngoại ngữ' },
                ].map((item) => {
                  const key = item.key as keyof typeof cv.activeSections;
                  const isActive = cv.activeSections[key];

                  return (
                    <div
                      key={key}
                      className={`flex items-center justify-between p-2.5 rounded-xl border transition ${
                        editingSection === key
                          ? 'bg-indigo-50/70 border-indigo-200'
                          : 'bg-white border-slate-200/80 hover:border-slate-300'
                      }`}
                    >
                      <div
                        onClick={() => toggleSectionActive(key)}
                        className="flex items-center space-x-2.5 cursor-pointer flex-1 select-none"
                      >
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center transition ${
                            isActive
                              ? 'bg-emerald-500 border-emerald-500 text-white'
                              : 'bg-slate-100 border-slate-300 text-transparent'
                          }`}
                        >
                          <Check className="w-3 h-3 stroke-[3]" />
                        </div>
                        <span
                          className={`text-xs font-medium ${
                            isActive ? 'text-slate-800' : 'text-slate-400 line-through'
                          }`}
                        >
                          {item.label}
                        </span>
                      </div>

                      <button
                        onClick={() => setEditingSection(editingSection === key ? null : key)}
                        className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition"
                        title="Chỉnh sửa phần này"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

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

              {/* Inline Form Editor Drawer for Selected Section */}
              {editingSection && (
                <div className="mt-4 p-4 bg-slate-50 rounded-2xl border border-slate-200 shadow-2xs space-y-3 animate-fade-in">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Chỉnh sửa: {editingSection}
                    </h4>
                    <button
                      onClick={() => setEditingSection(null)}
                      className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-200/60"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {editingSection === 'intro' && (
                    <div className="space-y-2.5 text-xs">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 uppercase mb-1">Họ và tên</label>
                        <input
                          type="text"
                          value={cv.sections.intro.fullName}
                          onChange={(e) =>
                            onUpdateCV({
                              ...cv,
                              sections: {
                                ...cv.sections,
                                intro: { ...cv.sections.intro, fullName: e.target.value },
                              },
                            })
                          }
                          className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:border-indigo-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 uppercase mb-1">Chức danh / Title</label>
                        <input
                          type="text"
                          value={cv.sections.intro.title}
                          onChange={(e) =>
                            onUpdateCV({
                              ...cv,
                              sections: {
                                ...cv.sections,
                                intro: { ...cv.sections.intro, title: e.target.value },
                              },
                            })
                          }
                          className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:border-indigo-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 uppercase mb-1">Email</label>
                        <input
                          type="text"
                          value={cv.sections.intro.email}
                          onChange={(e) =>
                            onUpdateCV({
                              ...cv,
                              sections: {
                                ...cv.sections,
                                intro: { ...cv.sections.intro, email: e.target.value },
                              },
                            })
                          }
                          className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:border-indigo-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 uppercase mb-1">Giới thiệu bản thân</label>
                        <textarea
                          rows={3}
                          value={cv.sections.intro.summary}
                          onChange={(e) =>
                            onUpdateCV({
                              ...cv,
                              sections: {
                                ...cv.sections,
                                intro: { ...cv.sections.intro, summary: e.target.value },
                              },
                            })
                          }
                          className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>
                  )}

                  {editingSection === 'experience' && (
                    <div className="space-y-3 text-xs">
                      {cv.sections.experience.map((exp, idx) => {
                        /*
                         * Tên hỗ trợ tiếp cận (aria-label) của các nút gạch đầu dòng bên dưới
                         * PHẢI phân biệt được từng mục, không chỉ từng dòng — khay này hiện
                         * TẤT CẢ các mục kinh nghiệm cùng lúc, nên chỉ số dòng một mình sẽ
                         * trùng giữa các mục (mục 1 và mục 2 đều có "dòng 1"). `idx` (chỉ số
                         * mục, luôn khác nhau) đứng đầu để đảm bảo phân biệt tuyệt đối; tiêu
                         * đề công việc (`exp.title`) chỉ là gợi ý đọc thêm — không dùng để
                         * đảm bảo tính duy nhất, vì hai mục có thể trùng tiêu đề (dữ liệu mẫu
                         * có hai vị trí đều tên "AI Engineer").
                         */
                        const itemLabel = `mục ${idx + 1}${exp.title ? ` (${exp.title})` : ''}`;
                        return (
                          <div key={exp.id} className="p-3 bg-white rounded-xl border border-slate-200 space-y-2 shadow-2xs">
                            <input
                              type="text"
                              placeholder="Vị trí"
                              value={exp.title}
                              onChange={(e) => {
                                const updated = [...cv.sections.experience];
                                updated[idx].title = e.target.value;
                                onUpdateCV({ ...cv, sections: { ...cv.sections, experience: updated } });
                              }}
                              className="w-full p-1.5 border border-slate-200 rounded font-bold text-xs focus:outline-none focus:border-indigo-500"
                            />
                            <input
                              type="text"
                              placeholder="Công ty"
                              value={exp.company}
                              onChange={(e) => {
                                const updated = [...cv.sections.experience];
                                updated[idx].company = e.target.value;
                                onUpdateCV({ ...cv, sections: { ...cv.sections, experience: updated } });
                              }}
                              className="w-full p-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:border-indigo-500"
                            />
                            <div className="flex flex-col gap-2">
                              {exp.highlights.map((line, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    aria-label={`Gạch đầu dòng ${i + 1} — ${itemLabel}`}
                                    value={line}
                                    onChange={(e) =>
                                      onUpdateCV(setHighlight(cv, 'experience', idx, i, e.target.value))
                                    }
                                    className="flex-1 p-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:border-indigo-500"
                                  />
                                  <button
                                    type="button"
                                    aria-label={`Xoá gạch đầu dòng ${i + 1} — ${itemLabel}`}
                                    onClick={() => onUpdateCV(removeHighlight(cv, 'experience', idx, i))}
                                    className="text-slate-400 hover:text-red-600"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                              <button
                                type="button"
                                aria-label={`Thêm gạch đầu dòng — ${itemLabel}`}
                                onClick={() => onUpdateCV(addHighlight(cv, 'experience', idx))}
                                className="self-start text-[11px] font-semibold text-indigo-600 hover:text-indigo-700"
                              >
                                + Thêm gạch đầu dòng
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {editingSection !== 'intro' && editingSection !== 'experience' && (
                    <p className="text-xs text-slate-500 italic">
                      Đang chỉnh sửa dữ liệu của {editingSection}. Các thay đổi hiển thị thời gian thực trên bản A4.
                    </p>
                  )}
                </div>
              )}
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
                <label className="block font-semibold text-slate-700 uppercase tracking-wider text-[11px]">
                  Font chữ
                </label>
                <select
                  value={cv.design.font}
                  onChange={(e) => updateDesign('font', e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-indigo-500"
                >
                  <option value="Roboto">Roboto</option>
                  <option value="Open Sans">Open Sans</option>
                  <option value="Lato">Lato</option>
                </select>
              </div>

              {/* Font Size Slider */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-semibold text-slate-700">
                  <span>Cỡ chữ</span>
                  <span className="text-indigo-600 font-bold">{cv.design.fontSize}px</span>
                </div>
                <input
                  type="range"
                  min="12"
                  max="20"
                  value={cv.design.fontSize}
                  onChange={(e) => updateDesign('fontSize', parseInt(e.target.value))}
                  className="w-full accent-indigo-600 cursor-pointer"
                />
              </div>

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
          className="transition-all duration-300 print:shadow-none print:m-0"
          contentClassName="px-[20mm] py-[24mm]"
          style={{
            fontFamily:
              cv.design.font === 'Roboto'
                ? 'Roboto, sans-serif'
                : cv.design.font === 'Lato'
                ? 'Lato, sans-serif'
                : 'Open Sans, sans-serif',
            fontSize: `${cv.design.fontSize}px`,
            lineHeight: cv.design.spacing === 'condensed' ? '1.4' : cv.design.spacing === 'wide' ? '1.8' : '1.6',
          }}
        >
          <CVBlockRenderer cv={cv} layout={layout} variant="editor" onSelect={setSelectedNodeId} onEdit={openInlineEditor} />
        </PaginatedA4Document>
      </div>

      {historyOpen && cvId && onRestoreVersion && <VersionHistoryPanel cvId={cvId} returnFocusRef={historyInvokerRef} onClose={() => setHistoryOpen(false)} onRestore={onRestoreVersion} />}

    </div>
  );
};
