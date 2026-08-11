import React from 'react';
import type { RouteObject } from 'react-router-dom';
import { Link, Outlet } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { LoginPage } from './LoginPage';
import { DashboardRoute } from './DashboardRoute';
import { BuilderRoute } from './BuilderRoute';
import { PreviewRoute } from './PreviewRoute';
import { MyCVsRoute } from './MyCVsRoute';
import { NewCVRoute } from './NewCVRoute';
import { ImportRoute } from './ImportRoute';
import { ImportReviewRoute } from './ImportReviewRoute';
import {
  createCV as apiCreateCV,
  uploadCV as apiUploadCV,
  getJob as apiGetJob,
  getImportReview as apiGetImportReview,
  patchProfile as apiPatchProfile,
  verifyProfile as apiVerifyProfile,
  completeImport as apiCompleteImport,
} from '../lib/api';
import { AnalyzeRoute } from './AnalyzeRoute';
import { TemplatesView } from '../components/TemplatesView';
import { SettingsRoute } from './SettingsRoute';
import { GuidedRoute } from './GuidedRoute';
import { KBRoute } from './KBRoute';
import { RequireAuth, SessionProvider } from '../lib/session';
import { BuilderLocaleProvider, LocaleProvider } from '../lib/i18n';

/**
 * Bản đồ URL — một chỗ duy nhất.
 *
 * Tách khỏi `main.tsx` để hai người dùng chung được: `BrowserRouter` ở trình
 * duyệt, và `StaticRouter` khi SSR trang in ở SP-5.
 *
 * Các màn hình SPA production đều lấy dữ liệu qua `lib/api.ts`.
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

const protectedChildren: RouteObject[] = [
  {
    index: true,
    element: <DashboardRoute />,
  },
  // `cv/new` PHẢI đứng trước mọi `cv/:id` trong tương lai — react-router khớp
  // theo thứ tự khai báo, để sau thì `new` bị nuốt làm giá trị của `:id`.
  // Hiện chưa có `cv/:id` (Task 7 mới tới), nhưng thứ tự này giữ đúng ngay từ
  // bây giờ để không ai vô tình thêm `cv/:id` phía trước sau này.
  { path: 'cv/new', element: <NewCVRoute createCV={apiCreateCV} /> },
  { path: 'cv', element: <MyCVsRoute /> },
  { path: 'import', element: <ImportRoute uploadCV={apiUploadCV} getJob={apiGetJob} /> },
  // Chặng BẮT BUỘC sau khi job xong (UC-22) — `ImportRoute` điều hướng thẳng
  // tới đây, không mở builder trực tiếp. `_meta.verified` chỉ có nghĩa nếu
  // không có đường vòng nào quanh route này.
  {
    path: 'import/:jobId/review',
    element: (
      <ImportReviewRoute
        getImportReview={apiGetImportReview}
        patchProfile={apiPatchProfile}
        verifyProfile={apiVerifyProfile}
        completeImport={apiCompleteImport}
      />
    ),
  },
  // Hai đường dẫn, một màn hình. `/analyze` để người dùng tự chọn CV —
  // `/analyze/:cvId` là màn hình phân tích theo đúng CV đang mở.
  // chỉ là dạng chọn sẵn khi tới từ một CV cụ thể.
  {
    path: 'analyze',
    element: (
      <AnalyzeRoute />
    ),
  },
  {
    path: 'analyze/:cvId',
    element: (
      <AnalyzeRoute />
    ),
  },
  { path: 'templates', element: <div data-testid="view-templates"><TemplatesView cvs={[]} /></div> },
  { path: 'settings', element: <SettingsRoute /> },
  { path: 'start/guided', element: <GuidedRoute /> },
  { path: 'kb', element: <KBRoute /> },
  { path: '*', element: <NotFound /> },
];

const builderChildren: RouteObject[] = [
  { path: 'builder/:cvId', element: <div data-testid="view-editor"><BuilderRoute /></div> },
  { path: 'builder/:cvId/preview', element: <PreviewRoute /> },
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
      <LocaleProvider>
        <SessionProvider><Outlet /></SessionProvider>
      </LocaleProvider>
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
        // `BuilderLocaleProvider` phải bọc CẢ `AppLayout` chứ không nằm trong
        // `BuilderRoute`: bộ chọn ngôn ngữ sống trong `Header` do `AppLayout`
        // dựng, tức là TRÊN route con. Bọc ở đây là cách duy nhất để Header và
        // BuilderRoute cùng nhìn thấy một context.
        element: (
          <RequireAuth>
            <BuilderLocaleProvider>
              <AppLayout hideSidebar />
            </BuilderLocaleProvider>
          </RequireAuth>
        ),
        children: builderChildren,
      },
    ],
  },
];
