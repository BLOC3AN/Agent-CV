import { describe, it, expect, afterAll } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JobError } from '@hr/db'
import { LocalStorage, contentKey, jobKey } from '../src/storage.js'

const roots: string[] = []

async function tempStore(): Promise<LocalStorage> {
  const root = await mkdtemp(join(tmpdir(), 'hr-store-'))
  roots.push(root)
  return new LocalStorage(root)
}

afterAll(async () => {
  await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })))
})

describe('contentKey', () => {
  it('cùng nội dung → cùng khoá (BR-72.1)', () => {
    const a = new Uint8Array([1, 2, 3])
    const b = new Uint8Array([1, 2, 3])
    expect(contentKey(a)).toBe(contentKey(b))
  })

  it('khác nội dung → khác khoá', () => {
    expect(contentKey(new Uint8Array([1]))).not.toBe(contentKey(new Uint8Array([2])))
  })

  it('phân thư mục con để một thư mục không phình ra hàng vạn file', () => {
    const k = contentKey(new Uint8Array([1, 2, 3]))
    expect(k).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{64}\.pdf$/)
  })
})

describe('jobKey', () => {
  it('ổn định theo input, không phụ thuộc thời điểm gọi', () => {
    expect(jobKey('export_pdf', 'cv-1', 'ats')).toBe(jobKey('export_pdf', 'cv-1', 'ats'))
    expect(jobKey('export_pdf', 'cv-1', 'ats')).not.toBe(jobKey('export_pdf', 'cv-1', 'presentation'))
  })
})

describe('LocalStorage', () => {
  it('ghi rồi đọc lại đúng byte', async () => {
    const s = await tempStore()
    const data = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0x00])
    await s.put('ab/test.pdf', data)
    expect(Array.from(await s.get('ab/test.pdf'))).toEqual(Array.from(data))
  })

  it('file không tồn tại → FILE_MISSING, không phải ENOENT thô', async () => {
    const s = await tempStore()
    const err = await s.get('không/có.pdf').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(JobError)
    expect((err as JobError).code).toBe('FILE_MISSING')
  })

  it('chặn path traversal — khoá đi qua API nên không được tin', async () => {
    const s = await tempStore()
    const bad = ['../../etc/passwd', 'a/../../b.pdf', 'a/../b.pdf', '..', '']
    for (const k of bad) {
      await expect(s.put(k, new Uint8Array([1])), k).rejects.toMatchObject({ code: 'BAD_KEY' })
    }
  })

  it('từ chối khoá TUYỆT ĐỐI thay vì viết lại âm thầm', async () => {
    // join(root, '/etc/passwd') = <root>/etc/passwd — vẫn trong gốc nên kiểm
    // tra tiền tố không bắt được, nhưng khoá đã bị đổi nghĩa
    const s = await tempStore()
    await expect(s.put('/etc/passwd', new Uint8Array([1]))).rejects.toMatchObject({
      code: 'BAD_KEY',
    })
    await expect(s.get('/etc/passwd')).rejects.toMatchObject({ code: 'BAD_KEY' })
    await expect(s.remove('/etc/passwd')).rejects.toMatchObject({ code: 'BAD_KEY' })
  })

  it('không ghi ra ngoài thư mục gốc', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hr-store-'))
    roots.push(root)
    const s = new LocalStorage(root)
    await s.put('cd/x.pdf', new Uint8Array([7]))
    expect(Array.from(await readFile(join(root, 'cd/x.pdf')))).toEqual([7])
  })

  it('STORAGE_ROOT tương đối bị TỪ CHỐI ngay khi khởi tạo', async () => {
    // Web (`next start` trong apps/web) và worker (gốc repo) có cwd khác nhau.
    // Đường dẫn tương đối → hai thư mục khác nhau → worker báo FILE_MISSING với
    // mọi file web vừa lưu, và log không chỉ ra nguyên nhân.
    expect(() => new LocalStorage('./var/storage')).toThrowError(
      expect.objectContaining({ code: 'BAD_STORAGE_ROOT' }),
    )
    expect(() => new LocalStorage('var/storage')).toThrowError(
      expect.objectContaining({ code: 'BAD_STORAGE_ROOT' }),
    )
    expect(() => new LocalStorage('/tmp/hr-abs')).not.toThrow()
  })

  it('xoá file không tồn tại không ném lỗi', async () => {
    const s = await tempStore()
    await expect(s.remove('không/có.pdf')).resolves.toBeUndefined()
  })
})
