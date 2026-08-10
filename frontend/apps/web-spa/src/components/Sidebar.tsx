import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  GitCompare,
  Sparkles,
  Layout,
  Settings,
} from 'lucide-react';
import { useLocale } from '../lib/i18n';

interface NavItem {
  to: string;
  end: boolean;
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
}

/*
 * Sidebar còn 5 mục, không phải 6.
 *
 * Bản SPA gốc có mục "Trợ lý AI" trỏ tới một màn hình chat đứng riêng. Spec
 * §5.1 gộp trợ lý thành panel của `/builder/:cvId`, vì trợ lý tách khỏi CV thì
 * không sinh được đề xuất có ngữ cảnh — nên mục sidebar đó không còn đích đến
 * và bị bỏ. Quyết định của chủ sản phẩm ngày 2026-08-09.
 *
 * `/analyze` KHÔNG kèm id là một màn hình thật; màn phân tích cần một CV cụ thể
 * danh sách CV và tự cho người dùng chọn. `/analyze/:cvId` chỉ là dạng chọn
 * sẵn.
 */
function navItems(t: (key: 'home' | 'cvs' | 'analyze' | 'templates' | 'settings') => string) {
  return {
    primary: [
      { to: '/', end: true, id: 'dashboard', label: t('home'), icon: LayoutDashboard },
      { to: '/cv', end: false, id: 'cv', label: t('cvs'), icon: FileText },
      { to: '/analyze', end: false, id: 'analyze', label: t('analyze'), icon: GitCompare },
    ] as NavItem[],
    secondary: [
      { to: '/templates', end: false, id: 'templates', label: t('templates'), icon: Layout },
      { to: '/settings', end: false, id: 'settings', label: t('settings'), icon: Settings },
    ] as NavItem[],
  }
}

function itemClass({ isActive }: { isActive: boolean }): string {
  return `w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl font-medium text-xs transition ${
    isActive
      ? 'bg-violet-700 text-white font-semibold shadow-xs'
      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
  }`;
}

function NavGroup({ items, id }: { items: NavItem[]; id: string }) {
  return (
    <nav className="space-y-1" id={id}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.id}
            to={item.to}
            end={item.end}
            data-testid={`sidebar-item-${item.id}`}
            className={itemClass}
          >
            {({ isActive }) => (
              <>
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

export const Sidebar: React.FC = () => {
  const { t } = useLocale();
  const { primary, secondary } = navItems(t);
  return (
    <aside className="w-60 bg-slate-50/80 border-r border-slate-200/80 flex flex-col justify-between p-4 shrink-0 hidden md:flex">
      <div className="space-y-6">
        <NavGroup items={primary} id="sidebar-primary-nav" />

        <div className="border-t border-slate-200/80 pt-4">
          <NavGroup items={secondary} id="sidebar-secondary-nav" />
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
