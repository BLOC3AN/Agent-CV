import React, { useState } from 'react';
import { Share2, X, Copy, Check, Globe } from 'lucide-react';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  cvTitle: string;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, cvTitle }) => {
  const [copied, setCopied] = useState(false);
  if (!isOpen) return null;

  const shareUrl = `${window.location.origin}/preview/cv-${encodeURIComponent(cvTitle)}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-5 animate-scale-up">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <Share2 className="w-5 h-5 text-indigo-600" />
            <span>Chia sẻ liên kết CV</span>
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <p className="text-xs text-slate-600 leading-relaxed">
            Liên kết này cho phép nhà tuyển dụng xem trực tuyến bản CV công khai của bạn ở định dạng A4 chuẩn.
          </p>

          <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded-xl p-2 pl-3">
            <Globe className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="text"
              readOnly
              value={shareUrl}
              className="bg-transparent text-xs text-slate-700 w-full focus:outline-none truncate"
            />
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg transition shrink-0 flex items-center space-x-1"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Đã chép' : 'Sao chép'}</span>
            </button>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
