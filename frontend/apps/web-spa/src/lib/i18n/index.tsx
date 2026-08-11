import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { vi, type MessageKey } from './messages.vi'
import { en } from './messages.en'

export type Locale = 'vi' | 'en'
export type { MessageKey }

const messages: Record<Locale, Record<MessageKey, string>> = { vi, en }

export type MessageParams = Record<string, string | number>

/**
 * Chèn tham số dạng `{n}` — chuỗi như "Phiên bản {n}" phải giữ nguyên câu chữ
 * của từng ngôn ngữ thay vì bị nối chuỗi ngoài chỗ dùng, vì trật tự từ giữa hai
 * ngôn ngữ không giống nhau.
 */
function format(template: string, params?: MessageParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole))
}

interface LocaleValue { locale: Locale; setLocale: (locale: Locale) => void; t: (key: MessageKey, params?: MessageParams) => string }
const Context = createContext<LocaleValue | null>(null)

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => (typeof localStorage !== 'undefined' && localStorage.getItem('hr-locale') === 'en' ? 'en' : 'vi'))
  function change(next: Locale) { setLocale(next); if (typeof localStorage !== 'undefined') localStorage.setItem('hr-locale', next) }
  const value = useMemo(() => ({ locale, setLocale: change, t: (key: MessageKey, params?: MessageParams) => format(messages[locale][key], params) }), [locale])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useLocale(): LocaleValue {
  const value = useContext(Context)
  // Components remain independently testable and embeddable (the route tree
  // provides the real context); standalone renders use Vietnamese defaults.
  return value ?? { locale: 'vi', setLocale: () => {}, t: (key: MessageKey, params?: MessageParams) => format(messages.vi[key], params) }
}

interface BuilderLocaleValue {
  /** Vắng mặt nghĩa là không có CV nào đang mở — `Header` dựa vào đây để ẩn bộ chọn. */
  language?: Locale
  setLanguage: (next: Locale) => void
  register: (language: Locale, onChange: (next: Locale) => void) => void
  unregister: () => void
}

const BuilderContext = createContext<BuilderLocaleValue | null>(null)

/**
 * Nối bộ chọn ngôn ngữ trên `Header` với CV đang mở.
 *
 * `Header` do `AppLayout` dựng nên nằm TRÊN `BuilderRoute` trong cây React, vì
 * vậy nó không đọc được CV. Provider này bọc cả hai, `BuilderRoute` đăng ký
 * `cv.language` cùng hàm đổi, `Header` lấy ra để dựng bộ chọn.
 *
 * Provider KHÔNG giữ bản sao ngôn ngữ nào của riêng nó: `setLanguage` chỉ gọi
 * lại đúng hàm đã đăng ký. Nó cũng không còn quyết định ngôn ngữ giao diện —
 * việc đó thuộc về `LocaleProvider` và tuỳ chọn của người dùng.
 */
export function BuilderLocaleProvider({ children }: { children: React.ReactNode }) {
  const [registered, setRegistered] = useState<{ language: Locale; onChange: (next: Locale) => void }>()

  const register = useCallback((language: Locale, onChange: (next: Locale) => void) => {
    setRegistered((current) => (current?.language === language && current.onChange === onChange ? current : { language, onChange }))
  }, [])
  const unregister = useCallback(() => setRegistered(undefined), [])

  const builderValue = useMemo<BuilderLocaleValue>(() => ({
    language: registered?.language,
    setLanguage: (next: Locale) => registered?.onChange(next),
    register,
    unregister,
  }), [registered, register, unregister])

  /*
   * Provider KHÔNG ghi đè `useLocale()` nữa.
   *
   * Bản trước ghim giao diện theo `cv.language`, nên chọn English ở trang tổng
   * quan rồi mở một CV tiếng Việt là cả trình sửa quay về tiếng Việt — một luật
   * ẩn không ai nói trước, và người dùng chỉ thấy "tôi chọn English mà nó vẫn
   * tiếng Việt". Giờ tuỳ chọn của người dùng luôn thắng; provider chỉ còn làm
   * một việc là nối bộ chọn trên `Header` với CV đang mở.
   */
  return <BuilderContext.Provider value={builderValue}>{children}</BuilderContext.Provider>
}

export function useBuilderLocale(): BuilderLocaleValue {
  return useContext(BuilderContext) ?? { language: undefined, setLanguage: () => {}, register: () => {}, unregister: () => {} }
}
