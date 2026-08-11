import React, { useCallback, useEffect, useState } from 'react';
import { useLocale, type MessageKey } from '../lib/i18n'
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, Check } from 'lucide-react';
import { CVSchema, type CV, type ReviewField, type ReviewItem, type ReviewKind } from '@hr/schema';
import {
  ApiError,
  type CompleteImportResult,
  type ImportReview,
  type JSONPatchOp,
  type PatchProfileResult,
  type VerifyProfileResult,
} from '../lib/api';

/*
 * `REVIEW_LABELS` của `@hr/schema` chỉ có tiếng Việt, và nó là gói dùng chung
 * với hợp đồng backend nên không phải chỗ để nhét bảng dịch giao diện. Ánh xạ
 * sang khoá message ở đây, tại tầng UI.
 */
const REVIEW_KIND_KEYS: Record<ReviewKind, MessageKey> = {
  intro: 'reviewKindIntro',
  education: 'reviewKindEducation',
  experience: 'reviewKindExperience',
  projects: 'reviewKindProjects',
  skills: 'reviewKindSkills',
  activities: 'reviewKindActivities',
  certifications: 'reviewKindCertifications',
  languages: 'reviewKindLanguages',
}

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

/**
 * Mảng con (`highlights`, `tech`, `links`) → chính nó nếu đã là mảng, `[]`
 * nếu không (kể cả `null`/`undefined`).
 *
 * Vì sao cần: worker parse CV thật (`backend/cmd/worker/main.go`,
 * `parseActivities`/`parseEducation`) gán một slice `nil` khi một mục không
 * có gạch đầu dòng nào — Go marshal `nil []any` thành JSON `null`, không phải
 * `[]`. Đây là dữ liệu THẬT sẽ tới, không phải ca dựng — không chờ backend tự
 * sửa (việc đó được ghi nhận riêng), màn hình này phải tự đứng vững trước nó.
 */
function reviewField(path: string, label: string, value: unknown): ReviewField {
  const text = Array.isArray(value) ? value.join(', ') : String(value ?? '')
  return { path, label, value: text, empty: text.trim() === '' }
}

/**
 * Review contract for the v2 document stored in profiles.data.
 *
 * Nhận `t` qua tham số vì hàm nằm ở tầng module, ngoài mọi component — không
 * gọi hook được, và nhúng chữ tiếng Việt vào đây thì màn rà soát sẽ luôn nói
 * tiếng Việt kể cả khi người dùng đã chuyển sang tiếng Anh.
 */
function buildV2ReviewItems(raw: unknown, t: (key: MessageKey) => string): { cv: CV; items: ReviewItem[] } {
  const cv = CVSchema.parse(raw)
  const items: ReviewItem[] = [{
    kind: 'intro', path: '/sections/intro', title: cv.sections.intro.fullName || t('sectionIntro'),
    fields: [
      reviewField('/sections/intro/fullName', t('fieldFullName'), cv.sections.intro.fullName),
      reviewField('/sections/intro/title', t('fieldTitle'), cv.sections.intro.title),
      reviewField('/sections/intro/email', 'Email', cv.sections.intro.email),
      reviewField('/sections/intro/phone', t('fieldPhone'), cv.sections.intro.phone),
      reviewField('/sections/intro/location', t('fieldLocation'), cv.sections.intro.location),
    ],
  }]
  cv.sections.experience.forEach((item, i) => items.push({ kind: 'experience', path: `/sections/experience/${i}`, title: `${item.title || 'Vị trí'} — ${item.company || ''}`.trim(), fields: [
    reviewField(`/sections/experience/${i}/company`, 'Công ty', item.company),
    reviewField(`/sections/experience/${i}/title`, 'Vị trí', item.title),
    reviewField(`/sections/experience/${i}/highlights`, 'Mô tả', item.highlights),
  ] }))
  cv.sections.education.forEach((item, i) => items.push({ kind: 'education', path: `/sections/education/${i}`, title: item.school || `Học vấn ${i + 1}`, fields: [
    reviewField(`/sections/education/${i}/school`, 'Trường', item.school),
    reviewField(`/sections/education/${i}/degree`, 'Bằng cấp', item.degree),
    reviewField(`/sections/education/${i}/fieldOfStudy`, 'Ngành', item.fieldOfStudy),
    reviewField(`/sections/education/${i}/gpa`, 'GPA', item.gpa),
  ] }))
  cv.sections.projects.forEach((item, i) => items.push({ kind: 'projects', path: `/sections/projects/${i}`, title: item.name || `Dự án ${i + 1}`, fields: [
    reviewField(`/sections/projects/${i}/name`, 'Tên dự án', item.name),
    reviewField(`/sections/projects/${i}/role`, 'Vai trò', item.role),
    reviewField(`/sections/projects/${i}/highlights`, 'Mô tả', item.highlights),
  ] }))
  if (cv.sections.skills.length) items.push({ kind: 'skills', path: '/sections/skills', title: `Kỹ năng (${cv.sections.skills.length})`, fields: [] })
  cv.sections.activities.forEach((item, i) => items.push({ kind: 'activities', path: `/sections/activities/${i}`, title: item.organization || `Hoạt động ${i + 1}`, fields: [
    reviewField(`/sections/activities/${i}/organization`, 'Tổ chức', item.organization),
    reviewField(`/sections/activities/${i}/role`, 'Vai trò', item.role),
    reviewField(`/sections/activities/${i}/highlights`, 'Mô tả', item.highlights),
  ] }))
  cv.sections.certifications.forEach((item, i) => items.push({ kind: 'certifications', path: `/sections/certifications/${i}`, title: item.name || `Chứng chỉ ${i + 1}`, fields: [
    reviewField(`/sections/certifications/${i}/name`, 'Tên', item.name),
    reviewField(`/sections/certifications/${i}/issuer`, 'Nơi cấp', item.issuer),
    reviewField(`/sections/certifications/${i}/date`, 'Ngày', item.date),
  ] }))
  if (cv.sections.languages.length) items.push({ kind: 'languages', path: '/sections/languages', title: `Ngoại ngữ (${cv.sections.languages.length})`, fields: [] })
  return { cv, items }
}

function apiErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * Đọc giá trị tại một JSON Pointer trên object bất kỳ. KHÔNG escape đầy đủ
 * RFC 6901 (`~0`/`~1`): mọi pointer trong hệ thống này là tên field/chỉ số
 * mảng thường, không chứa `/` hay `~` — `buildReviewItems` (`@hr/schema`)
 * cũng không escape khi dựng các pointer này.
 */
function rawValueAt(root: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return root;
  const parts = pointer.split('/').slice(1);
  let cur: unknown = root;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export type FieldEditKind = 'text' | 'list' | 'readonly';

/**
 * Suy ra cách sửa một field từ HÌNH DẠNG THẬT của nó tại thời điểm tải, thay
 * vì một danh sách hậu tố đoán trước.
 *
 * Review vòng 1 (Finding, Minor 1) chỉ ra: bản trước dùng một denylist hậu tố
 * (`endsWith('/highlights')`, …) canh theo field list của review contract — một
 * package khác. Nếu thêm field mảng mới vào contract mà quên cập nhật denylist
 * ở đây thì màn hình sẽ PATCH một chuỗi
 * nối dấu phẩy đè lên một mảng object, hỏng dữ liệu âm thầm — không có gì báo
 * lỗi vì kiểu dữ liệu trong TypeScript ở biên `JSONPatchOp.value: unknown`.
 *
 * Suy từ hình dạng thì không có denylist nào để quên cập nhật:
 * - Không phải mảng → field vô hướng, sửa bằng ô nhập một dòng.
 * - Mảng CHỈ CHỨA giá trị vô hướng (`highlights`, `tech`) → sửa bằng textarea
 *   một dòng/phần tử, patch lại NGUYÊN MẢNG — không đi qua chuỗi nối dấu phẩy
 *   của `review.ts` nên không cần tách ngược gì cả (Finding 3, review vòng 1).
 * - Mảng chứa OBJECT (`/sections/skills`; `/sections/languages`) → CHỈ XEM.
 *   Tái tạo lại các object đó từ
 *   một ô nhập văn bản sẽ phải bịa giá trị cho field không hiển thị
 *   (level/canonical/group) — rủi ro mất dữ liệu thật, không phải thứ suy ra
 *   an toàn được từ hình dạng. Sửa những field đó là việc của builder.
 */
export function editKindFor(rawValue: unknown): FieldEditKind {
  if (!Array.isArray(rawValue)) return 'text';
  const allPrimitive = rawValue.every((v) => v === null || typeof v !== 'object');
  return allPrimitive ? 'list' : 'readonly';
}

/** Mảng → văn bản một dòng/phần tử, để hiển thị/soạn trong `<textarea>`. */
function arrayToLines(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.map((v) => String(v)).join('\n');
}

/** Văn bản một dòng/phần tử → mảng chuỗi đã dọn dòng trống, để patch lại. */
function linesToArray(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

export interface ResidualLeaf {
  path: string;
  label: string;
  value: string;
}

/** Nhãn tiếng Việt cho field KHÔNG nằm trong danh sách curated của `review.ts`. */
const RAW_FIELD_LABELS: Record<string, string> = {
  dob: 'Ngày sinh',
  photo: 'Ảnh',
  avatarUrl: 'Ảnh đại diện',
  introduce: 'Giới thiệu',
  startDate: 'Bắt đầu',
  endDate: 'Kết thúc',
  type: 'Hình thức',
  url: 'Đường dẫn',
  role: 'Vai trò',
  period: 'Thời gian',
  level: 'Trình độ',
  canonical: 'Tên chuẩn hoá',
  group: 'Nhóm',
  label: 'Nhãn liên kết',
  links: 'Liên kết',
};

function labelForRawPath(path: string): string {
  const segments = path.split('/');
  const last = segments[segments.length - 1] ?? path;
  if (/^\d+$/.test(last)) {
    // Phần tử mảng (vd. ".../links/0") — dùng nhãn của khoá cha, không phải "0".
    const parent = segments[segments.length - 2];
    return parent ? (RAW_FIELD_LABELS[parent] ?? parent) : path;
  }
  return RAW_FIELD_LABELS[last] ?? last;
}

/**
 * Duyệt phần dữ liệu THÔ nằm dưới `item.path` mà `buildReviewItems` KHÔNG đưa
 * vào `item.fields`, để hiển thị (CHỈ XEM) trước khi user bấm {t('confirmItem')}.
 *
 * Vì sao đây không phải là tính năng phụ (Finding 2, review vòng 1): khi user
 * xác nhận một mục, `verifyProfile` ghi `_meta.verified[item.path] = true` —
 * và theo đúng ngữ nghĩa mà `reviewContract` (server.go) đọc lại, đó là xác
 * nhận cho CẢ SUBTREE tại pointer đó, không chỉ những field đang hiển thị
 * trong `item.fields`. Trước bản vá này, một cú {t('confirmItem')} cho
 * `/sections/experience/0` âm thầm xác nhận luôn `startDate`/`endDate` — và
 * với `/sections/intro`, âm thầm
 * xác nhận cả `dob`/`photo`, hai field PII (`PII_PATHS`, `packages/schema/
 * src/profile.ts`) — mà user CHƯA TỪNG THẤY trên màn hình. Đó chính xác là
 * điều màn rà soát này tồn tại để ngăn.
 *
 * CHỈ HIỂN THỊ, không sửa: đây là lưới an toàn để user THẤY trước khi tick,
 * không phải một trình soạn thảo thứ hai — field nào sửa được đã nằm trong
 * `item.fields` (qua `editKindFor`) rồi.
 */
function collectResidualLeaves(
  value: unknown,
  base: string,
  covered: Set<string>,
  out: ResidualLeaf[],
): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    const allPrimitive = value.every((v) => v === null || typeof v !== 'object');
    if (allPrimitive) {
      if (!covered.has(base) && value.length > 0) {
        out.push({ path: base, label: labelForRawPath(base), value: value.map(String).join(', ') });
      }
      return;
    }
    value.forEach((el, i) => collectResidualLeaves(el, `${base}/${i}`, covered, out));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      collectResidualLeaves(v, `${base}/${key}`, covered, out);
    }
    return;
  }
  if (covered.has(base)) return;
  const text = String(value).trim();
  if (text === '') return;
  // Ảnh có thể là chuỗi base64 dài hàng chục KB — in nguyên văn phá bố cục,
  // và độ dài chuỗi không phải thứ user cần đọc để biết "có ảnh hay không".
  const shown = (base.endsWith('/photo') || base.endsWith('/avatarUrl')) && text.length > 80 ? 'Có ảnh đính kèm' : text;
  out.push({ path: base, label: labelForRawPath(base), value: shown });
}

/**
 * Màn hình cho `/import/:jobId/review` (UC-22) — chặng BẮT BUỘC giữa
 * `/import` (Task 6) và builder. `_meta.verified` chỉ có nghĩa nếu không có
 * đường vòng nào quanh màn này: mọi mục bắt đầu CHƯA xác nhận (BR-22.1), nút
 * {t('finishReview')} khoá tới khi hết.
 *
 * Điều kiện mở khoá đọc CẢ HAI: cờ `progress.complete` do CHÍNH SERVER trả về
 * (`getImportReview`/`reviewContract`, server.go) VÀ số mục còn "pending" mà
 * client tự đối chiếu (`pendingCount`, dùng để hiển thị "còn N mục"). Chỉ
 * dùng `pendingCount === 0` là không đủ (Finding 1, review vòng 1):
 * `buildReviewItems` (client) và `reviewContract` (server, Go) là HAI cách cài
 * đặt độc lập của cùng một hợp đồng, hôm nay khớp nhau nhưng không có gì đảm
 * bảo mãi mãi khớp — một pointer server coi là pending mà client không dựng ra
 * sẽ mở khoá nhầm (rồi `completeImport` trả 409 không rõ lý do); một mục
 * client dựng ra mà server không biết tới sẽ hiện "Đã xác nhận" dù user chưa
 * xác nhận gì. Đọc cả cờ server lẫn danh sách client thì một bên lệch không
 * đủ để mở khoá sai.
 *
 * Chặn thật sự nằm ở backend (`importComplete` trả 409 nếu `progress.complete
 * != true`, xem server.go dòng ~1410) — component này chỉ phản ánh đúng luật
 * đó ra giao diện, không phải là chốt chặn duy nhất. Kể cả người dùng gõ
 * thẳng URL vào một job chưa xử lý xong (`ready: false`) hay một link cũ, màn
 * hình vẫn không hiện nút {t('finishReview')} cho tới khi có `progress` hợp lệ.
 */
export function ImportReviewRoute({
  getImportReview,
  patchProfile,
  verifyProfile,
  completeImport,
}: ImportReviewRouteProps) {
  const { t } = useLocale();
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>('loading');
  const [pendingStatus, setPendingStatus] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();

  const [profileId, setProfileId] = useState<string | undefined>();
  const [profileData, setProfileData] = useState<CV | undefined>();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [progress, setProgress] = useState<
    { done: number; total: number; complete: boolean; pending: string[] } | undefined
  >();

  // Giá trị đang hiển thị trên form, dạng VĂN BẢN kể cả với field mảng
  // (textarea một dòng/phần tử) — có thể khác bản gốc nếu user đang gõ.
  const [edited, setEdited] = useState<Record<string, string>>({});
  // Giá trị đã THỰC SỰ được gửi lên server lần gần nhất (bản gốc lúc tải, hoặc
  // sau lần {t('confirmItem')} gần nhất) — so với `edited` để biết field nào còn sửa
  // dở dang chưa gửi, kể cả khi mục chứa nó đã từng được xác nhận trước đó.
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});

  // Mục đã lưu (patch+verify) THÀNH CÔNG trong phiên này nhưng lần tải lại
  // `progress` sau đó có thể chưa phản ánh kịp (xem Minor 3, review vòng 1) —
  // chỉ dùng để KHÔNG hiện nhầm "chưa xác nhận" cho một mục vừa lưu thật; nút
  // {t('finishReview')} vẫn khoá theo `progress.complete` của server, không đọc cờ này.
  const [optimisticVerified, setOptimisticVerified] = useState<Set<string>>(new Set());

  const [busyItem, setBusyItem] = useState<string | undefined>();
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [refreshError, setRefreshError] = useState<string | undefined>();
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
      const { cv, items: builtItems } = buildV2ReviewItems(review.profile, t);
      const initialValues: Record<string, string> = {};
      for (const item of builtItems) {
        for (const field of item.fields) {
          const raw = rawValueAt(cv, field.path);
          initialValues[field.path] = editKindFor(raw) === 'list' ? arrayToLines(raw) : field.value;
        }
      }
      setItems(builtItems);
      setEdited(initialValues);
      setSavedValues(initialValues);
      setOptimisticVerified(new Set());
      setProfileId(review.profileId);
      setProfileData(cv);
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

  function editKindForField(path: string): FieldEditKind {
    return editKindFor(rawValueAt(profileData, path));
  }

  /** Field của một mục đã sửa nhưng chưa gửi qua lần {t('confirmItem')} nào gần nhất. */
  function touchedFieldPaths(item: ReviewItem): string[] {
    return item.fields
      .filter((field) => editKindForField(field.path) !== 'readonly')
      .filter((field) => (edited[field.path] ?? '') !== (savedValues[field.path] ?? ''))
      .map((field) => field.path);
  }

  function buildOps(item: ReviewItem): JSONPatchOp[] {
    return touchedFieldPaths(item).map((path) => {
      const kind = editKindForField(path);
      const text = edited[path] ?? '';
      return { op: 'add', path, value: kind === 'list' ? linesToArray(text) : text.trim() };
    });
  }

  const serverPendingPaths = new Set(progress?.pending ?? items.map((i) => i.path));
  function isItemPending(item: ReviewItem): boolean {
    // Sửa dở dang chưa gửi luôn tính là pending, bất kể server nói gì —
    // {t('finishReview')} không được mở khoá trong lúc một sửa còn nằm trên form.
    if (touchedFieldPaths(item).length > 0) return true;
    if (optimisticVerified.has(item.path)) return false;
    return serverPendingPaths.has(item.path);
  }
  const pendingCount = items.filter(isItemPending).length;
  // Finding 1 (review vòng 1): bắt buộc đọc CẢ cờ `progress.complete` của
  // server LẪN `pendingCount` tự đối chiếu — xem comment ở đầu component.
  // `progress.total !== items.length` là chiều lệch CÒN LẠI của Finding 1
  // (review vòng 1): nếu client dựng ra một mục mà server không biết tới,
  // path đó không nằm trong `progress.pending` (server không đếm nó), nên
  // riêng lẻ nó vẫn hiện "Đã xác nhận" dù chưa ai xác nhận gì — nhưng tổng số
  // mục hai bên đếm được sẽ khác nhau. So khớp tổng số là lưới an toàn RẺ cho
  // đúng chiều lệch đó, dù không sửa được cách hiển thị của riêng mục thừa.
  const totalsMatch = progress !== undefined && progress.total === items.length;
  const canFinish = phase === 'ready' && progress?.complete === true && totalsMatch && pendingCount === 0;

  async function refreshProgress() {
    if (!jobId) return;
    try {
      const refreshed = await getImportReview(jobId);
      if (refreshed.ready) setProgress(refreshed.progress);
      setRefreshError(undefined);
    } catch (err) {
      setRefreshError(apiErrorMessage(err, 'Đã lưu xác nhận nhưng không tải lại được tiến độ mới nhất.'));
    }
  }

  async function handleConfirm(item: ReviewItem) {
    if (!profileId || !jobId) return;
    setBusyItem(item.path);
    setItemErrors((prev) => ({ ...prev, [item.path]: '' }));
    setRefreshError(undefined);

    // Gửi các field đã sửa TRƯỚC khi đánh dấu xác nhận — nếu xác nhận trước,
    // bản gốc (chưa sửa) sẽ là bản bị coi là "đã duyệt", và màn rà soát chỉ
    // còn là hình thức.
    const touched = touchedFieldPaths(item);
    const ops = buildOps(item);

    // Minor 3 (review vòng 1): tách RÕ hai bước — "lưu" (patch + verify) và
    // "tải lại tiến độ". Nếu patch/verify hỏng, đây thật sự là lưu thất bại.
    // Nếu chúng thành công rồi bước tải lại tiến độ mới hỏng, mục ĐÃ được lưu
    // thật trên server — báo "không xác nhận được" cho trường hợp đó là SAI
    // sự thật và khiến user bấm lại vô ích.
    try {
      if (ops.length > 0) {
        await patchProfile(profileId, ops);
      }
      await verifyProfile(profileId, [item.path]);
    } catch (err) {
      setItemErrors((prev) => ({
        ...prev,
        [item.path]: apiErrorMessage(err, 'Không lưu được xác nhận cho mục này. Vui lòng thử lại.'),
      }));
      setBusyItem(undefined);
      return;
    }

    setSavedValues((prev) => {
      const next = { ...prev };
      for (const path of touched) next[path] = edited[path] ?? '';
      return next;
    });
    setOptimisticVerified((prev) => new Set(prev).add(item.path));
    setBusyItem(undefined);

    // Điều kiện mở khoá đọc lại từ CHÍNH dữ liệu server báo về — gọi lại
    // getImportReview thay vì tự cộng dồn một biến đếm cục bộ. Nếu lời gọi
    // này hỏng, mục vẫn hiện đã lưu (nhờ `optimisticVerified` ở trên) nhưng
    // {t('finishReview')} vẫn khoá vì `progress` chưa cập nhật — `refreshError` giải
    // thích đúng lý do và cho thử tải lại, không lẫn với lỗi lưu.
    await refreshProgress();
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
        <h1 className="text-xl font-bold text-slate-900">{t('reviewTitle')}</h1>
        <p className="text-sm text-slate-600">{t('reviewIntro')}</p>
      </div>

      <div
        className={
          pendingCount > 0
            ? 'rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800'
            : 'rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800'
        }
      >
        {pendingCount > 0
          ? t('reviewPending', { n: pendingCount })
          : t('reviewAllConfirmed')}
      </div>

      {refreshError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 flex items-center justify-between gap-3">
          <span>{refreshError}</span>
          <button
            type="button"
            onClick={() => void refreshProgress()}
            className="shrink-0 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg transition"
          >
            Tải lại tiến độ
          </button>
        </div>
      )}

      <div className="space-y-4">
        {items.map((item) => {
          const pending = isItemPending(item);
          const busy = busyItem === item.path;
          const covered = new Set(item.fields.map((f) => f.path));
          const residualLeaves: ResidualLeaf[] = [];
          collectResidualLeaves(rawValueAt(profileData, item.path), item.path, covered, residualLeaves);

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
                    {t(REVIEW_KIND_KEYS[item.kind])}
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
                  {busy ? 'Đang lưu…' : pending ? t('confirmItem') : 'Đã xác nhận'}
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {item.fields.map((field) => {
                  const inputId = `field-${field.path.replace(/\//g, '-')}`;
                  const kind = editKindForField(field.path);
                  return (
                    <div key={field.path} className={kind === 'list' ? 'space-y-1 sm:col-span-2' : 'space-y-1'}>
                      <label htmlFor={inputId} className="text-xs font-medium text-slate-500">
                        {field.label}
                      </label>
                      {kind === 'text' && (
                        <input
                          id={inputId}
                          value={edited[field.path] ?? ''}
                          onChange={(e) => handleFieldChange(field.path, e.target.value)}
                          placeholder={field.empty ? t('emptyFieldPlaceholder') : undefined}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none"
                        />
                      )}
                      {kind === 'list' && (
                        <textarea
                          id={inputId}
                          value={edited[field.path] ?? ''}
                          onChange={(e) => handleFieldChange(field.path, e.target.value)}
                          placeholder={field.empty ? 'Mỗi dòng một mục — điền vào đây' : undefined}
                          rows={Math.max(2, (edited[field.path] ?? '').split('\n').length)}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none"
                        />
                      )}
                      {kind === 'readonly' && (
                        <p id={inputId} className="text-sm text-slate-700 whitespace-pre-line">
                          {edited[field.path] || 'Chưa có'}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {residualLeaves.length > 0 && (
                <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t('reviewOtherFields')}</p>
                  <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                    {residualLeaves.map((leaf) => (
                      <div key={leaf.path} className="flex items-baseline justify-between gap-2 text-xs">
                        <dt className="text-slate-400 shrink-0">{leaf.label}</dt>
                        <dd className="text-slate-600 text-right break-words">{leaf.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

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
          {completing ? 'Đang hoàn tất…' : t('finishReview')}
        </button>
      </div>
    </div>
  );
}
