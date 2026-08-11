import React, { createContext, useContext, useMemo, useState } from 'react'

export type Locale = 'vi' | 'en'
const messages = {
  vi: { home: 'Trang chủ', cvs: 'CV của tôi', analyze: 'Đối chiếu việc làm', settings: 'Cài đặt', templates: 'Mẫu CV', preview: 'Xem trước', share: 'Chia sẻ', download: 'Tải PDF', logout: 'Đăng xuất', locale: 'Ngôn ngữ giao diện' },
  en: { home: 'Home', cvs: 'My CVs', analyze: 'Job matching', settings: 'Settings', templates: 'Templates', preview: 'Preview', share: 'Share', download: 'Download PDF', logout: 'Sign out', locale: 'Interface language' },
} as const
type MessageKey = keyof typeof messages.vi
interface LocaleValue { locale: Locale; setLocale: (locale: Locale) => void; t: (key: MessageKey) => string }
const Context = createContext<LocaleValue | null>(null)

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => (typeof localStorage !== 'undefined' && localStorage.getItem('hr-locale') === 'en' ? 'en' : 'vi'))
  function change(next: Locale) { setLocale(next); if (typeof localStorage !== 'undefined') localStorage.setItem('hr-locale', next) }
  const value = useMemo(() => ({ locale, setLocale: change, t: (key: MessageKey) => messages[locale][key] }), [locale])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useLocale(): LocaleValue {
  const value = useContext(Context)
  // Components remain independently testable and embeddable (the route tree
  // provides the real context); standalone renders use Vietnamese defaults.
  return value ?? { locale: 'vi', setLocale: () => {}, t: (key: MessageKey) => messages.vi[key] }
}
