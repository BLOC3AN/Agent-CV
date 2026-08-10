import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, Check } from 'lucide-react';
import { buildReviewItems, REVIEW_LABELS, type Profile, type ReviewItem } from '@hr/schema';
import {
  ApiError,
  type CompleteImportResult,
  type ImportReview,
  type JSONPatchOp,
  type PatchProfileResult,
  type VerifyProfileResult,
} from '../lib/api';

type GetImportReviewFn = (jobId: string) => Promise<ImportReview>;
type PatchProfileFn = (profileId: string, ops: JSONPatchOp[]) => Promise<PatchProfileResult>;
type VerifyProfileFn = (profileId: string, paths: string[]) => Promise<VerifyProfileResult>;
type CompleteImportFn = (jobId: string) => Promise<CompleteImportResult>;

export interface ImportReviewRouteProps {
  /**
   * Nhận qua props (mirror `NewCVRoute`/`ImportRoute`) để test được bằng
   * `vi.fn()` mà không phải stub `fetch`. Route thật (`routes.tsx`) truyền
   * `getImportReview`, `patchProfile`, `verifyProfile`, `completeImport` từ
   * `lib/api.ts`.
   */
  getImportReview: GetImportReviewFn;
  patchProfile: PatchProfileFn;
  verifyProfile: VerifyProfileFn;
  completeImport: CompleteImportFn;
}

type Phase = 'loading' | 'pending' | 'ready' | 'error';

/** `_meta.verified` đánh dấu CẢ hai mục — không có `basics`/`education` kép ở đây. */
const READONLY_AGGREGATE_PATHS = new Set(['/skills', '/languages']);

/**
 * `review.ts` (`buildReviewItems`, xem `f()`) nối field dạng mảng bằng ", "
 * để HIỂN THỊ — phép nối đó không tách ngược an toàn: một gạch đầu dòng tự nó
 * có thể chứa dấu phẩy ("Tăng 30%, giảm chi phí X"), tách theo dấu phẩy sẽ
 * cắt vụn nó thành nhiều mục sai. Vì vậy field dạng mảng (`highlights`,
 * `tech`) và hai mục gộp nguyên khối (`/skills`, `/languages`, mảng OBJECT)
 * chỉ hiển thị ở màn này — sửa chi tiết là việc của builder, không phải của
 * bước rà soát bắt buộc.
 */
function isEditableField(path: string): boolean {
  if (READONLY_AGGREGATE_PATHS.has(path)) return false;
  if (path.endsWith('/highlights') || path.endsWith('/tech')) return false;
  return true;
}

/**
 * Ép hồ sơ v1 thô (JSON tuỳ ý từ server, `unknown`) thành đủ hình dạng để
 * `buildReviewItems` chạy được — KHÔNG dùng `ProfileSchema.parse()`.
 *
 * Vì sao: `ProfileSchema` đòi `basics.name` không rỗng (`min(1)`). Đây CHÍNH
 * LÀ màn hình để user điền cái tên model bỏ sót — parse chặt sẽ ném lỗi ngay
 * tại đúng bản ghi cần sửa nhất, làm trắng cả màn hình lẽ ra phải giúp sửa nó.
 * `buildReviewItems` tự nó không validate gì (chỉ đọc field), nên chỉ cần bảo
 * đảm các mảng không bị `undefined` — rủi ro duy nhất là một mảng thiếu hẳn,
 * không phải field bên trong rỗng.
 */
function toProfile(raw: unknown): Profile {
  const p = (raw ?? {}) as Partial<Profile>;
  const basics = (p.basics ?? {}) as Partial<Profile['basics']>;
  return {
    schemaVersion: 1,
    language: p.language ?? 'vi',
    basics: { name: '', links: [], ...basics },
    education: p.education ?? [],
    work: p.work ?? [],
    projects: p.projects ?? [],
    skills: p.skills ?? [],
    certifications: p.certifications ?? [],
    activities: p.activities ?? [],
    languages: p.languages ?? [],
    _meta: p._meta ?? { verified: {}, source: 'pdf_import' },
  };
}

function apiErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * Màn hình cho `/import/:jobId/review` (UC-22) — chặng BẮT BUỘC giữa
 * `/import` (Task 6) và builder. `_meta.verified` chỉ có nghĩa nếu không có
 * đường vòng nào quanh màn này: mọi mục bắt đầu CHƯA xác nhận (BR-22.1), nút
 * "Hoàn tất" khoá tới khi hết, và khoá đó đọc từ `progress` do CHÍNH SERVER
 * trả về (`getImportReview`/`reviewContract`, server.go) — không phải một
 * biến đếm cục bộ dễ lệch khỏi sự thật khi có đường cập nhật khác.
 *
 * Chặn thật sự nằm ở backend (`importComplete` trả 409 nếu `progress.complete
 * != true`, xem server.go dòng ~1410) — component này chỉ phản ánh đúng luật
 * đó ra giao diện, không phải là chốt chặn duy nhất. Kể cả người dùng gõ
 * thẳng URL vào một job chưa xử lý xong (`ready: false`) hay một link cũ, màn
 * hình vẫn không hiện nút "Hoàn tất" cho tới khi có `progress` hợp lệ.
 */
export function ImportReviewRoute({
  getImportReview,
  patchProfile,
  verifyProfile,
  completeImport,
}: ImportReviewRouteProps) {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>('loading');
  const [pendingStatus, setPendingStatus] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();

  const [profileId, setProfileId] = useState<string | undefined>();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [progress, setProgress] = useState<
    { done: number; total: number; complete: boolean; pending: string[] } | undefined
  >();

  // Giá trị đang hiển thị trên form (có thể khác bản gốc nếu user đang gõ).
  const [edited, setEdited] = useState<Record<string, string>>({});
  // Giá trị đã THỰC SỰ được gửi lên server lần gần nhất (bản gốc lúc tải, hoặc
  // sau lần "Đúng rồi" gần nhất) — so với `edited` để biết mục nào còn sửa dở
  // dang chưa gửi, kể cả khi mục đó đã từng được xác nhận trước đó.
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});

  const [busyItem, setBusyItem] = useState<string | undefined>();
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!jobId) return;
    setPhase('loading');
    setLoadError(undefined);
    try {
      const review = await getImportReview(jobId);
      if (!review.ready) {
        setPendingStatus(review.status);
        setPhase('pending');
        return;
      }
      const profile = toProfile(review.profile);
      const builtItems = buildReviewItems(profile);
      const initialValues: Record<string, string> = {};
      for (const item of builtItems) {
        for (const field of item.fields) initialValues[field.path] = field.value;
      }
      setItems(builtItems);
      setEdited(initialValues);
      setSavedValues(initialValues);
      setProfileId(review.profileId);
      setProgress(review.progress);
      setPhase('ready');
    } catch (err) {
      setLoadError(apiErrorMessage(err, 'Không tải được dữ liệu để rà soát.'));
      setPhase('error');
    }
  }, [jobId, getImportReview]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleFieldChange(path: string, value: string) {
    setEdited((prev) => ({ ...prev, [path]: value }));
  }

  /** Mục còn "dở dang": có field đã sửa nhưng chưa gửi qua lần "Đúng rồi" nào. */
  function itemDirty(item: ReviewItem): boolean {
    return item.fields.some(
      (field) => isEditableField(field.path) && edited[field.path] !== savedValues[field.path],
    );
  }

  const pendingPaths = new Set(progress?.pending ?? items.map((i) => i.path));
  function isItemPending(item: ReviewItem): boolean {
    return pendingPaths.has(item.path) || itemDirty(item);
  }
  const pendingCount = items.filter(isItemPending).length;
  // Chỉ mở khoá khi ĐÃ có progress từ server VÀ không còn mục nào dở dang cục
  // bộ (sửa rồi nhưng chưa "Đúng rồi" lại) — cả hai điều kiện đều bắt buộc.
  const canFinish = phase === 'ready' && progress !== undefined && pendingCount === 0;

  async function handleConfirm(item: ReviewItem) {
    if (!profileId || !jobId) return;
    setBusyItem(item.path);
    setItemErrors((prev) => ({ ...prev, [item.path]: '' }));
    try {
      // Gửi các field đã sửa TRƯỚC khi đánh dấu xác nhận — nếu xác nhận
      // trước, bản gốc (chưa sửa) sẽ là bản bị coi là "đã duyệt", và màn rà
      // soát chỉ còn là hình thức.
      const ops: JSONPatchOp[] = item.fields
        .filter((field) => isEditableField(field.path))
        .filter((field) => edited[field.path] !== savedValues[field.path])
        .map((field) => ({ op: 'add', path: field.path, value: edited[field.path] ?? '' }));

      if (ops.length > 0) {
        await patchProfile(profileId, ops);
      }
      await verifyProfile(profileId, [item.path]);

      setSavedValues((prev) => {
        const next = { ...prev };
        for (const op of ops) next[op.path] = op.value as string;
        return next;
      });

      // Điều kiện mở khoá đọc lại từ CHÍNH dữ liệu server báo về — gọi lại
      // getImportReview thay vì tự cộng dồn một biến đếm cục bộ, để không có
      // đường nào khiến giao diện tin là "xong" trong khi server nghĩ khác.
      const refreshed = await getImportReview(jobId);
      if (refreshed.ready) setProgress(refreshed.progress);
    } catch (err) {
      setItemErrors((prev) => ({
        ...prev,
        [item.path]: apiErrorMessage(err, 'Không xác nhận được mục này. Vui lòng thử lại.'),
      }));
    } finally {
      setBusyItem(undefined);
    }
  }

  async function handleComplete() {
    if (!jobId) return;
    setCompleting(true);
    setCompleteError(undefined);
    try {
      const result = await completeImport(jobId);
      navigate(`/builder/${result.cvId}`);
    } catch (err) {
      setCompleteError(apiErrorMessage(err, 'Không hoàn tất được. Vui lòng thử lại.'));
      setCompleting(false);
    }
  }

  if (phase === 'loading') {
    return (
      <div className="p-10 text-center space-y-4">
        <div className="w-10 h-10 mx-auto rounded-full border-2 border-violet-200 border-t-violet-600 animate-spin" />
        <p className="text-sm text-slate-600">Đang tải dữ liệu để rà soát…</p>
      </div>
    );
  }

  if (phase === 'pending') {
    return (
      <div className="p-10 text-center space-y-4">
        <p className="text-sm text-slate-600">
          Job chưa xử lý xong (trạng thái: {pendingStatus ?? 'đang chờ'}). Quay lại sau khi xử lý xong để rà soát.
        </p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="p-10 text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
        <p className="text-sm font-semibold text-rose-600">{loadError}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl transition"
        >
          Thử lại
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-slate-900">Rà soát dữ liệu trước khi tạo CV</h1>
        <p className="text-sm text-slate-600">
          Hệ thống đọc được các mục dưới đây từ file bạn tải lên — đây vẫn chỉ là PHỎNG ĐOÁN của máy cho tới
          khi bạn xác nhận từng mục.
        </p>
      </div>

      <div
        className={
          pendingCount > 0
            ? 'rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800'
            : 'rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800'
        }
      >
        {pendingCount > 0
          ? `Còn ${pendingCount} mục chưa xác nhận — xác nhận từng mục bên dưới để mở khoá nút "Hoàn tất".`
          : 'Đã xác nhận xong tất cả — có thể bấm "Hoàn tất" để tạo CV.'}
      </div>

      <div className="space-y-4">
        {items.map((item) => {
          const pending = isItemPending(item);
          const busy = busyItem === item.path;
          return (
            <div
              key={item.path}
              data-testid={`review-item-${item.path}`}
              className={
                pending
                  ? 'rounded-2xl border border-slate-200 bg-white p-5 space-y-3'
                  : 'rounded-2xl border border-emerald-200 bg-emerald-50/30 p-5 space-y-3'
              }
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-violet-600">
                    {REVIEW_LABELS[item.kind]}
                  </div>
                  <h3 className="text-sm font-bold text-slate-900">{item.title}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => void handleConfirm(item)}
                  disabled={busy}
                  className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition"
                >
                  {!pending && <Check className="w-3.5 h-3.5" />}
                  {busy ? 'Đang lưu…' : pending ? 'Đúng rồi' : 'Đã xác nhận'}
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {item.fields.map((field) => {
                  const inputId = `field-${field.path.replace(/\//g, '-')}`;
                  const editable = isEditableField(field.path);
                  return (
                    <div key={field.path} className="space-y-1">
                      <label htmlFor={inputId} className="text-xs font-medium text-slate-500">
                        {field.label}
                      </label>
                      {editable ? (
                        <input
                          id={inputId}
                          value={edited[field.path] ?? ''}
                          onChange={(e) => handleFieldChange(field.path, e.target.value)}
                          placeholder={field.empty ? 'Chưa có — điền vào đây' : undefined}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none"
                        />
                      ) : (
                        <p id={inputId} className="text-sm text-slate-700 whitespace-pre-line">
                          {edited[field.path] || 'Chưa có'}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {itemErrors[item.path] && (
                <p className="text-xs font-semibold text-rose-600">{itemErrors[item.path]}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-0 bg-white/90 backdrop-blur border-t border-slate-200 py-4 flex items-center justify-between gap-4">
        {completeError && <p className="text-xs font-semibold text-rose-600">{completeError}</p>}
        <button
          type="button"
          onClick={() => void handleComplete()}
          disabled={!canFinish || completing}
          className="ml-auto px-6 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition"
        >
          {completing ? 'Đang hoàn tất…' : 'Hoàn tất'}
        </button>
      </div>
    </div>
  );
}
