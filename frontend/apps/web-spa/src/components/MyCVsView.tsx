import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CV } from '../types';
import { Trash2, Edit3, Plus, Upload, FileText, Search } from 'lucide-react';

interface MyCVsViewProps {
  cvs: CV[];
  onCreateNewCV: () => void;
  onOpenUploadModal: () => void;
  onDeleteCV: (cvId: string) => void;
}

export const MyCVsView: React.FC<MyCVsViewProps> = ({
  cvs,
  onCreateNewCV,
  onOpenUploadModal,
  onDeleteCV,
}) => {
  const navigate = useNavigate();
  const [deleteModalCVId, setDeleteModalCVId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCVs = cvs.filter(
    (cv) =>
      cv.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cv.sections.intro.fullName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDeleteConfirm = () => {
    if (deleteModalCVId) {
      onDeleteCV(deleteModalCVId);
      setDeleteModalCVId(null);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6 animate-fade-in">
      {/* Top Title & Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 to-indigo-950 p-6 rounded-2xl border border-slate-800 text-white shadow-sm">
        <div>
          <span className="inline-block px-3 py-1 bg-indigo-500/20 border border-indigo-400/30 rounded-full text-[10px] font-semibold text-indigo-300 uppercase mb-1 tracking-wider">
            QUẢN LÝ HỒ SƠ
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Danh sách CV của tôi
          </h1>
          <p className="text-xs text-slate-300 mt-1">
            Quản lý, tạo mới và tinh chỉnh các phiên bản CV phù hợp từng vị trí ứng tuyển.
          </p>
        </div>

        <div className="flex items-center space-x-2.5 w-full sm:w-auto shrink-0">
          <button
            onClick={onOpenUploadModal}
            id="btn-tai-cv-len"
            className="flex-1 sm:flex-initial inline-flex items-center justify-center space-x-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white border border-white/20 font-semibold text-xs rounded-xl transition backdrop-blur-xs"
          >
            <Upload className="w-4 h-4" />
            <span>Tải CV lên</span>
          </button>

          <button
            onClick={onCreateNewCV}
            id="btn-nhap-tay"
            className="flex-1 sm:flex-initial inline-flex items-center justify-center space-x-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl transition shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Tạo mới</span>
          </button>
        </div>
      </div>

      {/* Search Input */}
      {cvs.length > 3 && (
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm kiếm theo tên hoặc vị trí..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200/80 rounded-xl text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 shadow-2xs"
          />
        </div>
      )}

      {/* CV Cards List */}
      <div className="space-y-3 pt-1">
        {filteredCVs.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-slate-200/80 p-8 space-y-3 shadow-xs">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 mx-auto flex items-center justify-center">
              <FileText className="w-6 h-6" />
            </div>
            <p className="text-slate-700 font-semibold text-sm">Chưa có CV nào trong danh sách</p>
            <button
              onClick={onCreateNewCV}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition"
            >
              + Tạo CV mới ngay
            </button>
          </div>
        ) : (
          filteredCVs.map((cv) => (
            <div
              key={cv.id}
              className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs hover:border-indigo-300 hover:shadow-md transition flex items-center justify-between group cursor-pointer"
              onClick={() => navigate(`/builder/${cv.id}`)}
            >
              <div className="flex items-center space-x-4">
                <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-lg group-hover:bg-indigo-600 group-hover:text-white transition shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 group-hover:text-indigo-600 transition">
                    {cv.sections.intro.fullName || cv.title}
                  </h3>
                  <p className="text-xs font-medium text-slate-500 mt-0.5">{cv.lastModified}</p>
                </div>
              </div>

              <div className="flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => navigate(`/builder/${cv.id}`)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition hidden sm:inline-flex items-center space-x-1.5"
                >
                  <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                  <span>Sửa CV</span>
                </button>

                <button
                  onClick={() => setDeleteModalCVId(cv.id)}
                  id={`btn-delete-cv-${cv.id}`}
                  className="px-3.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-xl transition"
                >
                  Xoá
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Delete Modal Confirmation */}
      {deleteModalCVId && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 border border-slate-200 shadow-xl space-y-4 animate-scale-up">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">
                Xác nhận xoá CV
              </h3>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Bạn có chắc chắn muốn xoá CV này? Tất cả dữ liệu của CV sẽ bị xóa vĩnh viễn và không thể khôi phục.
            </p>

            <div className="flex items-center justify-end space-x-2.5 pt-2">
              <button
                onClick={() => setDeleteModalCVId(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition"
              >
                Hủy
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-xl transition shadow-xs"
              >
                Xoá vĩnh viễn
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

