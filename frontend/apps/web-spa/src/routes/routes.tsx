import React from 'react';
import type { RouteObject } from 'react-router-dom';
import { Link, Outlet } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { LoginPage } from './LoginPage';
import { initialCVs } from '../mockData';
import { DashboardView } from '../components/DashboardView';
import { MyCVsRoute } from './MyCVsRoute';
import { NewCVRoute } from './NewCVRoute';
import { createCV as apiCreateCV } from '../lib/api';
import { CVEditorView } from '../components/CVEditorView';
import { JobMatchView } from '../components/JobMatchView';
import { TemplatesView } from '../components/TemplatesView';
import { SettingsView } from '../components/SettingsView';
import { RequireAuth, SessionProvider } from '../lib/session';

/**
 * Bản đồ URL — một chỗ duy nhất.
 *
 * Tách khỏi `main.tsx` để hai người dùng chung được: `BrowserRouter` ở trình
 * duyệt, và `StaticRouter` khi SSR trang in ở SP-5.
 *
 * Các màn hình chưa tới lượt vẫn dùng `mockData`. Chúng được thay lần lượt:
 * `/cv` ở Task 7, phần còn lại ở SP-3.
 */
function NotFound() {
  return (
    <div className="p-10 text-center space-y-3">
      <h1 className="text-2xl font-bold text-slate-900">Không tìm thấy trang</h1>
      <p className="text-sm text-slate-600">Đường dẫn bạn mở không tồn tại hoặc đã được đổi tên.</p>
      <Link to="/" className="inline-block text-sm font-semibold text-violet-700 hover:underline">
        Về trang tổng quan
      </Link>
    </div>
  );
}

/** Chỗ giữ chân cho các prop dữ liệu chưa được nối. Task 7 và SP-3 thay dần. */
const noop = () => {};

const protectedChildren: RouteObject[] = [
  {
    index: true,
    element: (
      <div data-testid="view-dashboard">
        <DashboardView cvs={initialCVs} onOpenUploadModal={noop} />
      </div>
    ),
  },
  // `cv/new` PHẢI đứng trước mọi `cv/:id` trong tương lai — react-router khớp
  // theo thứ tự khai báo, để sau thì `new` bị nuốt làm giá trị của `:id`.
  // Hiện chưa có `cv/:id` (Task 7 mới tới), nhưng thứ tự này giữ đúng ngay từ
  // bây giờ để không ai vô tình thêm `cv/:id` phía trước sau này.
  { path: 'cv/new', element: <NewCVRoute createCV={apiCreateCV} /> },
  { path: 'cv', element: <MyCVsRoute /> },
  // Hai đường dẫn, một màn hình. `/analyze` để người dùng tự chọn CV —
  // `JobMatchView` vốn đã nhận cả danh sách và làm việc đó. `/analyze/:cvId`
  // chỉ là dạng chọn sẵn khi tới từ một CV cụ thể.
  {
    path: 'analyze',
    element: (
      <div data-testid="view-job-match">
        <JobMatchView cvs={initialCVs} />
      </div>
    ),
  },
  {
    path: 'analyze/:cvId',
    element: (
      <div data-testid="view-job-match">
        <JobMatchView cvs={initialCVs} />
      </div>
    ),
  },
  { path: 'templates', element: <div data-testid="view-templates"><TemplatesView cvs={initialCVs} /></div> },
  { path: 'settings', element: <div data-testid="view-settings"><SettingsView /></div> },
  { path: '*', element: <NotFound /> },
];

const builderChildren: RouteObject[] = [
  {
    path: 'builder/:cvId',
    element: (
      <div data-testid="view-editor">
        <CVEditorView
          cv={initialCVs[0]!}
          onUpdateCV={noop}
          onOpenPreview={noop}
          onOpenShare={noop}
          onDownloadPDF={noop}
        />
      </div>
    ),
  },
];

/**
 * Route gốc không có `path` chỉ để bọc toàn cây trong `SessionProvider` —
 * mọi màn hình con, kể cả `/login`, đều cần đọc được `useSession()`.
 * `/login` nằm NGOÀI `RequireAuth`: nếu bọc vào trong, chưa đăng nhập thì nó
 * tự chuyển hướng về chính nó và trình duyệt treo trong vòng lặp.
 */
export const appRoutes: RouteObject[] = [
  {
    element: (
      <SessionProvider>
        <Outlet />
      </SessionProvider>
    ),
    children: [
      { path: 'login', element: <LoginPage /> },
      {
        element: (
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        ),
        children: protectedChildren,
      },
      {
        element: (
          <RequireAuth>
            <AppLayout hideSidebar />
          </RequireAuth>
        ),
        children: builderChildren,
      },
    ],
  },
];
