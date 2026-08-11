import React, { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../lib/i18n'
import { useNavigate } from 'react-router-dom';
import { ApiError, deleteCV, listCVs, type CVSummary } from '../lib/api';
import { MyCVsView } from '../components/MyCVsView';

/**
 * Nạp dữ liệu cho `/cv`.
 *
 * Tách khỏi `MyCVsView` để phần trình bày không biết gì về mạng: bốn trạng
 * thái (chờ · rỗng · có dữ liệu · lỗi) kiểm được ở đây, còn giao diện kiểm
 * bằng props thuần.
 */
export function MyCVsRoute() {
  const { t } = useLocale()
  const navigate = useNavigate();
  const [items, setItems] = useState<CVSummary[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    setItems(null);
    try {
      setItems(await listCVs());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('cvListReadFailed'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    setActionError(undefined);
    try {
      await deleteCV(id);
      // Bỏ khỏi danh sách tại chỗ thay vì nạp lại: nạp lại làm màn hình nháy
      // về trạng thái chờ cho một thao tác đã biết chắc kết quả.
      setItems((current) => (current ?? []).filter((cv) => cv.id !== id));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('deleteCVFailed'));
    }
  }

  if (error) {
    return (
      <div className="p-10 text-center space-y-3">
        <p className="text-sm font-semibold text-rose-600">{error}</p>
        <button
          onClick={() => void load()}
          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition"
        >{t('retry')}</button>
      </div>
    );
  }

  if (items === null) {
    return (
      <div data-testid="cv-list-loading" className="p-10 text-center text-sm text-slate-500">{t('loadingCVList')}</div>
    );
  }

  return (
    <div data-testid="view-my-cvs">
      {actionError && (
        <p className="mx-6 mt-6 rounded-xl bg-rose-50 border border-rose-100 px-4 py-2.5 text-xs font-medium text-rose-600">
          {actionError}
        </p>
      )}
      <MyCVsView
        cvs={items}
        onSelectCVToEdit={(id) => navigate(`/builder/${id}`)}
        onCreateNewCV={() => navigate('/cv/new')}
        onOpenUploadModal={() => navigate('/import')}
        onDeleteCV={(id) => void remove(id)}
      />
    </div>
  );
}
