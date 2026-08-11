import React, { createContext, useContext, useEffect, useState } from 'react';
import { useLocale } from './i18n'
import { Navigate, useLocation } from 'react-router-dom';
import { getSession, logout } from './api';

/**
 * Trạng thái phiên đăng nhập.
 *
 * Ba nhánh, không phải hai: `loading` tách khỏi `anonymous` vì `getSession()`
 * luôn cần một vòng round-trip tới backend. Gộp hai nhánh đó lại thì người
 * đã đăng nhập sẽ thấy màn hình đăng nhập nhấp nháy ở mỗi lần tải trang,
 * trong lúc chờ backend trả lời.
 */
type Status = 'loading' | 'authenticated' | 'anonymous';

interface SessionValue {
  status: Status;
  email?: string;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({
  status: 'loading',
  signOut: async () => {},
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [email, setEmail] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    getSession().then((s) => {
      if (!alive) return;
      setStatus(s.authenticated ? 'authenticated' : 'anonymous');
      setEmail(s.email);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function signOut() {
    try {
      await logout();
    } catch {
      // `logout()` ném ApiError khi mất mạng, phiên đã hết hạn, hay backend
      // trục trặc. Dù backend không xác nhận được, người dùng vẫn phải rời
      // được khỏi màn hình đã đăng nhập — kẹt lại đó còn tệ hơn một lần đăng
      // xuất không trọn vẹn phía server. Cookie hr_session (nếu backend chưa
      // kịp xoá) sẽ tự bị từ chối ở lần gọi API kế tiếp.
    }
    setStatus('anonymous');
    setEmail(undefined);
    // Tải lại thay vì chỉ đổi state: mọi dữ liệu đã nạp của người dùng cũ phải
    // biến mất khỏi bộ nhớ, không chỉ khỏi màn hình.
    window.location.assign('/login');
  }

  return (
    <SessionContext.Provider value={{ status, email, signOut }}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}

/**
 * Chặn route.
 *
 * Trạng thái `loading` có nhánh riêng, không gộp vào `anonymous`. Gộp thì
 * người đã đăng nhập thấy màn hình đăng nhập nhấp nháy ở mỗi lần tải trang,
 * trong khoảng thời gian chờ backend trả lời.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { t } = useLocale()
  const { status } = useSession();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div data-testid="session-loading" className="p-10 text-center text-sm text-slate-500">{t('checkingSession')}</div>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
