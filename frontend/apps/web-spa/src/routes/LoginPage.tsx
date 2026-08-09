import React, { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError, requestLogin } from '../lib/api';
import { useSession } from '../lib/session';

export function LoginPage() {
  const { status } = useSession();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  // Người đã đăng nhập gõ thẳng /login (hoặc còn tab cũ mở sẵn) thì đưa họ về
  // nơi họ định tới trước khi bị chặn — `RequireAuth` gửi kèm qua `state.from`.
  if (status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from || '/'} replace />;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(undefined);
    try {
      const result = await requestLogin(email);
      setSent(true);
      setDevLink(result.devLink);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không gửi được link đăng nhập');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 space-y-5">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-slate-900">Đăng nhập</h1>
          <p className="text-xs text-slate-500">
            Nhập email, chúng tôi gửi cho bạn một đường dẫn đăng nhập. Không cần mật khẩu.
          </p>
        </div>

        {/* noValidate: lỗi định dạng do backend báo, không phải bong bóng
            xác thực HTML5 mặc định của trình duyệt — nhất quán với cách các
            màn hình khác trong SPA hiển thị lỗi. */}
        <form onSubmit={submit} noValidate className="space-y-3">
          <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:border-violet-500"
          />
          <button
            type="submit"
            disabled={sending}
            className="w-full px-4 py-2.5 bg-violet-700 hover:bg-violet-800 disabled:opacity-60 text-white font-semibold text-xs rounded-xl transition"
          >
            {sending ? 'Đang gửi…' : 'Gửi link đăng nhập'}
          </button>
        </form>

        {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

        {sent && !error && (
          <div className="space-y-2 text-xs text-slate-600">
            <p>Đã gửi link đăng nhập. Mở hộp thư của bạn và bấm vào đường dẫn trong email.</p>
            {devLink && (
              <a href={devLink} className="inline-block font-semibold text-violet-700 hover:underline">
                Mở link đăng nhập (chỉ có ở môi trường chạy thử)
              </a>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
