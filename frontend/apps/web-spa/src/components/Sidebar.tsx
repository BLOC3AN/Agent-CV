import React from 'react';
import { ViewTab } from '../types';
import {
  LayoutDashboard,
  FileText,
  GitCompare,
  Sparkles,
  Layout,
  Settings,
} from 'lucide-react';

interface SidebarProps {
  currentView: ViewTab;
  onNavigate: (view: ViewTab) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onNavigate }) => {
  const navItems = [
    {
      id: 'dashboard' as ViewTab,
      label: 'Tổng quan',
      icon: LayoutDashboard,
      color: 'bg-pink-400',
    },
    {
      id: 'my_cvs' as ViewTab,
      label: 'CV của tôi',
      icon: FileText,
      color: 'bg-green-400',
    },
    {
      id: 'job_match' as ViewTab,
      label: 'Đối chiếu việc làm',
      icon: GitCompare,
      color: 'bg-blue-400',
    },
    {
      id: 'ai_assistant' as ViewTab,
      label: 'Trợ lý AI',
      icon: Sparkles,
      color: 'bg-purple-400',
    },
  ];

  const secondaryItems = [
    {
      id: 'templates' as ViewTab,
      label: 'Mẫu CV',
      icon: Layout,
      color: 'bg-orange-400',
    },
    {
      id: 'settings' as ViewTab,
      label: 'Cài đặt',
      icon: Settings,
      color: 'bg-yellow-400',
    },
  ];

  return (
    <aside className="w-60 bg-slate-50/80 border-r border-slate-200/80 flex flex-col justify-between p-4 shrink-0 hidden md:flex">
      <div className="space-y-6">
        <nav className="space-y-1" id="sidebar-primary-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              currentView === item.id ||
              (item.id === 'my_cvs' && currentView === 'editor');

            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                id={`sidebar-item-${item.id}`}
                className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl font-medium text-xs transition ${
                  isActive
                    ? 'bg-violet-700 text-white font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200/80 pt-4">
          <nav className="space-y-1" id="sidebar-secondary-nav">
            {secondaryItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  id={`sidebar-item-${item.id}`}
                  className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl font-medium text-xs transition ${
                    isActive
                      ? 'bg-violet-700 text-white font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="p-3.5 bg-white border border-slate-200/80 rounded-2xl shadow-2xs text-xs text-slate-600 space-y-1">
        <div className="font-semibold text-slate-900 flex items-center space-x-1.5 text-xs">
          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
          <span>HR-Agent Pro v2.4</span>
        </div>
        <p className="text-[11px] text-slate-500 leading-normal">
          Mô hình chạy nội bộ, tối ưu CV theo chuẩn ATS. Dữ liệu cá nhân không rời máy chủ.
        </p>
      </div>
    </aside>
  );
};
