import React from 'react';
import { CV } from '../types';
import { X, Printer, Download } from 'lucide-react';

interface PreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  cv: CV;
  onDownloadPDF: () => void;
}

export const PreviewModal: React.FC<PreviewModalProps> = ({
  isOpen,
  onClose,
  cv,
  onDownloadPDF,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex flex-col items-center justify-between p-4 md:p-6 overflow-hidden">
      {/* Top Modal Header */}
      <div className="w-full max-w-5xl bg-white rounded-2xl p-4 flex items-center justify-between shadow-lg shrink-0">
        <h3 className="font-bold text-gray-900 text-base">
          Xem trước CV A4 — {cv.sections.intro.fullName || cv.title}
        </h3>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => window.print()}
            className="px-3.5 py-1.5 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition flex items-center space-x-1.5"
          >
            <Printer className="w-4 h-4" />
            <span>In / Print</span>
          </button>

          <button
            onClick={onDownloadPDF}
            className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition flex items-center space-x-1.5 shadow-xs"
          >
            <Download className="w-4 h-4" />
            <span>Tải PDF</span>
          </button>

          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Middle A4 Display Area */}
      <div className="flex-1 overflow-y-auto my-4 w-full flex justify-center custom-scrollbar">
        <div
          className="bg-white shadow-2xl p-10 relative my-auto rounded-sm"
          style={{
            width: '210mm',
            minHeight: '297mm',
            fontFamily: cv.design.font,
            fontSize: `${cv.design.fontSize}px`,
          }}
        >
          {/* Header */}
          <div className="border-b pb-4 mb-6 relative">
            <h1 className="text-3xl font-extrabold text-gray-900 uppercase tracking-tight">
              {cv.sections.intro.fullName}
            </h1>
            <p className="text-lg font-bold mt-1" style={{ color: cv.design.accentColor }}>
              {cv.sections.intro.title}
            </p>
            <p className="text-xs text-gray-600 mt-2">
              {cv.sections.intro.email} • {cv.sections.intro.phone} • {cv.sections.intro.location}
            </p>
          </div>

          {/* Introduction */}
          {cv.sections.intro.summary && (
            <div className="mb-6">
              <h3 className="font-bold text-xs uppercase tracking-wider mb-2" style={{ color: cv.design.accentColor }}>
                INTRODUCTION
              </h3>
              <p className="text-xs text-gray-700 leading-relaxed">{cv.sections.intro.summary}</p>
            </div>
          )}

          {/* Experience */}
          {cv.sections.experience.length > 0 && (
            <div className="mb-6">
              <h3 className="font-bold text-xs uppercase tracking-wider mb-2 border-b pb-1" style={{ color: cv.design.accentColor }}>
                EXPERIENCE
              </h3>
              <div className="space-y-4">
                {cv.sections.experience.map((e) => (
                  <div key={e.id}>
                    <div className="flex justify-between font-bold text-sm text-gray-900">
                      <span>{e.title} — {e.company}</span>
                      <span className="text-xs text-gray-500">{e.startDate} – {e.endDate}</span>
                    </div>
                    <p className="text-xs text-gray-700 whitespace-pre-line mt-1">{e.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Skills */}
          {cv.sections.skills.length > 0 && (
            <div className="mb-6">
              <h3 className="font-bold text-xs uppercase tracking-wider mb-2 border-b pb-1" style={{ color: cv.design.accentColor }}>
                SKILLS
              </h3>
              <div className="space-y-1 text-xs">
                {cv.sections.skills.map((s) => (
                  <div key={s.id} className="flex">
                    <span className="font-bold w-36 text-gray-900">{s.category}:</span>
                    <span className="text-gray-700">{s.skills}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
