import React from 'react';
import { CV, CVLayout } from '../types';
import { X, Printer, Download } from 'lucide-react';
import { PaginatedA4Document } from './PaginatedA4Document';
import { CVBlockRenderer } from './CVBlockRenderer';
import { normalizeLayout } from '../lib/layout-draft';

interface PreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  cv: CV;
  layout?: CVLayout;
  onDownloadPDF: () => void;
}

export const PreviewModal: React.FC<PreviewModalProps> = ({
  isOpen,
  onClose,
  cv,
  layout: providedLayout,
  onDownloadPDF,
}) => {
  if (!isOpen) return null;
  const layout = normalizeLayout(providedLayout ?? cv.layout);

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
        <PaginatedA4Document
          id="a4-cv-paper"
          className="my-auto"
          contentClassName="p-10"
          style={{
            fontFamily: cv.design.font,
            fontSize: `${cv.design.fontSize}px`,
          }}
        >
          <CVBlockRenderer cv={cv} layout={layout} variant="preview" />
        </PaginatedA4Document>
      </div>
    </div>
  );
};
