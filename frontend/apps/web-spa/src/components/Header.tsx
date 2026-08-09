import React from 'react';
import { ViewTab } from '../types';
import {
  Sparkles,
  Eye,
  Share2,
  Download,
  User,
  HelpCircle,
  ChevronDown,
  Bot,
} from 'lucide-react';

interface HeaderProps {
  currentView: ViewTab;
  onNavigate: (view: ViewTab) => void;
  userEmail?: string;
  onOpenPreview?: () => void;
  onOpenShare?: () => void;
  onDownloadPDF?: () => void;
  onOpenUpload?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentView,
  onNavigate,
  userEmail = 'tester@example.com',
  onOpenPreview,
  onOpenShare,
  onDownloadPDF,
  onOpenUpload,
}) => {
  const isEditor = currentView === 'editor';

  return (
    <header className="h-[88px] bg-white border-b border-slate-200/80 px-4 md:px-8 flex items-center justify-between sticky top-0 z-30 transition-all shadow-xs">
      {/* Left: Brand Logo + Primary Nav */}
      <div className="flex items-center space-x-8">
        {/* Brand Logo */}
        <button
          onClick={() => onNavigate('dashboard')}
          className="flex items-center space-x-3 focus:outline-none group text-left"
          id="btn-brand-logo"
        >
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-violet-700 flex items-center justify-center font-bold text-lg text-white shadow-xs group-hover:bg-violet-800 transition">
              H
            </div>
            <div className="flex items-center">
              <span className="text-xl font-bold tracking-tight text-slate-900">
                HR-Agent<span className="text-violet-600">.AI</span>
              </span>
            </div>
          </div>
        </button>

        {/* Navigation Tabs */}
        <nav className="hidden md:flex items-center space-x-1">
          <button
            onClick={() => onNavigate('dashboard')}
            id="nav-trang-chu"
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              currentView === 'dashboard'
                ? 'bg-violet-50 text-violet-700 border border-violet-100/80'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
            }`}
          >
            Trang chủ
          </button>

          <button
            onClick={() => onNavigate('my_cvs')}
            id="nav-cv-cua-toi"
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              currentView === 'my_cvs' || currentView === 'editor'
                ? 'bg-violet-50 text-violet-700 border border-violet-100/80'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
            }`}
          >
            CV của tôi
          </button>
        </nav>
      </div>

      {/* Right Controls */}
      <div className="flex items-center space-x-2.5">
        {isEditor ? (
          /* Editor Actions */
          <>
            <button
              onClick={onOpenPreview}
              id="btn-header-preview"
              className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition shadow-2xs"
            >
              <Eye className="w-4 h-4 text-slate-500" />
              <span>Xem trước</span>
            </button>

            <button
              onClick={onOpenShare}
              id="btn-header-share"
              className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition shadow-2xs"
            >
              <Share2 className="w-4 h-4 text-slate-500" />
              <span>Chia sẻ</span>
            </button>

            <button
              onClick={onDownloadPDF}
              id="btn-header-download"
              className="inline-flex items-center space-x-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-xs"
            >
              <Download className="w-4 h-4 text-white" />
              <span>Tải PDF</span>
            </button>

            <div className="h-5 w-px bg-slate-200 mx-1 hidden sm:block"></div>

            <div
              className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center cursor-pointer hover:bg-slate-200 transition"
              title={userEmail}
              id="btn-user-avatar"
            >
              <User className="w-4 h-4 text-slate-600" />
            </div>
          </>
        ) : (
          /* Dashboard / My CVs Actions */
          <>
            <button
              onClick={() => onNavigate('ai_assistant')}
              id="btn-header-tro-ly"
              className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-violet-700 hover:bg-violet-800 rounded-xl transition shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Trợ lý AI</span>
            </button>

            <div
              id="user-dropdown"
              className="flex items-center space-x-2 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer transition"
            >
              <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] flex items-center justify-center font-bold">
                {userEmail.charAt(0).toUpperCase()}
              </div>
              <span className="hidden sm:inline-block max-w-[140px] truncate text-slate-700">
                {userEmail}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </div>

            <button
              onClick={() => onNavigate('settings')}
              id="btn-header-help"
              className="p-1.5 text-slate-500 hover:text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition"
              title="Trợ giúp & Cài đặt"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </header>
  );
};
