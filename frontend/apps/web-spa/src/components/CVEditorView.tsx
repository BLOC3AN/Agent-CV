import React, { useState } from 'react';
import { CV, CVDesign } from '../types';
import {
  CheckCircle2,
  Edit2,
  Plus,
  ArrowUpDown,
  X,
  SlidersHorizontal,
  Layers,
  Check,
} from 'lucide-react';
import { PaginatedA4Document } from './PaginatedA4Document';

interface CVEditorViewProps {
  cv: CV;
  onUpdateCV: (updatedCV: CV) => void;
  onOpenPreview: () => void;
  onOpenShare: () => void;
  onDownloadPDF: () => void;
}

/**
 * Ba mục có `highlights: string[]` — chỉ khay sửa "Kinh nghiệm làm việc"
 * đang có giao diện chỉnh sửa từng dòng (Task 8); dự án/hoạt động dùng chung
 * kiểu này để SP-3/SP-4 nối chat vào không phải đổi type lần nữa.
 */
type BulletSection = 'experience' | 'projects' | 'activities';

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
  onUpdateCV,
  onOpenPreview,
  onOpenShare,
  onDownloadPDF,
}) => {
  // Navigation & Edit state
  const [activeTab, setActiveTab] = useState<'SECTIONS' | 'DESIGN'>('SECTIONS');
  const [editingSection, setEditingSection] = useState<string | null>(null);

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
    <div className="flex flex-1 h-[calc(100vh-4rem)] overflow-hidden bg-slate-100">
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

              {/* Action Buttons: Add Section & Reorder */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={() => alert('Đã tự động thêm các mục mở rộng!')}
                  className="px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold text-[11px] rounded-xl flex items-center justify-center space-x-1 transition"
                >
                  <Plus className="w-3.5 h-3.5 text-slate-500" />
                  <span>Thêm mục</span>
                </button>

                <button
                  onClick={() => alert('Bạn có thể kéo thả trực tiếp trên bản xem trước!')}
                  className="px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold text-[11px] rounded-xl flex items-center justify-center space-x-1 transition"
                >
                  <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
                  <span>Sắp xếp</span>
                </button>
              </div>

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
          {/* Header Section */}
          {cv.activeSections.intro && (
            <div className="mb-6 pb-4 border-b border-slate-200 relative">
              {/* Accent Left Stripe */}
              <div
                className="absolute top-0 bottom-0 left-[-20mm] w-2.5"
                style={{ backgroundColor: cv.design.accentColor }}
              ></div>

              <h1
                className="text-2xl md:text-3xl font-extrabold uppercase tracking-tight text-slate-900"
              >
                {cv.sections.intro.fullName || 'LE THANH HAI'}
              </h1>

              <p
                className="text-base font-bold mt-0.5"
                style={{ color: cv.design.accentColor }}
              >
                {cv.sections.intro.title || 'AI Engineer'}
              </p>

              <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-600 mt-2 font-medium">
                <span>{cv.sections.intro.email}</span>
                {cv.sections.intro.phone && (
                  <>
                    <span>•</span>
                    <span>{cv.sections.intro.phone}</span>
                  </>
                )}
                {cv.sections.intro.location && (
                  <>
                    <span>•</span>
                    <span>{cv.sections.intro.location}</span>
                  </>
                )}
              </div>

              {cv.sections.intro.summary && (
                <div className="mt-3 text-xs text-slate-700 leading-relaxed">
                  <h3
                    className="font-bold text-xs uppercase tracking-wider mb-1"
                    style={{ color: cv.design.accentColor }}
                  >
                    GIỚI THIỆU BẢN THÂN
                  </h3>
                  <p>{cv.sections.intro.summary}</p>
                </div>
              )}
            </div>
          )}

          {/* Experience Section */}
          {cv.activeSections.experience && cv.sections.experience.length > 0 && (
            <div className="mb-6">
              <h3
                className="font-bold text-xs uppercase tracking-wider mb-2 border-b border-slate-200 pb-1"
                style={{ color: cv.design.accentColor }}
              >
                KINH NGHIỆM LÀM VIỆC
              </h3>
              <div className="space-y-4">
                {cv.sections.experience.map((exp) => (
                  <div key={exp.id} className="space-y-1">
                    <div className="flex justify-between items-baseline">
                      <span className="font-bold text-sm text-slate-900">
                        {exp.title} — <span className="font-semibold text-slate-700">{exp.company}</span>
                      </span>
                      <span className="text-[11px] font-medium text-slate-500">
                        {exp.startDate} – {exp.endDate}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 whitespace-pre-line leading-relaxed">
                      {exp.highlights.join('\n')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Projects Section */}
          {cv.activeSections.projects && cv.sections.projects.length > 0 && (
            <div className="mb-6">
              <h3
                className="font-bold text-xs uppercase tracking-wider mb-2 border-b border-slate-200 pb-1"
                style={{ color: cv.design.accentColor }}
              >
                DỰ ÁN NỔI BẬT
              </h3>
              <div className="space-y-3">
                {cv.sections.projects.map((proj) => (
                  <div key={proj.id} className="space-y-0.5">
                    <div className="flex justify-between items-baseline">
                      <span className="font-bold text-xs text-slate-900">
                        {proj.name} ({proj.role})
                      </span>
                      <span className="text-[11px] text-slate-500 font-medium">
                        {proj.startDate} - {proj.endDate}
                      </span>
                    </div>
                    {/* Cùng cách trình bày với mục kinh nghiệm ở trên và với
                        PreviewModal: nối bằng '\n' dưới whitespace-pre-line.
                        Nối bằng ' ' làm các gạch đầu dòng dính thành một câu,
                        và đây là bản người dùng in ra PDF để gửi đi. */}
                    <p className="text-xs text-slate-700 whitespace-pre-line">
                      {proj.highlights.join('\n')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Skills Section */}
          {cv.activeSections.skills && cv.sections.skills.length > 0 && (
            <div className="mb-6">
              <h3
                className="font-bold text-xs uppercase tracking-wider mb-2 border-b border-slate-200 pb-1"
                style={{ color: cv.design.accentColor }}
              >
                KĨ NĂNG & CÔNG NGHỆ
              </h3>
              <div className="space-y-1.5 text-xs text-slate-800">
                {cv.sections.skills.map((sk) => (
                  <div key={sk.id} className="flex">
                    <span className="font-bold w-40 shrink-0 text-slate-900">
                      {sk.category}:
                    </span>
                    {/* Lưu là mảng (hợp đồng CV v2), hiển thị vẫn là một dòng
                        ngăn bằng ", " — không đổi gì về thị giác. */}
                    <span className="text-slate-700">{sk.skills.join(', ')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Education Section */}
          {cv.activeSections.education && cv.sections.education.length > 0 && (
            <div className="mb-6">
              <h3
                className="font-bold text-xs uppercase tracking-wider mb-2 border-b border-slate-200 pb-1"
                style={{ color: cv.design.accentColor }}
              >
                HỌC VẤN & BẰNG CẤP
              </h3>
              <div className="space-y-2">
                {cv.sections.education.map((edu) => (
                  <div key={edu.id} className="flex justify-between items-baseline text-xs">
                    <div>
                      <span className="font-bold text-slate-900">{edu.school}</span>
                      <p className="text-slate-700">
                        {edu.degree} - {edu.fieldOfStudy} {edu.gpa ? `(GPA: ${edu.gpa})` : ''}
                      </p>
                    </div>
                    <span className="text-slate-500 font-medium">
                      {edu.startDate} - {edu.endDate}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Certifications & Languages */}
          <div className="grid grid-cols-2 gap-6">
            {cv.activeSections.certifications && cv.sections.certifications.length > 0 && (
              <div>
                <h3
                  className="font-bold text-xs uppercase tracking-wider mb-2 border-b border-slate-200 pb-1"
                  style={{ color: cv.design.accentColor }}
                >
                  CHỨNG CHỈ
                </h3>
                <ul className="list-disc list-inside text-xs text-slate-700 space-y-1">
                  {cv.sections.certifications.map((c) => (
                    <li key={c.id}>
                      <span className="font-bold text-slate-900">{c.name}</span> ({c.issuer})
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {cv.activeSections.languages && cv.sections.languages.length > 0 && (
              <div>
                <h3
                  className="font-bold text-xs uppercase tracking-wider mb-2 border-b border-slate-200 pb-1"
                  style={{ color: cv.design.accentColor }}
                >
                  NGOẠI NGỮ
                </h3>
                <ul className="text-xs text-slate-700 space-y-1">
                  {cv.sections.languages.map((l) => (
                    <li key={l.id} className="flex justify-between">
                      <span className="font-bold text-slate-900">{l.language}:</span>
                      <span className="text-slate-600">{l.proficiency}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </PaginatedA4Document>
      </div>

    </div>
  );
};
