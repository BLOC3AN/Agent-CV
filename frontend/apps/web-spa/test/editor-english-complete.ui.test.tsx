import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { BuilderRoute } from '../src/routes/BuilderRoute'
import { BuilderLocaleProvider } from '../src/lib/i18n'
import * as api from '../src/lib/api'
import type { CV, CVLayout } from '../src/types'
import { DEFAULT_CV_LAYOUT } from '@hr/schema'

/** Nội dung fixture toàn tiếng Anh, nên mọi dấu tiếng Việt còn lại đều là chữ của giao diện. */
const cv = {
  schemaVersion: 2, id: 'cv-1', language: 'en',
  title: 'Resume',
  lastModified: '',
  sections: {
    intro: { fullName: 'Alex Tran', title: 'Engineer', email: 'alex@example.com', phone: '0900', location: 'Hanoi', summary: 'Builds reliable systems' },
    experience: [{ id: 'e1', title: 'Lead', company: 'Acme', startDate: '2024', endDate: '2025', highlights: ['Shipped a platform'] }],
    projects: [{ id: 'p1', name: 'Platform', role: 'Lead', startDate: '2024', endDate: '2025', highlights: ['Built it'] }],
    education: [{ id: 'd1', school: 'University', degree: 'BSc', fieldOfStudy: 'CS', startDate: '2020', endDate: '2024' }],
    skills: [{ id: 's1', category: 'Backend', skills: ['Go'] }],
    activities: [{ id: 'a1', organization: 'Guild', role: 'Mentor', startDate: '2024', endDate: '2025', highlights: ['Coached'] }],
    certifications: [{ id: 'c1', name: 'Cloud Pro', issuer: 'Cloud Org', date: '2025' }],
    languages: [{ id: 'l1', language: 'English', proficiency: 'C1' }],
  },
  design: { template: 'modern', accentColor: '#000', font: 'Roboto', fontSize: 14, spacing: 'normal' },
  activeSections: { intro: true, experience: true, projects: true, education: true, skills: true, activities: true, certifications: true, languages: true },
  _meta: { verified: {}, source: 'manual', canonical: {} },
} as unknown as CV
const layout = structuredClone(DEFAULT_CV_LAYOUT) as CVLayout

const revision = (number: number) => ({ id: `rev-${number}`, cvId: 'cv-1', number, source: 'user' as const, message: 'Updated contact details', createdAt: '2026-08-10T09:00:00Z' })

afterEach(() => vi.restoreAllMocks())

/**
 * Dấu tiếng Việt. Chữ giao diện chưa dịch gần như luôn chứa ít nhất một dấu,
 * nên đây là lưới rẻ mà bắt được gần hết — và quan trọng hơn, nó tự chỉ ra chỗ
 * còn sót thay vì bắt tôi tự liệt kê, đúng cái đã làm lọt lần trước.
 */
const VIETNAMESE = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i

function vietnameseIn(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('*')]
    .flatMap((element) => [...element.childNodes])
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent?.trim() ?? '')
    .filter((text) => text && VIETNAMESE.test(text))
}

function renderBuilder() {
  vi.spyOn(api, 'getCV').mockResolvedValue({ id: 'cv-1', profileId: 'profile-1', layout, profileSnapshot: cv, revisionNumber: 2 } as never)
  render(
    <RouterProvider
      router={createMemoryRouter([{ path: '/builder/:cvId', element: <BuilderLocaleProvider><BuilderRoute /></BuilderLocaleProvider> }], { initialEntries: ['/builder/cv-1'] })}
    />,
  )
}

describe('trình sửa với CV tiếng Anh', () => {
  it('không còn chữ tiếng Việt nào trong khung soạn thảo', async () => {
    renderBuilder()
    const editor = await screen.findByTestId('cv-editor')

    expect(vietnameseIn(editor)).toEqual([])
  })

  it('không còn chữ tiếng Việt trong tab Thiết kế', async () => {
    renderBuilder()
    const editor = await screen.findByTestId('cv-editor')

    fireEvent.click(within(editor).getByRole('button', { name: /design/i }))

    expect(vietnameseIn(editor)).toEqual([])
  })

  it('không còn chữ tiếng Việt trong panel lịch sử phiên bản', async () => {
    vi.spyOn(api, 'listCVRevisions').mockResolvedValue([revision(2), revision(1)])
    renderBuilder()
    const editor = await screen.findByTestId('cv-editor')

    fireEvent.click(within(editor).getByRole('button', { name: /version history/i }))
    const panel = await screen.findByRole('dialog', { name: /version history/i })
    await within(panel).findAllByRole('button', { name: /^Restore version/i })

    expect(vietnameseIn(panel)).toEqual([])
  })

  it('không còn chữ tiếng Việt trong popup xem trước', async () => {
    renderBuilder()
    await screen.findByTestId('cv-editor')

    window.dispatchEvent(new Event('hr-agent:open-preview'))

    const dialog = await screen.findByRole('dialog', { name: /preview/i })
    await waitFor(() => expect(vietnameseIn(dialog)).toEqual([]))
  })
})
