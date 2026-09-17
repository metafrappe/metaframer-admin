import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "../shared/contracts";
import { api, ApiError, errorMessage, isAborted, setCsrfToken } from "./api";

type AuthValue = {
  session: Session | null;
  loading: boolean;
  error: string;
  retry: () => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const apply = (value: Session | null) => {
    setSession(value);
    setCsrfToken(value?.csrfToken || "");
  };
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<{ data: Session }>("/auth/session", { signal: controller.signal })
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
    const result = await api<{ data: Session }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    apply(result.data);
    setError("");
  }
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) throw err;
    }
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
