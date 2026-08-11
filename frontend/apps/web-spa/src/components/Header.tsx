import React from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  Eye,
  Share2,
  Download,
  User,
  HelpCircle,
  ChevronDown,
} from 'lucide-react';
import { useSession } from '../lib/session';
import { useLocale } from '../lib/i18n';

interface HeaderProps {
  onOpenPreview?: () => void;
  onOpenShare?: () => void;
  onDownloadPDF?: () => void;
  onOpenUpload?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenPreview,
  onOpenShare,
  onDownloadPDF,
  onOpenUpload,
}) => {
  const location = useLocation();
  const isEditor = location.pathname.startsWith('/builder');
  const { email, signOut } = useSession();
  const userEmail = email ?? 'Chưa đăng nhập';
  const { t } = useLocale();

  return (
    <header className="h-[88px] bg-white border-b border-slate-200/80 px-4 md:px-8 flex items-center justify-between sticky top-0 z-30 transition-all shadow-xs">
      {/* Left: Brand Logo + Primary Nav */}
      <div className="flex items-center space-x-8">
        {/* Brand Logo */}
        <Link
          to="/"
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
        </Link>

        {/* Navigation Tabs */}
        <nav className="hidden md:flex items-center space-x-1">
          <NavLink
            to="/"
            end
            id="nav-trang-chu"
            className={({ isActive }) =>
              `px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                isActive
                  ? 'bg-violet-50 text-violet-700 border border-violet-100/80'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
              }`
            }
          >
            {t('home')}
          </NavLink>

          <NavLink
            to="/cv"
            id="nav-cv-cua-toi"
            className={({ isActive }) =>
              `px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                isActive || isEditor
                  ? 'bg-violet-50 text-violet-700 border border-violet-100/80'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
              }`
            }
          >
            {t('cvs')}
          </NavLink>
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
              <span>{t('preview')}</span>
            </button>

            <button
              onClick={onOpenShare}
              id="btn-header-share"
              className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition shadow-2xs"
            >
              <Share2 className="w-4 h-4 text-slate-500" />
              <span>{t('share')}</span>
            </button>

            <button
              onClick={onDownloadPDF ?? (() => window.dispatchEvent(new Event('hr-agent:download-pdf')))}
              id="btn-header-download"
              className="inline-flex items-center space-x-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-xs"
            >
              <Download className="w-4 h-4 text-white" />
              <span>{t('download')}</span>
            </button>

            <div className="h-5 w-px bg-slate-200 mx-1 hidden sm:block"></div>

            <div
              className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center cursor-pointer hover:bg-slate-200 transition"
              title={userEmail}
              id="btn-user-avatar"
            >
              <User className="w-4 h-4 text-slate-600" />
            </div>

            <button
              onClick={signOut}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition"
            >
              {t('logout')}
            </button>
          </>
        ) : (
          /* Dashboard / My CVs Actions */
          <>
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

            <Link
              to="/settings"
              id="btn-header-help"
              className="p-1.5 text-slate-500 hover:text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition"
              title={t('settings')}
            >
              <HelpCircle className="w-4 h-4" />
            </Link>

            <button
              onClick={signOut}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition"
            >
              {t('logout')}
            </button>
          </>
        )}
      </div>
    </header>
  );
};
