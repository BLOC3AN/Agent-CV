import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, AlertCircle } from 'lucide-react';
import { ApiError, type Job, type UploadCVResult } from '../lib/api';

type UploadCVFn = (file: File) => Promise<UploadCVResult>;
type GetJobFn = (id: string) => Promise<Job>;

export interface ImportRouteProps {
  /**
   * Nhận qua props (mirror `NewCVRoute`) để test được bằng `vi.fn()` — kể cả
   * chuỗi trạng thái queued → running → done — mà không phải stub `fetch`
   * hay giả lập timer thật. Route thật (`routes.tsx`) truyền `uploadCV` và
   * `getJob` từ `lib/api.ts`.
   */
  uploadCV: UploadCVFn;
  getJob: GetJobFn;
  /**
   * Khoảng chờ CƠ SỞ giữa hai lần hỏi job, tính bằng mili giây — nhân dần
   * theo `nextPollDelay`. Test truyền một giá trị rất nhỏ để chạy nhanh bằng
   * timer thật (không cần `vi.useFakeTimers`); màn hình thật dùng mặc định
   * đủ thưa để không dội API vào một job đang mất hàng chục giây.
   */
  pollIntervalMs?: number;
}

/** Trạng thái CHƯA xong — máy chủ còn cần xử lý tiếp, phải hỏi lại. */
const NON_TERMINAL_STATUSES = new Set(['queued', 'running']);

/** Câu tiếng Việt cho từng trạng thái chưa xong; job.go chỉ sinh hai giá trị này. */
const STATUS_LABEL: Record<string, string> = {
  queued: 'Đang xếp hàng chờ xử lý…',
  running: 'Đang trích xuất dữ liệu từ CV…',
};

/**
 * `Job.error` (xem `lib/api.ts`) gõ kiểu `unknown` vì trường JSON gốc là
 * `any` phía Go — nhưng `job()` handler (server.go dòng ~1048) luôn gán một
 * chuỗi. Không tin tuyệt đối vào đó: nếu tương lai đổi hình dạng, người dùng
 * vẫn thấy một câu đọc được thay vì "undefined" hay object in thẳng ra màn hình.
 */
function jobErrorMessage(job: Job): string {
  return typeof job.error === 'string' && job.error.trim() !== ''
    ? job.error
    : 'CV xử lý thất bại. Vui lòng thử lại.';
}

/**
 * Backoff nhẹ: nhân đôi sau mỗi lần hỏi, chặn ở hệ số 8. Worker parse xong
 * nhanh thì vài lần hỏi đầu (nhân 1, 2, 4) đã bắt được ngay; job chạy lâu thì
 * khoảng hỏi giãn ra, không dội liên tục vào một job còn mất hàng chục giây.
 */
function nextPollDelay(attempt: number, baseMs: number): number {
  const factor = Math.min(2 ** attempt, 8);
  return baseMs * factor;
}

/**
 * Màn hình cho `/import` (UC-21) — tải một PDF, xem tiến độ job xử lý nó,
 * rồi chuyển sang bước duyệt bắt buộc `/import/:jobId/review` (Task 7).
 * Route này KHÔNG mở builder khi xong — review không phải bước tuỳ chọn.
 *
 * `UploadModal.tsx` có sẵn trong SPA không được dùng lại ở đây: nó dựng cho
 * dữ liệu giả (`onUploadSuccess(title, content?)` trả kết quả ngay lập tức,
 * chấp nhận cả .docx/.txt/.json), còn `POST /api/uploads/cv` thật chỉ nhận
 * PDF và trả về một `jobId` cần theo dõi qua job không đồng bộ. Tái dùng nó
 * cho luồng thật sẽ phải viết lại gần như toàn bộ thân component — đúng việc
 * brief yêu cầu KHÔNG làm ở task này. Ngôn ngữ hình ảnh (khung nét đứt, icon
 * `lucide-react`) được giữ lại tinh thần, nhưng đánh máy lại trực tiếp ở đây.
 */
export function ImportRoute({ uploadCV, getJob, pollIntervalMs = 2000 }: ImportRouteProps) {
  const navigate = useNavigate();
  const [jobId, setJobId] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  /**
   * Vòng hỏi job. Hai điều kiện dừng bắt buộc, cả hai đều phải giữ:
   *
   * 1. Trạng thái cuối (`done`, hoặc bất kỳ gì khác không nằm trong
   *    `NON_TERMINAL_STATUSES` — tức `failed`/`cancelled`) — không hẹn lần
   *    hỏi kế tiếp nữa.
   * 2. Unmount — cờ `stopped` được set trong hàm dọn dẹp của effect, và mọi
   *    nhánh sau `await getJob(...)` đều kiểm tra nó trước khi `setState`
   *    hay hẹn `setTimeout` tiếp theo. Thiếu vế này thì rời trang (hoặc job
   *    xong ở nơi khác điều hướng đi) vẫn còn một timer sống gọi API vào một
   *    component đã unmount — đúng lỗi "chỉ lộ ra sau khi tab mở lâu" mà
   *    brief cảnh báo.
   */
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll(attempt: number) {
      let current: Job;
      try {
        current = await getJob(jobId as string);
      } catch (err) {
        if (stopped) return;
        setError(err instanceof ApiError ? err.message : 'Không theo dõi được tiến trình xử lý.');
        return;
      }
      // Unmount xảy ra TRONG lúc chờ phản hồi — component đã rời đi, không
      // được setState (React cảnh báo) và không được hẹn lần hỏi kế tiếp.
      if (stopped) return;

      if (current.status === 'done') {
        navigate(`/import/${jobId}/review`);
        return;
      }
      if (!NON_TERMINAL_STATUSES.has(current.status)) {
        // 'failed' hoặc 'cancelled' — trạng thái cuối, nhưng không thành công.
        setError(jobErrorMessage(current));
        return;
      }
      setStatus(current.status);
      timer = setTimeout(() => {
        void poll(attempt + 1);
      }, nextPollDelay(attempt, pollIntervalMs));
    }

    void poll(0);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, getJob, navigate, pollIntervalMs]);

  async function handleFile(file: File) {
    setError(undefined);
    setUploading(true);
    try {
      const result = await uploadCV(file);
      setUploading(false);
      setStatus('queued');
      setJobId(result.jobId);
    } catch (err) {
      setUploading(false);
      setError(err instanceof ApiError ? err.message : 'Không tải file lên được.');
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  }

  function retry() {
    // Về lại vạch xuất phát sạch: không có jobId thì effect polling ở trên
    // tự dọn dẹp (dependency đổi về undefined), màn hình quay lại bước chọn
    // file — đường đi tiếp thật sự, không phải chỉ một câu chữ an ủi.
    setError(undefined);
    setJobId(undefined);
    setStatus(undefined);
    setUploading(false);
  }

  if (error) {
    return (
      <div className="p-10 text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
        <p className="text-sm font-semibold text-rose-600">{error}</p>
        <button
          type="button"
          onClick={retry}
          className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl transition"
        >
          Thử lại
        </button>
      </div>
    );
  }

  if (jobId) {
    return (
      <div className="p-10 text-center space-y-4">
        <div className="w-10 h-10 mx-auto rounded-full border-2 border-violet-200 border-t-violet-600 animate-spin" />
        <p className="text-sm text-slate-600">{(status && STATUS_LABEL[status]) ?? 'Đang xử lý…'}</p>
      </div>
    );
  }

  return (
    <div className="p-10 text-center space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Tải CV lên</h1>
      <p className="text-sm text-slate-600">
        Chọn một file PDF — hệ thống sẽ đọc và điền sẵn dữ liệu để bạn duyệt lại.
      </p>
      <label
        htmlFor="import-file-input"
        className="mx-auto block max-w-sm cursor-pointer rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-8 text-center transition hover:border-violet-400"
      >
        <Upload className="w-8 h-8 text-violet-600 mx-auto mb-2" />
        <span className="text-sm font-medium text-slate-700">
          {uploading ? 'Đang tải lên…' : 'Kéo thả hoặc chọn file CV (PDF)'}
        </span>
        <input
          id="import-file-input"
          data-testid="import-file-input"
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          disabled={uploading}
          onChange={handleInputChange}
        />
      </label>
    </div>
  );
}
