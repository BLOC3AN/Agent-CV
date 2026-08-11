import React, { useState } from 'react';
import { CV, CVLayout } from '../types';
import { X, Printer, Download } from 'lucide-react';
import { CVPageComposer } from './CVPageComposer';
import { CVBlockRenderer } from './CVBlockRenderer';
import { normalizeLayout } from '../lib/layout-draft';
import { PRINT_CSS } from '../lib/print-css';
import { cvTypographyStyle } from '../lib/cv-typography';

interface PreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  cv: CV;
  layout?: CVLayout;
  onDownloadPDF: () => void | Promise<void>;
}

export const PreviewModal: React.FC<PreviewModalProps> = ({
  isOpen,
  onClose,
  cv,
  layout: providedLayout,
  onDownloadPDF,
}) => {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  if (!isOpen) return null;
  const layout = normalizeLayout(providedLayout ?? cv.layout);

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
            onClick={() => void downloadPDF()}
            disabled={exporting}
            className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition flex items-center space-x-1.5 shadow-xs"
          >
            <Download className="w-4 h-4" />
            <span>{exporting ? 'Đang chuẩn bị PDF…' : 'Tải PDF'}</span>
          </button>

          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {exportError && <p role="alert" className="w-full max-w-5xl rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{exportError}</p>}

      <div
        id="cv-print-surface"
        data-testid="cv-print-surface"
        className="hidden cv-root"
        data-variant="print"
        style={{ '--cv-accent': cv.design.accentColor, ...cvTypographyStyle(cv.design) } as React.CSSProperties}
      >
        <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
        <article className="cv-page">
          <CVBlockRenderer cv={cv} layout={layout} variant="print" />
        </article>
      </div>

      {/* Middle A4 Display Area */}
      <div className="flex-1 overflow-y-auto my-4 w-full flex justify-center custom-scrollbar">
        <CVPageComposer
          id="a4-cv-paper"
          className="cv-font-surface my-auto"
          cv={cv}
          layout={layout}
          variant="preview"
          style={cvTypographyStyle(cv.design)}
        />
      </div>
    </div>
  );
};
