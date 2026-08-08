import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TopNavView } from '@/components/nav/TopNav'

/**
 * Spec D2: top nav chứ không sidebar. Người dùng thường chỉ có 4 đích, và
 * /builder cần trọn chiều ngang ở 1366×768.
 *
 * BR-01.3: KHÔNG hiện link tới màn hình chưa tồn tại.
 */

describe('TopNavView', () => {
  it('chưa đăng nhập: chỉ có tên sản phẩm và lối đăng nhập', () => {
    render(<TopNavView email={null} cvId={null} />)
    expect(screen.getByRole('link', { name: 'Đăng nhập' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'CV của tôi' })).not.toBeInTheDocument()
  })

  it('đã đăng nhập: có các đích chính', () => {
    render(<TopNavView email="hai@example.com" cvId="cv-1" />)
    expect(screen.getByRole('link', { name: 'Trang chủ' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'CV của tôi' })).toBeInTheDocument()
  })

  it('có nút Trợ lý mang theo CV đang mở', () => {
    render(<TopNavView email="hai@example.com" cvId="cv-1" />)
    expect(screen.getByRole('link', { name: /Trợ lý/ })).toHaveAttribute(
      'href',
      '/builder/cv-1?assistant=1',
    )
  })

  it('CHƯA có CV nào: nút Trợ lý dẫn tới chỗ chọn CV, không mở chat rỗng', () => {
    render(<TopNavView email="hai@example.com" cvId={null} />)
    expect(screen.getByRole('link', { name: /Trợ lý/ })).toHaveAttribute('href', '/cv')
  })

  it('nav là landmark điều hướng', () => {
    render(<TopNavView email="hai@example.com" cvId="cv-1" />)
    expect(screen.getByRole('navigation')).toBeInTheDocument()
  })
})
