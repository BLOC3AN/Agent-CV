/**
 * Đọc cờ dòng lệnh cho backfill-v2.ts.
 *
 * Sống ở file riêng vì backfill-v2.ts kết nối DB ngay tại top-level await:
 * logic nằm trong đó thì không test được, mà đây chính là chỗ đã gây ra sự cố
 * mất dữ liệu trên nhánh này.
 *
 * Bản cũ dựng `new Set(process.argv.slice(2))` rồi chỉ hỏi "cờ đã biết có mặt
 * không". Hệ quả: `--rollback --dryrun` (gõ nhầm `--dry-run`) cho ra
 * `rollback=true, dryRun=false` — một lượt GHI THẬT đè lên cột `data` của mọi
 * hàng, im lặng và không thể hoàn tác. Cờ lạ phải là lỗi, không phải im lặng.
 */

export interface BackfillArgs {
  dryRun: boolean
  rollback: boolean
}

const KNOWN_FLAGS = ['--dry-run', '--rollback'] as const

/**
 * `--rollback` (không kèm `--dry-run`) là đường DUY NHẤT ghi vào cột `data` —
 * cột mà apps/web đang phục vụ production đọc. Đòi thêm một biến môi trường
 * tường minh để một cờ gõ nhầm hay một dòng lệnh chép lại từ lịch sử shell
 * không bao giờ đủ để chạm vào nó. Dry-run không ghi gì nên không cần xác nhận.
 */
export const ROLLBACK_CONFIRM_ENV = 'CONFIRM_ROLLBACK'

export function parseBackfillArgs(
  argv: string[],
  env: Record<string, string | undefined>,
): BackfillArgs {
  const unknown = argv.filter((token) => !KNOWN_FLAGS.includes(token as (typeof KNOWN_FLAGS)[number]))
  if (unknown.length) {
    throw new Error(
      `Tham số không hợp lệ: ${unknown.join(', ')}. Chỉ chấp nhận ${KNOWN_FLAGS.join(', ')}. ` +
        `Cờ lạ bị bỏ qua trong im lặng từng khiến "--rollback --dryrun" chạy ghi thật lên cột data.`,
    )
  }

  const dryRun = argv.includes('--dry-run')
  const rollback = argv.includes('--rollback')

  if (rollback && !dryRun && env[ROLLBACK_CONFIRM_ENV] !== '1') {
    throw new Error(
      `--rollback ghi đè cột "data" của MỌI hàng có data_v2 — đây là đường duy nhất chạm vào ` +
        `dữ liệu mà apps/web đang phục vụ. Đặt ${ROLLBACK_CONFIRM_ENV}=1 để xác nhận, hoặc chạy ` +
        `"--rollback --dry-run" để xem trước mà không ghi gì.`,
    )
  }

  return { dryRun, rollback }
}
