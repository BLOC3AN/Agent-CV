import type { Profile } from '@hr/schema'

/**
 * Luồng làm CV từ đầu, có người dẫn — UC-05, PRODUCT §5.2.
 *
 * ── Vì sao không phải một form 30 ô ──
 * Người chưa từng viết CV nhìn thấy một form dài sẽ đóng tab. Và người nhìn
 * thấy mục "Kinh nghiệm làm việc" trống trơn sẽ kết luận mình *không đủ tư
 * cách* — với sinh viên, đó là lý do bỏ cuộc phổ biến nhất.
 *
 * Nên luồng này hỏi TỪNG CỤM, và câu trả lời "chưa đi làm bao giờ" ĐỔI HƯỚNG
 * cả phần còn lại thay vì để lại một chỗ trống (BR-05.2).
 *
 * Tách khỏi React để kiểm được luật chuyển bước mà không cần dựng giao diện.
 */

export type StageId = 'situation' | 'target' | 'experience' | 'body' | 'contact'

export type Situation = 'student' | 'fresher' | 'working' | 'switcher'

export interface GuidedAnswers {
  situation?: Situation
  /** Vị trí nhắm tới */
  target?: string
  /** Đã đi làm bao giờ chưa */
  hasWorked?: boolean
  name?: string
  email?: string
  /** Nội dung cho mục chính: kinh nghiệm HOẶC dự án, tuỳ `hasWorked` */
  bodyTitle?: string
  bodyOrg?: string
  bodyHighlight?: string
}

export const SITUATION_LABEL: Record<Situation, string> = {
  student: 'Sinh viên',
  fresher: 'Mới ra trường',
  working: 'Đang đi làm',
  switcher: 'Chuyển ngành',
}

/**
 * Bước tiếp theo, hoặc `null` khi đã đủ để dựng hồ sơ.
 *
 * Thứ tự cố định: tình trạng → vị trí nhắm tới → đã đi làm chưa → nội dung
 * chính → liên hệ. Hỏi tình trạng TRƯỚC vì nó quyết định cách hỏi phần sau.
 */
export function nextStage(a: GuidedAnswers): StageId | null {
  if (!a.situation) return 'situation'
  if (!a.target?.trim()) return 'target'
  if (a.hasWorked === undefined) return 'experience'
  if (!a.bodyTitle?.trim()) return 'body'
  if (!a.name?.trim()) return 'contact'
  return null
}

/** Bước trước đó, để nút "Quay lại" luôn có chỗ để về (BR-05.1). */
export function previousStage(current: StageId): StageId | null {
  const order: StageId[] = ['situation', 'target', 'experience', 'body', 'contact']
  const i = order.indexOf(current)
  return i > 0 ? order[i - 1]! : null
}

/**
 * Lời dẫn cho bước "nội dung chính" — đây là chỗ ĐỔI HƯỚNG (BR-05.2).
 *
 * Chưa đi làm KHÔNG được trình bày như một thiếu sót. Với sinh viên, dự án mới
 * là phần nhà tuyển dụng đọc kỹ, và câu này nói thẳng điều đó.
 */
export function bodyPrompt(a: GuidedAnswers): {
  title: string
  lead: string
  labelTitle: string
  labelOrg: string
  labelHighlight: string
} {
  if (a.hasWorked === false) {
    return {
      title: 'Kể mình nghe một dự án của bạn',
      lead: 'Không sao — mình sẽ tập trung vào Dự án, Học vấn và Kỹ năng. Với sinh viên và người mới ra trường, đó mới là phần nhà tuyển dụng đọc kỹ.',
      labelTitle: 'Tên dự án',
      labelOrg: 'Làm ở đâu (môn học, CLB, tự làm…)',
      labelHighlight: 'Bạn đã làm gì trong dự án đó?',
    }
  }
  return {
    title: 'Kể mình nghe công việc gần nhất',
    lead: 'Bắt đầu từ chỗ làm gần nhất. Các chỗ khác bạn thêm sau trong trình soạn.',
    labelTitle: 'Chức danh',
    labelOrg: 'Công ty / tổ chức',
    labelHighlight: 'Việc bạn đã làm ở đó',
  }
}

/**
 * Dựng `Profile` từ câu trả lời — UC-05 bước 4.
 *
 * KHÔNG bịa gì thêm (BR-05.4): mọi chữ trong hồ sơ đều do người dùng gõ. Trợ
 * lý giúp viết lại cho hay hơn ở bước sau, trong trình soạn, nơi họ duyệt từng
 * thay đổi (UC-53).
 */
export function buildProfile(a: GuidedAnswers): Partial<Profile> {
  const highlights = a.bodyHighlight?.trim() ? [a.bodyHighlight.trim()] : []
  const body = a.hasWorked
    ? {
        work: [
          {
            org: a.bodyOrg?.trim() || 'Chưa điền',
            role: a.bodyTitle?.trim() || 'Chưa điền',
            highlights,
          },
        ],
      }
    : {
        projects: [
          {
            name: a.bodyTitle?.trim() || 'Chưa điền',
            tech: [],
            highlights,
          },
        ],
      }

  return {
    schemaVersion: 1,
    language: 'vi',
    basics: {
      name: a.name?.trim() || '',
      ...(a.target?.trim() ? { headline: a.target.trim() } : {}),
      ...(a.email?.trim() ? { email: a.email.trim() } : {}),
      links: [],
    },
    ...body,
  } as Partial<Profile>
}
