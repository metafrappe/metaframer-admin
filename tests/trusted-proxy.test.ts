/** Local HTTP checks only; no request is sent to Frappe. */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { parseTrustedProxyIps } from "../server/trusted-proxy.ts";

function appFor(trustedProxyIps?: string) {
  return createApp({
    frappeUrl: "https://erp-test.metaframer.net",
    origin: "https://admin.example.invalid",
    sessionSecret: "test-only-session-secret-over-32-characters",
    publicGroup: "Metaframer Demo",
    production: true,
    trustedProxyIps,
  });
}

async function probe(t: TestContext, trustedProxyIps?: string) {
  const app = appFor(trustedProxyIps);
  // This diagnostic route exists only in the test app.
  app.get("/proxy-test", (req, res) =>
    res.json({ ip: req.ip, ips: req.ips, protocol: req.protocol }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return async (forwardedFor = "198.51.100.42") => {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/proxy-test`,
      { headers: { "X-Forwarded-For": forwardedFor, "X-Forwarded-Proto": "https" } },
    );
    assert.equal(response.status, 200);
    return response.json();
  };
}

test("proxy setting defaults to no trust and accepts a bounded literal-IP allowlist", () => {
  assert.deepEqual(parseTrustedProxyIps(undefined), []);
  assert.deepEqual(parseTrustedProxyIps(" "), []);
  assert.deepEqual(parseTrustedProxyIps("127.0.0.1, ::1,127.0.0.1"), ["127.0.0.1", "::1"]);
  assert.deepEqual(parseTrustedProxyIps("192.0.2.10,2001:db8::2"), ["192.0.2.10", "2001:db8::2"]);
});

test("invalid or broad proxy configuration fails at app startup", () => {
  for (const value of [
    "true", "false", "1", "loopback", "localhost", "*",
    "0.0.0.0/0", "::/0", "127.0.0.0/8", "0.0.0.0", "::",
    "127.0.0.1,", "127.0.0.1,,::1", "127.0.0.999", "fe80::1%lo0",
    Array.from({ length: 17 }, (_, i) => `192.0.2.${i + 1}`).join(","),
  ]) {
    assert.throws(() => appFor(value), /TRUSTED_PROXY_IPS/, value);
  }
});

test("forged forwarding headers are ignored by default", async (t) => {
  const request = await probe(t);
  assert.deepEqual(await request(), {
    ip: "127.0.0.1", ips: [], protocol: "http",
  });
});

test("a configured local proxy supplies the client IP and HTTPS protocol", async (t) => {
  const request = await probe(t, "127.0.0.1,::1");
  assert.deepEqual(await request(), {
    ip: "198.51.100.42", ips: ["198.51.100.42"], protocol: "https",
  });
});

test("a caller outside the proxy allowlist cannot forge client identity", async (t) => {
  const request = await probe(t, "192.0.2.10");
  assert.deepEqual(await request(), {
    ip: "127.0.0.1", ips: [], protocol: "http",
  });
});

test("client-controlled addresses beyond the nearest untrusted hop are ignored", async (t) => {
  const request = await probe(t, "127.0.0.1,::1");
  assert.deepEqual(await request("203.0.113.7, 198.51.100.42"), {
    ip: "198.51.100.42", ips: ["198.51.100.42"], protocol: "https",
  });
});
