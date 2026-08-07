import 'server-only'

/**
 * Gửi email đăng nhập — UC-11 bước 3.
 *
 * ── Vì sao có nhánh "hiện tại chỗ" ──
 * Máy này chưa có SMTP. Hai cách xử lý sai:
 *   · giả vờ đã gửi → người dùng ngồi chờ một email không bao giờ tới
 *   · chặn hẳn đăng nhập → không thử được luồng nào
 * Nên khi chưa cấu hình SMTP, hệ thống NÓI THẲNG là chưa gửi được và đưa link
 * ra màn hình. Ở production chỉ cần đặt `SMTP_URL` là nhánh này tắt.
 */

export interface MailResult {
  /** Đã gửi qua SMTP thật chưa */
  sent: boolean
  /** Link hiện thẳng cho người dùng khi chưa có SMTP — chỉ ở chế độ dev */
  devLink?: string
}

export async function sendLoginLink(email: string, link: string): Promise<MailResult> {
  const smtp = process.env.SMTP_URL
  if (!smtp) {
    if (process.env.ALLOW_DEV_USER !== 'true') {
      // Production mà quên đặt SMTP_URL: KHÔNG được lộ link ra response.
      throw new Error('Chưa cấu hình SMTP_URL nên không gửi được email đăng nhập.')
    }
    console.warn(`[auth] chưa có SMTP_URL — link đăng nhập cho ${email}: ${link}`)
    return { sent: false, devLink: link }
  }

  const nodemailer = await import('nodemailer').catch(() => null)
  if (!nodemailer) throw new Error('Thiếu gói `nodemailer` — chạy `npm i nodemailer`.')

  const t = nodemailer.default.createTransport(smtp)
  await t.sendMail({
    from: process.env.MAIL_FROM ?? 'HR-Agent <no-reply@localhost>',
    to: email,
    subject: 'Link đăng nhập HR-Agent',
    text: `Bấm vào link sau để đăng nhập (hết hạn sau 15 phút):\n\n${link}\n\nNếu bạn không yêu cầu, bỏ qua email này.`,
  })
  return { sent: true }
}
