import React from 'react';
import { Settings, Key, ShieldCheck, Database } from 'lucide-react';

export const SettingsView: React.FC = () => {
  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-8 animate-fade-in">
      <div className="bg-gradient-to-r from-slate-900 to-indigo-950 p-6 rounded-2xl border border-slate-800 text-white shadow-sm">
        <span className="inline-block px-3 py-1 bg-indigo-500/20 border border-indigo-400/30 rounded-full text-[10px] font-semibold text-indigo-300 uppercase mb-1 tracking-wider">
          CẤU HÌNH HỆ THỐNG
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-3">
          <Settings className="w-6 h-6 text-indigo-400" />
          <span>Cài đặt hệ thống (Settings)</span>
        </h1>
        <p className="text-slate-300 font-normal text-xs md:text-sm mt-1">
          Quản lý tài khoản, tích hợp API Key và cấu hình hiển thị ứng dụng.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs divide-y divide-slate-100 overflow-hidden">
        {/* Account Info */}
        <div className="p-6 flex items-start justify-between bg-slate-50/50">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-600 text-white font-bold flex items-center justify-center text-lg shadow-xs">
              T
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Tài khoản thử nghiệm</h3>
              <p className="text-xs font-medium text-slate-500">tester@example.com</p>
              <span className="inline-block mt-2 text-[10px] font-semibold uppercase text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-0.5 rounded-md">
                Gói Premium — AI Unlimited
              </span>
            </div>
          </div>
        </div>

        {/* Trạng thái kết nối mô hình AI */}
        <div className="p-6 space-y-3 bg-white">
          <div className="flex items-center space-x-2 text-slate-900 font-bold text-xs uppercase tracking-wider">
            <Key className="w-4 h-4 text-indigo-600" />
            <span>Kết nối mô hình AI</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Mô hình chạy nội bộ trên máy chủ, không lộ ra giao diện trình duyệt để đảm bảo an toàn tuyệt đối.
          </p>
          <div className="inline-flex items-center space-x-2 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-lg">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Trạng thái: Server-side API Active</span>
          </div>
        </div>

        {/* Local Storage Data */}
        <div className="p-6 space-y-3 bg-white">
          <div className="flex items-center space-x-2 text-slate-900 font-bold text-xs uppercase tracking-wider">
            <Database className="w-4 h-4 text-indigo-600" />
            <span>Lưu trữ dữ liệu CV</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Tất cả bản nháp CV và lịch sử chỉnh sửa được đồng bộ hóa tức thì trong bộ nhớ trình duyệt và phiên làm việc.
          </p>
        </div>
      </div>
    </div>
  );
};

