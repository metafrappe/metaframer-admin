import { isIP } from "node:net";

/**
 * Explicit proxy addresses only: never booleans, hop counts, aliases or CIDRs.
 * The edge proxy must replace forwarded headers and be the only public ingress.
 */
export function parseTrustedProxyIps(value?: string): string[] {
  if (!value?.trim()) return [];
  const addresses = value.split(",").map((part) => part.trim());
  if (
    addresses.length > 16 ||
    addresses.some(
      (address) =>
        !isIP(address) ||
        address.includes("%") ||
        address === "0.0.0.0" ||
        address === "::",
    )
  ) {
    throw new Error(
      "TRUSTED_PROXY_IPS must contain at most 16 comma-separated literal proxy IP addresses (for example 127.0.0.1,::1).",
    );
  }
  return [...new Set(addresses)];
}
