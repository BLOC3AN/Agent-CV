import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LocaleProvider, useLocale } from '../src/lib/i18n'

/*
 * `test/setup.ts` ghim `hr-locale = 'vi'` cho mọi test UI, vì phần lớn test cũ
 * tra phần tử bằng nhãn tiếng Việt. File này là chỗ DUY NHẤT nói về giá trị mặc
 * định thật của ứng dụng, nên nó phải tự xoá cái ghim đó trước mỗi bài.
 */
beforeEach(() => localStorage.clear())

function Probe() {
  const { locale, t } = useLocale()
  return <div><span data-testid="locale">{locale}</span><span data-testid="copy">{t('cvStructure')}</span></div>
}

describe('ngôn ngữ mặc định', () => {
  it('dùng tiếng Anh khi người dùng chưa chọn gì', () => {
    render(<LocaleProvider><Probe /></LocaleProvider>)

    expect(screen.getByTestId('locale')).toHaveTextContent('en')
    expect(screen.getByTestId('copy')).toHaveTextContent('CV structure')
  })

  it('dùng tiếng Anh cả khi component render trần, không có provider', () => {
    render(<Probe />)

    expect(screen.getByTestId('locale')).toHaveTextContent('en')
  })

  it('tôn trọng lựa chọn tiếng Việt đã lưu, ở cả hai đường', () => {
    localStorage.setItem('hr-locale', 'vi')

    const { unmount } = render(<LocaleProvider><Probe /></LocaleProvider>)
    expect(screen.getByTestId('locale')).toHaveTextContent('vi')
    expect(screen.getByTestId('copy')).toHaveTextContent('Cấu trúc CV')
    unmount()

    render(<Probe />)
    expect(screen.getByTestId('locale')).toHaveTextContent('vi')
  })

  it('bỏ qua giá trị lạ và lùi về tiếng Anh', () => {
    localStorage.setItem('hr-locale', 'fr')

    render(<LocaleProvider><Probe /></LocaleProvider>)

    expect(screen.getByTestId('locale')).toHaveTextContent('en')
  })
})
