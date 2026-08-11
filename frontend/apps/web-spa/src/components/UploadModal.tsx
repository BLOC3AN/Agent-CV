import React, { useState } from 'react';
import { useLocale } from '../lib/i18n';
import { Upload, X, FileText, CheckCircle2 } from 'lucide-react';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: (title: string, content?: string) => void;
}

export const UploadModal: React.FC<UploadModalProps> = ({ isOpen, onClose, onUploadSuccess }) => {
  const { t } = useLocale()
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setFileName(file.name);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setFileName(file.name);
    }
  };

  const handleConfirmUpload = () => {
    if (fileName) {
      onUploadSuccess(fileName.replace(/\.[^/.]+$/, ''));
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-6 animate-scale-up">
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <h3 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
            <Upload className="w-5 h-5 text-indigo-600" />
            <span>{t('uploadCVTitle')}</span>
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drop Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleFileDrop}
          className={`border-2 border-dashed rounded-2xl p-8 text-center transition cursor-pointer ${
            isDragging
              ? 'border-indigo-500 bg-indigo-50/50'
              : 'border-slate-200 hover:border-indigo-400 bg-slate-50/50'
          }`}
        >
          <input
            type="file"
            id="file-upload-input"
            accept=".pdf,.docx,.doc,.txt,.json"
            className="hidden"
            onChange={handleFileSelect}
          />
          <label htmlFor="file-upload-input" className="cursor-pointer space-y-3 block">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 mx-auto flex items-center justify-center">
              <FileText className="w-6 h-6" />
            </div>
            {fileName ? (
              <div className="space-y-1">
                <span className="font-bold text-slate-900 text-sm block">{fileName}</span>
                <span className="text-xs text-indigo-600 flex items-center justify-center space-x-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{t('readyToExtract')}</span>
                </span>
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium text-slate-700">{t('dragDropHint')}<span className="text-indigo-600 font-semibold underline">{t('chooseFromComputer')}</span>
                </p>
                <p className="text-xs text-slate-400 mt-1">{t('supportedFormats')}</p>
              </div>
            )}
          </label>
        </div>

        <div className="flex items-center justify-end space-x-2.5 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition"
          >{t('cancel')}</button>
          <button
            onClick={handleConfirmUpload}
            disabled={!fileName}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold text-xs rounded-xl transition shadow-xs"
          >{t('createAndEdit')}</button>
        </div>
      </div>
    </div>
  );
};
