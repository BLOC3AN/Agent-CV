import React, { useState } from 'react';
import { useLocale } from '../lib/i18n'
import { useNavigate } from 'react-router-dom';
import { CVSchema, type CV } from '@hr/schema';
import { ApiError, deleteCV, saveCV, type CreateCVInput, type CreateCVResult } from '../lib/api';

type CreateCVFn = (input: CreateCVInput) => Promise<CreateCVResult>;

export interface NewCVRouteProps {
  /**
   * Nhận qua props thay vì gọi thẳng `lib/api.ts` để màn hình test được bằng
   * `vi.fn()` — kể cả Promise treo mãi để kiểm khoá nút — mà không phải stub
   * `fetch`. Route thật (`routes.tsx`) truyền `createCV` từ `lib/api.ts`.
   */
  createCV: CreateCVFn;
}

/**
 * Dựng một CV v2 rỗng hợp lệ theo đúng CVSchema.
 *
 * Dùng `.parse()` thay vì liệt kê tay từng field: phần lớn field của
 * `CVSchema` có `.default(...)` (xem cv.ts), nên đưa vào bộ khung tối thiểu
 * rồi để zod tự điền phần còn lại — khi schema đổi thêm field mới có default,
 * chỗ này không phải sửa theo, tránh lệch dần với schema thật.
 */
function emptyCV(id: string, title: string): CV {
  return CVSchema.parse({
    schemaVersion: 2,
    id,
    title,
    lastModified: new Date().toISOString(),
    language: 'vi',
    sections: { intro: { fullName: '' } },
  });
}

/**
 * Màn hình cho `/cv/new` (UC-23) — bấm một nút, có một CV thật, vào thẳng
 * builder của chính nó.
 *
 * `POST /api/cv` đã tạo tài liệu v2 hoàn chỉnh. Gọi `saveCV` ngay sau đó để
 * gieo nội dung khung rỗng theo đúng schema trước khi mở builder; nếu bước
 * khởi tạo thất bại, xoá tài liệu mồ côi để lần thử sau bắt đầu sạch.
 */
export function NewCVRoute({ createCV }: NewCVRouteProps) {
  const { t } = useLocale()
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleCreate() {
    setError(undefined);
    setBusy(true);
    // Khai báo ngoài `try` để nhánh `catch` biết được createCV đã thành công
    // hay chưa — đó là ranh giới quyết định thông báo nào đúng sự thật và có
    // cần dọn CV mồ côi hay không.
    let created: CreateCVResult | undefined;
    try {
      created = await createCV({ name: t('untitledCV') });
      await saveCV(created.cvId, emptyCV(created.cvId, t('untitledCV')));
      setOpening(true);
      navigate(`/builder/${created.cvId}`);
    } catch (err) {
      if (created) {
        // CV đã được tạo nhưng bước khởi tạo nội dung hỏng — xoá ngay để
        // không để lại một CV mồ côi mà lần bấm
        // kế tiếp không hề biết tới. Lỗi xoá (nếu có) không được che mất
        // thông báo gốc — người dùng vẫn cần biết để thử lại.
        try {
          await deleteCV(created.cvId);
        } catch {
          // Không có gì thêm để làm: đã cố dọn, không dọn được thì để nguyên
          // và vẫn báo lỗi thất bại bên dưới như bình thường.
        }
        setError(t('createCVIncomplete'));
      } else {
        setError(err instanceof ApiError ? err.message : t('createCVFailed'));
      }
      // Không tắt `opening` vì nó chưa từng bật ở nhánh lỗi — chỉ cần mở khoá
      // nút để người dùng thử lại, không phải màn hình trắng bất động.
      setBusy(false);
    }
  }

  if (opening) {
    return (
      <div className="p-10 text-center text-sm text-slate-500">{t('openingNewCV')}</div>
    );
  }

  return (
    <div className="p-10 text-center space-y-4">
      <h1 className="text-xl font-bold text-slate-900">{t('createNewCV')}</h1>
      <p className="text-sm text-slate-600">{t('blankCVHint')}</p>
      {error && (
        <p className="text-sm font-semibold text-rose-600">{error}</p>
      )}
      <button
        type="button"
        onClick={() => void handleCreate()}
        disabled={busy}
        className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition"
      >
        {busy ? t('creating') : t('createCV')}
      </button>
    </div>
  );
}
