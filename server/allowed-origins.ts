/** Exact HTTP(S) origins only. Paths, credentials, wildcard and opaque origins fail closed. */
export function parseAllowedOrigins(primary: string, configured?: string): Set<string> {
  const values = [primary, ...(configured?.split(",") || [])]
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length > 32) throw new Error("ALLOWED_ORIGINS accepts at most 32 exact origins.");
  for (const value of values) {
    let url: URL;
    try { url = new URL(value); }
    catch { throw new Error("ALLOWED_ORIGINS and APP_ORIGIN must contain exact HTTP(S) origins."); }
    if (!["https:", "http:"].includes(url.protocol) || url.origin !== value || url.username || url.password || value.includes("*")) {
      throw new Error("ALLOWED_ORIGINS and APP_ORIGIN cannot contain paths, credentials, wildcards or opaque origins.");
    }
  }
  return new Set(values);
}
