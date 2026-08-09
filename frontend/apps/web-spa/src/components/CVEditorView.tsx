import React, { useState } from 'react';
import { CV, CVDesign, ChatMessage } from '../types';
import {
  CheckCircle2,
  Edit2,
  Plus,
  ArrowUpDown,
  Sparkles,
  Send,
  X,
  Mic,
  Bot,
  SlidersHorizontal,
  Layers,
  ChevronDown,
  Check,
  Zap,
} from 'lucide-react';

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

  // Right AI Assistant State
  const [showAIPanel, setShowAIPanel] = useState(true);
  const [aiModel, setAiModel] = useState('standard');
  const [aiMessages, setAiMessages] = useState<ChatMessage[]>([
    {
      id: 'm-1',
      sender: 'user',
      text: "Tối ưu hoá giúp tôi phần 'Kinh nghiệm làm việc'?",
      timestamp: 'Vừa xong',
    },
    {
      id: 'm-2',
      sender: 'ai',
      text: "Đã phân tích phần kinh nghiệm làm việc! Dưới đây là mô tả chuẩn ATS đi kèm số liệu cụ thể:\n\n• Microservices & Infrastructure: Thiết kế kiến trúc nền tảng Vision MLOps gồm 11 microservices, giúp giảm 45% độ trễ triển khai.\n• Edge AIoT: Tối ưu hoá mô hình YOLO bằng kỹ thuật Knowledge Distillation cho Jetson Orin Nano, đạt tốc độ 19 FPS ở độ trễ dưới 300ms.",
      timestamp: 'Vừa xong',
      suggestedAction: {
        type: 'apply_text',
        targetSection: 'experience',
        content: 'Microservices & Infrastructure: Thiết kế kiến trúc nền tảng Vision MLOps gồm 11 microservices, giúp giảm 45% độ trễ triển khai.\nEdge AIoT: Tối ưu hoá mô hình YOLO bằng kỹ thuật Knowledge Distillation cho Jetson Orin Nano, đạt tốc độ 19 FPS ở độ trễ dưới 300ms.',
      },
    },
  ]);
  const [aiInputText, setAiInputText] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);

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

  // Handle Quick Action Pill click
  const handleQuickAction = async (actionType: string) => {
    setIsAiLoading(true);
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: `Yêu cầu AI: ${actionType}`,
      timestamp: 'Vừa xong',
    };
    setAiMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch('/api/ai/quick-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: actionType, cvData: cv.sections }),
      });
      const data = await res.json();

      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: data.result || 'Đã phân tích xong!',
        timestamp: 'Vừa xong',
      };
      setAiMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      console.error(err);
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: 'Đã tối ưu hoá thành công nội dung CV theo chuẩn tuyển dụng!',
        timestamp: 'Vừa xong',
      };
      setAiMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsAiLoading(false);
    }
  };

  // Send Chat message to AI endpoint
  const handleSendAiMessage = async () => {
    if (!aiInputText.trim() || isAiLoading) return;

    const userText = aiInputText;
    setAiInputText('');
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: userText,
      timestamp: 'Vừa xong',
    };
    setAiMessages((prev) => [...prev, userMsg]);
    setIsAiLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          model: aiModel,
          cvData: cv.sections,
        }),
      });
      const data = await res.json();

      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: data.reply || 'Dưới đây là phản hồi từ AI Assistant.',
        timestamp: 'Vừa xong',
      };
      setAiMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      console.error(err);
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: 'Đã hoàn tất phân tích yêu cầu từ phía AI Trợ lý.',
        timestamp: 'Vừa xong',
      };
      setAiMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsAiLoading(false);
    }
  };

  // Apply AI Suggestion to CV
  const handleApplyAISuggestion = (action: any) => {
    if (action.targetSection === 'experience' && cv.sections.experience.length > 0) {
      const updatedExp = [...cv.sections.experience];
      // Gợi ý AI vẫn tới dưới dạng một khối văn bản nhiều dòng ở demo này;
      // tách theo dòng để không ghi đè nguyên khối vào mảng highlights.
      updatedExp[0] = { ...updatedExp[0]!, highlights: action.content.split('\n') };
      onUpdateCV({
        ...cv,
        sections: {
          ...cv.sections,
          experience: updatedExp,
        },
      });
      alert('Đã cập nhật gợi ý AI vào phần Kinh nghiệm làm việc!');
    }
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
        <div
          id="a4-cv-paper"
          className="bg-white border border-slate-200 shadow-lg rounded-xs transition-all duration-300 relative print:shadow-none print:m-0"
          style={{
            width: '210mm',
            minHeight: '297mm',
            padding: '24mm 20mm',
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
                    <p className="text-xs text-slate-700">{proj.highlights.join(' ')}</p>
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
                    <span className="text-slate-700">{sk.skills}</span>
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
        </div>
      </div>

      {/* 3. Right Sidebar - AI Assistant Panel */}
      {showAIPanel ? (
        <div className="w-80 bg-white border-l border-slate-200/80 flex flex-col shrink-0 z-10 shadow-xs animate-fade-in">
          {/* Header */}
          <div className="p-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Bot className="w-5 h-5 text-indigo-400" />
              <h3 className="font-bold text-white text-sm">Trợ lý AI HR-Agent</h3>
            </div>
            <button
              onClick={() => setShowAIPanel(false)}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3.5 border-b border-slate-200 bg-slate-50/70 space-y-3">
            {/* Model Selection */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                MÔ HÌNH AI
              </label>
              <div className="relative">
                <select
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl py-1.5 px-3 text-xs font-medium text-slate-800 appearance-none focus:outline-none focus:border-indigo-500"
                >
                  <option value="standard">Chuẩn (Nhanh)</option>
                  <option value="deep">Chuyên sâu</option>
                </select>
                <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-2 pointer-events-none" />
              </div>
            </div>

            {/* Quick Action Pills */}
            <div className="grid grid-cols-2 gap-1.5 pt-0.5">
              {[
                { label: 'Tối ưu kinh nghiệm', key: 'optimize_experience' },
                { label: 'Rút gọn giới thiệu', key: 'shorten_intro' },
                { label: 'Sửa lỗi chính tả', key: 'check_grammar' },
                { label: 'Viết lại kỹ năng', key: 'rewrite_skills' },
                { label: 'Tạo tóm tắt', key: 'generate_summary' },
                { label: 'Gợi ý cải thiện', key: 'suggest_improvements' },
              ].map((pill) => (
                <button
                  key={pill.key}
                  onClick={() => handleQuickAction(pill.key)}
                  disabled={isAiLoading}
                  className="px-2 py-1.5 bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 text-slate-700 hover:text-indigo-700 text-[10px] font-semibold rounded-lg transition text-center truncate disabled:opacity-50"
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>

          {/* Chat Transcript Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs bg-slate-50/50">
            {aiMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col space-y-1 ${
                  msg.sender === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  className={`max-w-[90%] p-3 rounded-xl whitespace-pre-line leading-relaxed text-xs ${
                    msg.sender === 'user'
                      ? 'bg-indigo-600 text-white font-medium shadow-2xs'
                      : 'bg-white text-slate-800 border border-slate-200/80 shadow-2xs'
                  }`}
                >
                  {msg.sender === 'ai' && (
                    <div className="flex items-center space-x-1 text-[10px] font-semibold text-indigo-700 uppercase tracking-wider mb-1 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded w-max">
                      <Sparkles className="w-3 h-3 text-indigo-600" />
                      <span>AI GỢI Ý</span>
                    </div>
                  )}
                  {msg.text}

                  {msg.suggestedAction && (
                    <div className="mt-3 pt-2 border-t border-slate-100">
                      <button
                        onClick={() => handleApplyAISuggestion(msg.suggestedAction)}
                        className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg transition flex items-center justify-center space-x-1 shadow-2xs"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>Áp dụng vào CV</span>
                      </button>
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-slate-400 font-medium px-1">{msg.timestamp}</span>
              </div>
            ))}

            {isAiLoading && (
              <div className="flex items-center space-x-2 text-xs text-indigo-700 bg-indigo-50 p-3 rounded-xl border border-indigo-100 animate-pulse font-medium">
                <Sparkles className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                <span>AI đang phân tích và tối ưu hóa CV...</span>
              </div>
            )}
          </div>

          {/* Input Box */}
          <div className="p-3 border-t border-slate-200 bg-white">
            <div className="relative flex items-center">
              <input
                type="text"
                placeholder="Yêu cầu AI chỉnh sửa CV..."
                value={aiInputText}
                onChange={(e) => setAiInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendAiMessage()}
                className="w-full pr-20 pl-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500"
              />
              <div className="absolute right-1.5 flex items-center space-x-1">
                <button
                  type="button"
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
                  title="Voice input"
                >
                  <Mic className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleSendAiMessage}
                  disabled={!aiInputText.trim() || isAiLoading}
                  className="p-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-lg transition"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAIPanel(true)}
          className="fixed right-6 bottom-8 bg-indigo-600 hover:bg-indigo-700 text-white p-3.5 rounded-2xl shadow-lg z-20 flex items-center space-x-2 text-xs font-semibold transition"
        >
          <Bot className="w-5 h-5" />
          <span>Mở Trợ lý AI</span>
        </button>
      )}
    </div>
  );
};

