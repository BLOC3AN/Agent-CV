import { describe, it, expect } from 'vitest'
import { parseBackfillArgs } from './backfill-args.js'

/**
 * Bộ đọc cờ dòng lệnh của backfill-v2.ts. Tách khỏi script vì script kết nối DB
 * ngay ở top-level await — không test được nếu logic nằm trong đó, và đây đúng
 * là chỗ đã gây ra sự cố dữ liệu thật.
 */
describe('parseBackfillArgs', () => {
  const noEnv = {}

  it('không cờ nào → backfill xuôi, có ghi', () => {
    expect(parseBackfillArgs([], noEnv)).toEqual({ dryRun: false, rollback: false })
  })

  it('--dry-run được nhận', () => {
    expect(parseBackfillArgs(['--dry-run'], noEnv)).toEqual({ dryRun: true, rollback: false })
  })

  it('TỪ CHỐI cờ lạ thay vì bỏ qua trong im lặng', () => {
    // `--dryrun` là lỗi gõ của `--dry-run`. Bản cũ dựng Set rồi chỉ hỏi "có cờ
    // đã biết không", nên lệnh này cho ra rollback=true, dryRun=false: một lượt
    // GHI THẬT đè lên cột `data` của mọi hàng. Đúng hình dạng của sự cố mất dữ
    // liệu đã xảy ra trên nhánh này.
    expect(() => parseBackfillArgs(['--rollback', '--dryrun'], { CONFIRM_ROLLBACK: '1' })).toThrow(
      /--dryrun/,
    )
  })

  it('thông báo lỗi liệt kê cờ hợp lệ để người vận hành sửa được ngay', () => {
    expect(() => parseBackfillArgs(['--force'], noEnv)).toThrow(/--dry-run/)
    expect(() => parseBackfillArgs(['--force'], noEnv)).toThrow(/--rollback/)
  })

  it('TỪ CHỐI rollback ghi thật khi thiếu CONFIRM_ROLLBACK=1', () => {
    // `--rollback` là đường DUY NHẤT ghi vào cột `data` — cột mà apps/web đang
    // phục vụ production đọc. Một cờ gõ nhầm không được phép đủ để chạm vào nó.
    expect(() => parseBackfillArgs(['--rollback'], noEnv)).toThrow(/CONFIRM_ROLLBACK/)
    expect(() => parseBackfillArgs(['--rollback'], { CONFIRM_ROLLBACK: '' })).toThrow(
      /CONFIRM_ROLLBACK/,
    )
    expect(() => parseBackfillArgs(['--rollback'], { CONFIRM_ROLLBACK: 'yes' })).toThrow(
      /CONFIRM_ROLLBACK/,
    )
  })

  it('rollback có CONFIRM_ROLLBACK=1 thì chạy', () => {
    expect(parseBackfillArgs(['--rollback'], { CONFIRM_ROLLBACK: '1' })).toEqual({
      dryRun: false,
      rollback: true,
    })
  })

  it('rollback --dry-run không cần xác nhận: nó không ghi gì', () => {
    expect(parseBackfillArgs(['--rollback', '--dry-run'], noEnv)).toEqual({
      dryRun: true,
      rollback: true,
    })
  })

  it('backfill xuôi không đòi CONFIRM_ROLLBACK', () => {
    expect(parseBackfillArgs([], noEnv).rollback).toBe(false)
  })
})
