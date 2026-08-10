import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CV } from '../types';
import {
  ArrowRight,
  Sparkles,
  Plus,
  Upload,
  CheckCircle2,
  FileText,
  Building2,
  ChevronRight,
  Info,
} from 'lucide-react';

interface DashboardViewProps {
  cvs: CV[];
  cvCount?: number;
  onOpenUploadModal: () => void;
  userEmail?: string;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  cvs,
  cvCount = cvs.length,
  onOpenUploadModal,
  userEmail = 'tester',
}) => {
  const navigate = useNavigate();
  const [showCompletionDetails, setShowCompletionDetails] = useState(false);
  const userName = userEmail.split('@')[0];
  const activeCV = cvs[0] || null;
  const hasCV = cvCount > 0;

  return (
    <div className="p-6 md:p-8 max-w-[1216px] mx-auto space-y-8 animate-fade-in">
      {/* Welcome Title */}
      <div className="bg-gradient-to-r from-[#11142d] via-[#25004f] to-[#11142d] p-6 md:p-8 rounded-2xl border border-slate-800 text-white shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6 min-h-[183px]">
        <div>
          <span className="inline-block px-3 py-1 bg-indigo-500/20 border border-indigo-400/30 rounded-full text-[11px] font-semibold text-indigo-300 uppercase mb-2 tracking-wider">
            XIN CHÀO MỪNG
          </span>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
            Chào buổi sáng, {userName}! 👋
          </h1>
          <p className="text-slate-300 font-normal text-xs md:text-sm mt-1 max-w-xl">
            Tiếp tục tối ưu hóa hồ sơ năng lực của bạn theo chuẩn ATS doanh nghiệp với sự trợ giúp từ AI.
          </p>
        </div>
        <button
          onClick={onOpenUploadModal}
          className="px-5 py-2.5 bg-violet-700 hover:bg-violet-600 text-white font-semibold text-xs rounded-xl shadow-xs transition flex items-center space-x-2 shrink-0"
        >
          <Upload className="w-4 h-4" />
          <span>Tải CV lên ngay</span>
        </button>
      </div>

      {/* Row 1: Active Editing CV + Profile Completion Score */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: CV đang chỉnh sửa */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs hover:shadow-sm transition flex flex-col sm:flex-row gap-6 items-center">
          {/* CV Thumbnail */}
          <div
            className="w-28 h-36 bg-slate-50 border border-slate-200 rounded-xl p-3 shrink-0 flex flex-col justify-between overflow-hidden relative group cursor-pointer hover:border-indigo-400 transition"
            onClick={() => activeCV && navigate(`/builder/${activeCV.id}`)}
            id="dashboard-cv-thumbnail"
          >
            <div className="space-y-1.5">
              <div className="w-10 h-2.5 bg-slate-300 rounded-xs mb-2"></div>
              <div className="w-full h-1.5 bg-violet-600 rounded-xs"></div>
              <div className="w-3/4 h-1.5 bg-slate-300 rounded-xs"></div>
              <div className="w-full h-1 bg-slate-200 rounded-xs mt-3"></div>
              <div className="w-5/6 h-1 bg-slate-200 rounded-xs"></div>
            </div>
            <div className="text-[9px] text-slate-400 font-semibold tracking-wider uppercase text-center">
              A4 FORMAT
            </div>
            <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-xs opacity-0 group-hover:opacity-100 transition flex items-center justify-center p-2">
              <span className="text-xs font-medium text-white bg-indigo-600 px-2.5 py-1 rounded-lg">
                Chỉnh sửa
              </span>
            </div>
          </div>

          {/* Details */}
          <div className="flex-1 space-y-3 text-center sm:text-left">
            <div>
              <span className="inline-block px-2.5 py-0.5 bg-indigo-50 border border-indigo-100 rounded-md text-[10px] font-semibold text-indigo-700 uppercase mb-1">
                CV đang chỉnh sửa
              </span>
              <h3 className="text-xl font-bold text-slate-900 mt-0.5">
                {activeCV ? activeCV.sections.intro.fullName || activeCV.title : 'Bạn chưa có CV nào'}
              </h3>
              <p className="text-xs font-medium text-slate-600">
                {activeCV ? activeCV.sections.intro.title || 'Hồ sơ chuyên nghiệp' : 'Tạo CV đầu tiên để bắt đầu'}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                {activeCV ? `Lần sửa gần nhất: ${activeCV.lastModified}` : 'Tạo CV trắng hoặc tải CV hiện có lên.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5 pt-1">
              <button
                onClick={() => activeCV ? navigate(`/builder/${activeCV.id}`) : navigate('/cv/new')}
                id="btn-tiep-tuc-chinh-cv"
                className="inline-flex items-center space-x-2 px-4 py-2 bg-violet-700 hover:bg-violet-800 text-white font-semibold text-xs rounded-xl shadow-xs transition"
              >
                <span>{hasCV ? 'Sửa CV ngay' : 'Tạo CV đầu tiên'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => navigate('/cv')}
                id="btn-tat-ca-cv"
                className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-xl border border-slate-200 transition"
              >
                Tất cả CV
              </button>
            </div>
          </div>
        </div>

        {/* Card 2: Mức độ hoàn thiện hồ sơ */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <span className="inline-block px-2.5 py-0.5 bg-emerald-50 border border-emerald-100 rounded-md text-[10px] font-semibold text-emerald-700 uppercase mb-1">
                ĐIỂM CHUẨN ATS
              </span>
              <h3 className="text-lg font-bold text-slate-900">
                Độ hoàn thiện hồ sơ
              </h3>
              <p className="text-xs text-slate-500 max-w-xs">
                Mở chi tiết để xem phần nào đã đủ và gợi ý cải thiện từ AI.
              </p>
            </div>

            {/* Score Pill */}
            <div className="relative w-20 h-20 shrink-0 flex items-center justify-center bg-emerald-50/80 border border-emerald-100 rounded-2xl">
              <div className="flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-extrabold text-emerald-700 leading-none">
                  {hasCV ? '85%' : '0%'}
                </span>
                <span className="text-[9px] font-semibold text-emerald-600 uppercase tracking-wider mt-1">
                  ĐẠT CHUẨN
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
            <div className="flex items-center justify-between text-xs font-medium">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="font-semibold text-slate-800">
                  {hasCV ? `${cvCount} CV đang được quản lý` : 'Chưa có hồ sơ để đánh giá'}
                </span>
              </div>
              <button
                onClick={() => setShowCompletionDetails(!showCompletionDetails)}
                id="btn-gom-nhung-gi"
                className="text-indigo-600 hover:text-indigo-700 font-semibold text-xs flex items-center space-x-1"
              >
                <span>Chi tiết</span>
                <Info className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                style={{ width: hasCV ? '85%' : '0%' }}
              ></div>
            </div>

            {showCompletionDetails && (
              <div className="mt-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 text-xs space-y-2">
                <div className="flex justify-between text-slate-700">
                  <span>✓ Thông tin liên hệ & Giới thiệu</span>
                  <span className="text-emerald-600 font-semibold">Đã đủ</span>
                </div>
                <div className="flex justify-between text-slate-700">
                  <span>✓ Kinh nghiệm làm việc</span>
                  <span className="text-emerald-600 font-semibold">Đã đủ</span>
                </div>
                <div className="flex justify-between text-slate-700">
                  <span>✓ Kỹ năng & Công nghệ core</span>
                  <span className="text-emerald-600 font-semibold">Đã đủ</span>
                </div>
                <div className="flex justify-between text-slate-700">
                  <span>⚠ Bổ sung chứng chỉ MLOps / Deep Learning</span>
                  <span className="text-amber-600 font-semibold">Khuyên dùng</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Banner AI Tip */}
      <div className="bg-violet-50/70 text-slate-800 rounded-2xl p-5 border border-violet-100 flex items-center space-x-4">
        <div className="w-10 h-10 rounded-xl bg-violet-700 text-white flex items-center justify-center shrink-0 shadow-xs">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <span className="inline-block px-2 py-0.5 bg-indigo-100/80 rounded text-[10px] font-semibold text-indigo-800 uppercase tracking-wider">
            GỢI Ý TỪ AI TRỢ LÝ
          </span>
          <p className="text-xs md:text-sm font-medium text-slate-700 mt-1">
            Thêm số liệu đo lường cụ thể vào các dự án (ví dụ: % tối ưu latency, doanh thu, quy mô team) — con số chính là điểm cộng lớn nhất với nhà tuyển dụng!
          </p>
        </div>
      </div>

      {/* Row 2: Recent Match & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: Đối chiếu gần đây */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs space-y-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            ĐỐI CHIẾU VIỆC LÀM GẦN ĐÂY
          </h3>

          <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-200/80">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-700 font-bold flex items-center justify-center text-sm border border-indigo-100">
                AI
              </div>
              <div>
                <h4 className="font-semibold text-slate-900 text-sm">
                  Vị trí AI Engineer / Edge AI
                </h4>
                <span className="text-xs text-slate-500">55 phút trước</span>
              </div>
            </div>

            <div className="text-right bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-100">
              <span className="text-lg font-bold text-emerald-700">88%</span>
              <p className="text-[9px] text-emerald-600 font-medium uppercase">Tương thích</p>
            </div>
          </div>

          <button
            onClick={() => activeCV && navigate(`/analyze/${activeCV.id}`)}
            id="btn-xem-phan-tich-chi-tiet"
            className="inline-flex items-center space-x-2 text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition"
          >
            <span>Phân tích chi tiết JD</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Card 2: Hành động nhanh */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs space-y-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            HÀNH ĐỘNG NHANH
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => navigate('/cv')}
              id="btn-dash-create-cv"
              className="flex items-center space-x-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 hover:bg-slate-100 hover:border-slate-300 transition text-left group"
            >
              <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold shrink-0">
                <Plus className="w-4 h-4" />
              </div>
              <div>
                <span className="font-semibold text-slate-900 text-xs block">
                  Tạo CV mới
                </span>
                <span className="text-[11px] text-slate-500">Mẫu chuẩn ATS</span>
              </div>
            </button>

            <button
              onClick={onOpenUploadModal}
              id="btn-dash-upload-cv"
              className="flex items-center space-x-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 hover:bg-slate-100 hover:border-slate-300 transition text-left group"
            >
              <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold shrink-0">
                <Upload className="w-4 h-4" />
              </div>
              <div>
                <span className="font-semibold text-slate-900 text-xs block">
                  Tải CV lên
                </span>
                <span className="text-[11px] text-slate-500">PDF, DOCX, TXT</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
