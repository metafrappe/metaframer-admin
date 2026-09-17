import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "../shared/contracts";
import {
  api,
  ApiError,
  errorMessage,
  hasAccessToken,
  isAborted,
  setAccessToken,
  setCsrfToken,
  usesRemoteApi,
} from "./api";

type SessionResponse = Session & { accessToken?: string };
const logoutNoticeKey = "mf_admin_logout_notice";
const remoteLogoutWarning =
  "Bu sekmeden çıkıldı; sunucu oturumu kapatılamadı. Oturum süresi dolana kadar başka kopyalar geçerli kalabilir.";
function readLogoutNotice() {
  try {
    return sessionStorage.getItem(logoutNoticeKey) === "1"
      ? remoteLogoutWarning
      : "";
  } catch {
    return "";
  }
}

type AuthValue = {
  session: Session | null;
  loading: boolean;
  error: string;
  retry: () => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutNotice: string;
  clearLogoutNotice: () => void;
};
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [logoutNotice, setLogoutNotice] = useState(readLogoutNotice);
  function updateLogoutNotice(warn: boolean) {
    setLogoutNotice(warn ? remoteLogoutWarning : "");
    try {
      if (warn) sessionStorage.setItem(logoutNoticeKey, "1");
      else sessionStorage.removeItem(logoutNoticeKey);
    } catch {
      /* When storage is blocked, retain the notice in this tab's memory. */
    }
  }
  const apply = (value: SessionResponse | null) => {
    if (value?.accessToken) setAccessToken(value.accessToken);
    if (!value) setAccessToken(null);
    setSession(value ? { user: value.user, csrfToken: value.csrfToken } : null);
    setCsrfToken(value?.csrfToken || "");
  };
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<{ data: SessionResponse }>("/auth/session", {
      signal: controller.signal,
    })
      .then((result) => apply(result.data))
      .catch((err) => {
        if (isAborted(err)) return;
        if (err instanceof ApiError && err.status === 401) apply(null);
        else setError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    const expire = () => apply(null);
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, []);
  async function login(username: string, password: string) {
    const result = await api<{ data: SessionResponse }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (usesRemoteApi && !result.data.accessToken) {
      throw new ApiError(
        "API oturum bilgisi alınamadı. Bağlantı yapılandırmasını kontrol edin.",
        502,
      );
    }
    apply(result.data);
    updateLogoutNotice(false);
    setError("");
  }
  async function logout() {
    const bearerSession = usesRemoteApi || hasAccessToken();
    let upstreamLogoutFailed = false;
    try {
      await api("/auth/logout", { method: "POST" });
    } catch (err) {
      const expired = err instanceof ApiError && err.status === 401;
      if (!bearerSession && !expired) throw err;
      upstreamLogoutFailed = !expired;
      // Remote sessions must always be removed from this tab, including when
      // upstream logout is unavailable. The token is never kept after logout.
    }
    updateLogoutNotice(upstreamLogoutFailed);
    apply(null);
  }
  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        error,
        retry: () => setAttempt((value) => value + 1),
        login,
        logout,
        logoutNotice,
        clearLogoutNotice: () => updateLogoutNotice(false),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider bulunamadı.");
  return value;
}
