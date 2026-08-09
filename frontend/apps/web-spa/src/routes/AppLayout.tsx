import React from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';

/**
 * Khung chung: Header trên, Sidebar trái, nội dung route ở giữa.
 *
 * Sidebar ẩn ở trình soạn CV vì màn hình đó cần toàn bộ chiều ngang cho ba
 * cột riêng của nó (mục lục · CV · chat) — xem FRONTEND.md §3.1.
 */
export function AppLayout({ hideSidebar = false }: { hideSidebar?: boolean }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-gray-900 antialiased selection:bg-violet-100 selection:text-violet-900">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        {!hideSidebar && <Sidebar />}
        <main className="flex-1 overflow-y-auto custom-scrollbar">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
