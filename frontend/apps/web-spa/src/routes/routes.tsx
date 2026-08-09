import React from 'react';
import type { RouteObject } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { initialCVs } from '../mockData';
import { DashboardView } from '../components/DashboardView';
import { MyCVsView } from '../components/MyCVsView';
import { CVEditorView } from '../components/CVEditorView';
import { JobMatchView } from '../components/JobMatchView';
import { TemplatesView } from '../components/TemplatesView';
import { SettingsView } from '../components/SettingsView';

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

export const appRoutes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: (
          <div data-testid="view-dashboard">
            <DashboardView cvs={initialCVs} onOpenUploadModal={noop} />
          </div>
        ),
      },
      {
        path: 'cv',
        element: (
          <div data-testid="view-my-cvs">
            <MyCVsView
              cvs={initialCVs}
              onCreateNewCV={noop}
              onOpenUploadModal={noop}
              onDeleteCV={noop}
            />
          </div>
        ),
      },
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
    ],
  },
  {
    element: <AppLayout hideSidebar />,
    children: [
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
    ],
  },
];
