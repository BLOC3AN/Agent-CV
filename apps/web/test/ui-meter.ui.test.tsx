import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Meter } from '@/components/ui'

/**
 * BR-02.1: không phần trăm nào mà người dùng không tra được nguồn.
 *
 * Đây là chỗ dễ bịa nhất trong cả sản phẩm, và một con số bịa ở màn hình đầu
 * tiên làm hỏng niềm tin vào mọi thứ phía sau.
 */

const PARTS = [
  { key: 'basics', label: 'Thông tin cá nhân', weight: 20, done: true, todo: '' },
  { key: 'work', label: 'Kinh nghiệm làm việc', weight: 30, done: true, todo: '' },
  { key: 'projects', label: 'Dự án', weight: 25, done: false, todo: 'Thêm ít nhất 2 dự án' },
]

afterEach(() => vi.restoreAllMocks())

describe('Meter', () => {
  it('hiện nhãn và con số', () => {
    render(<Meter value={85} label="Hồ sơ đã đầy đủ" parts={PARTS} />)
    expect(screen.getByText(/Hồ sơ đã đầy đủ/)).toBeInTheDocument()
    expect(screen.getByText('85%')).toBeInTheDocument()
  })

  it('có role progressbar với giá trị đọc được', () => {
    render(<Meter value={85} label="Hồ sơ đã đầy đủ" parts={PARTS} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '85')
  })

  it('phân rã BỊ ẨN lúc đầu — không làm rối màn hình', () => {
    render(<Meter value={85} label="Hồ sơ đã đầy đủ" parts={PARTS} />)
    expect(screen.queryByText('Thông tin cá nhân')).not.toBeInTheDocument()
  })

  it('bấm "Gồm những gì?" thì thấy ĐỦ từng phần kèm trọng số', async () => {
    render(<Meter value={85} label="Hồ sơ đã đầy đủ" parts={PARTS} />)
    await userEvent.click(screen.getByRole('button', { name: /Gồm những gì/ }))
    expect(screen.getByText('Thông tin cá nhân')).toBeInTheDocument()
    expect(screen.getByText('Kinh nghiệm làm việc')).toBeInTheDocument()
    expect(screen.getByText('Dự án')).toBeInTheDocument()
    expect(screen.getByText('(25%)')).toBeInTheDocument()
  })

  it('phần chưa xong nói RÕ phải làm gì', async () => {
    render(<Meter value={85} label="Hồ sơ đã đầy đủ" parts={PARTS} />)
    await userEvent.click(screen.getByRole('button', { name: /Gồm những gì/ }))
    expect(screen.getByText('Thêm ít nhất 2 dự án')).toBeInTheDocument()
  })

  it('KHÔNG có parts: vẫn hiện số, nhưng cảnh báo ở dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<Meter value={85} label="Hồ sơ đã đầy đủ" />)
    expect(screen.getByText('85%')).toBeInTheDocument()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('parts'))
  })

  it('không có parts thì không hiện nút mở — không hứa thứ không có', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<Meter value={85} label="Hồ sơ đã đầy đủ" />)
    expect(screen.queryByRole('button', { name: /Gồm những gì/ })).not.toBeInTheDocument()
  })
})
