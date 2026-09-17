import type { ApiProblem } from "../shared/contracts";

let csrfToken = "";
export function setCsrfToken(value: string) {
  csrfToken = value;
}

export class ApiError extends Error {
  status: number;
  requestId?: string;
  constructor(message: string, status: number, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.requestId = requestId;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD"].includes(method) && csrfToken)
    headers.set("X-CSRF-Token", csrfToken);
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...init,
      method,
      headers,
      credentials: "include",
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiError(
      "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip yeniden deneyin.",
      0,
    );
  }
  if (!response.ok) {
    const problem = (await response
      .json()
      .catch(() => ({}))) as Partial<ApiProblem>;
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    const fallback =
      response.status === 401
        ? "Oturumunuz sona erdi. Lütfen yeniden giriş yapın."
        : response.status === 403
          ? "Bu işlem için yetkiniz bulunmuyor."
          : "İşlem tamamlanamadı. Lütfen yeniden deneyin.";
    throw new ApiError(
      problem.detail || problem.title || fallback,
      response.status,
      problem.requestId,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Beklenmeyen bir sorun oluştu.";
}
export function isAborted(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}
export function plainText(value: string) {
  if (!/[<>]/.test(value)) return value;
  return (
    new DOMParser().parseFromString(value, "text/html").body.textContent || ""
  );
}
