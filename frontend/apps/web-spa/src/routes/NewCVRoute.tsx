import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CVSchema, type CV } from '@hr/schema';
import { ApiError, saveCV, type CreateCVInput, type CreateCVResult } from '../lib/api';

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
function emptyCV(id: string): CV {
  return CVSchema.parse({
    schemaVersion: 2,
    id,
    title: 'CV chưa đặt tên',
    lastModified: new Date().toISOString(),
    language: 'vi',
    sections: { intro: { fullName: '' } },
  });
}

/**
 * Màn hình cho `/cv/new` (UC-23) — bấm một nút, có một CV thật, vào thẳng
 * builder của chính nó.
 *
 * Ràng buộc bắt buộc phát hiện ở Task 3: `POST /api/cv` chỉ ghi `data` (v1);
 * `data_v2` còn NULL. Theo Task 2, mọi `GET /api/cv/:id` kèm header v2 lên
 * hàng đó trả 409 `V2_NOT_BACKFILLED`. Đây là đường đi của MỌI CV tạo mới,
 * không phải ca hiếm — nếu bỏ qua, người dùng đâm vào 409 ngay trên CV họ vừa
 * tạo.
 *
 * Chọn phương án (a): gọi `saveCV` với một CV rỗng ngay sau `createCV`, đồng
 * bộ, trước khi điều hướng — để `data_v2` luôn tồn tại kể từ khoảnh khắc đầu
 * tiên. `saveCV` đã gửi cả `cv` lẫn `profile` (qua `cvToProfile`), nên một
 * lời gọi này gieo đủ cả hai cột. Chọn (a) thay vì để builder tự coi 409 là
 * "CV rỗng" (phương án b) vì giữ bất biến "mọi CV đọc được bằng v2" đúng
 * ngay từ nguồn — không màn hình v2 nào sau đây (builder, xem trước, PDF ở
 * SP-5, ...) phải biết tới trường hợp đặc biệt "CV chưa có data_v2".
 */
export function NewCVRoute({ createCV }: NewCVRouteProps) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleCreate() {
    setError(undefined);
    setBusy(true);
    try {
      const created = await createCV({ name: 'CV chưa đặt tên' });
      await saveCV(created.cvId, emptyCV(created.cvId));
      setOpening(true);
      navigate(`/builder/${created.cvId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tạo được CV');
      // Không tắt `opening` vì nó chưa từng bật ở nhánh lỗi — chỉ cần mở khoá
      // nút để người dùng thử lại, không phải màn hình trắng bất động.
      setBusy(false);
    }
  }

  if (opening) {
    return (
      <div className="p-10 text-center text-sm text-slate-500">Đang mở CV vừa tạo…</div>
    );
  }

  return (
    <div className="p-10 text-center space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Tạo CV mới</h1>
      <p className="text-sm text-slate-600">Bắt đầu một CV trống, chỉnh sửa trong trình soạn thảo.</p>
      {error && (
        <p className="text-sm font-semibold text-rose-600">{error}</p>
      )}
      <button
        type="button"
        onClick={() => void handleCreate()}
        disabled={busy}
        className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition"
      >
        {busy ? 'Đang tạo…' : 'Tạo CV'}
      </button>
    </div>
  );
}
