import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RichText } from '@/components/chat/RichText'

describe('RichText — Markdown, LaTeX và Mermaid', () => {
  it('render Markdown/GFM thành phần tử semantic', () => {
    render(<RichText content={'## Skills\n\n- Go\n- **React**\n\n| A | B |\n|---|---|\n| 1 | 2 |'} />)
    expect(screen.getByRole('heading', { name: 'Skills' })).toBeInTheDocument()
    expect(screen.getByText('React')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('render công thức LaTeX qua KaTeX', () => {
    const { container } = render(<RichText content={'Công thức: $E=mc^2$'} />)
    expect(container.querySelector('.katex')).toBeInTheDocument()
  })

  it('nhận diện code fence Mermaid và tạo vùng biểu đồ', () => {
    const { container } = render(
      <RichText content={'```mermaid\nflowchart TD\n  A[Start] --> B[Done]\n```'} />,
    )
    expect(container.querySelector('.chat-mermaid')).toBeInTheDocument()
  })
})
