import React, { useState } from 'react'
import { ApiError, deleteAccount } from '../lib/api'
import { useSession } from '../lib/session'
import { useLocale, type Locale } from '../lib/i18n'

export function SettingsRoute() {
  const { email, signOut } = useSession()
  const { locale, setLocale, t } = useLocale()
  const [confirmEmail, setConfirmEmail] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function removeAccount() {
    if (!email || confirmEmail.trim().toLowerCase() !== email.toLowerCase()) {
      setError(t('confirmEmailMismatch'))
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await deleteAccount(confirmEmail)
      await signOut()
    } catch (err) {
      setBusy(false)
      setError(err instanceof ApiError ? err.message : t('deleteAccountFailed'))
    }
  }

  return (
    <div data-testid="view-settings" className="p-6 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="bg-gradient-to-r from-slate-900 to-indigo-950 p-6 rounded-2xl text-white">
        <h1 className="text-2xl font-bold">{t('accountSettings')}</h1>
        <p className="text-xs text-slate-300 mt-1">{t('settingsHint')}</p>
      </div>
      <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <label className="block text-xs font-semibold text-slate-700">{t('locale')}<select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} className="mt-2 block rounded-xl border px-3 py-2 text-sm"><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label>
        <h2 className="font-bold text-slate-900">{t('deleteAccount')}</h2>
        <p className="text-xs text-slate-600">{t('deleteAccountWarning')}</p>
        <label className="block text-xs font-semibold text-slate-700" htmlFor="delete-account-email">{t('enterEmailToConfirm')}</label>
        <input id="delete-account-email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} className="w-full max-w-md rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder={email ?? ''} />
        {error && <p role="alert" className="text-xs font-medium text-rose-600">{error}</p>}
        <button disabled={busy} onClick={() => void removeAccount()} className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? t('deleting') : t('deleteAccountPermanently')}</button>
      </section>
    </div>
  )
}
