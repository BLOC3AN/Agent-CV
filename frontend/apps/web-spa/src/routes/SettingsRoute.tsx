import React, { useState } from 'react'
import { ApiError, deleteAccount } from '../lib/api'
import { useSession } from '../lib/session'

export function SettingsRoute() {
  const { email, signOut } = useSession()
  const [confirmEmail, setConfirmEmail] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function removeAccount() {
    if (!email || confirmEmail.trim().toLowerCase() !== email.toLowerCase()) {
      setError('Email xác nhận phải trùng chính xác với email tài khoản.')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await deleteAccount(confirmEmail)
      await signOut()
    } catch (err) {
      setBusy(false)
      setError(err instanceof ApiError ? err.message : 'Không xoá được tài khoản')
    }
  }

  return (
    <div data-testid="view-settings" className="p-6 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="bg-gradient-to-r from-slate-900 to-indigo-950 p-6 rounded-2xl text-white">
        <h1 className="text-2xl font-bold">Cài đặt tài khoản</h1>
        <p className="text-xs text-slate-300 mt-1">Quản lý phiên đăng nhập và dữ liệu CV.</p>
      </div>
      <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <h2 className="font-bold text-slate-900">Xoá tài khoản</h2>
        <p className="text-xs text-slate-600">Thao tác này xoá vĩnh viễn tài khoản và toàn bộ CV, không thể khôi phục.</p>
        <label className="block text-xs font-semibold text-slate-700" htmlFor="delete-account-email">Nhập email để xác nhận</label>
        <input id="delete-account-email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} className="w-full max-w-md rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder={email ?? ''} />
        {error && <p role="alert" className="text-xs font-medium text-rose-600">{error}</p>}
        <button disabled={busy} onClick={() => void removeAccount()} className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Đang xoá…' : 'Xoá tài khoản vĩnh viễn'}</button>
      </section>
    </div>
  )
}
