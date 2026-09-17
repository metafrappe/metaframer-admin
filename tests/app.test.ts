/** Local HTTP integration tests. The Frappe dependency is an explicit stub. */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import { sealData } from 'iron-session';
import { createApp, type Config } from '../server/app.ts';
import { parseAllowedOrigins } from '../server/allowed-origins.ts';
import { ApiError, type Frappe } from '../server/frappe.ts';

const ORIGIN = 'http://admin.local.test';
const PAGES_ORIGIN = 'https://metafrappe.github.io';
const SESSION_SECRET = 'a-test-only-session-secret-over-32-characters';
const UPSTREAM_SID = 'upstream-session-must-stay-private';
const UPSTREAM_CSRF = 'upstream-csrf-must-stay-private';
const CATALOG_SECRET = 'server-to-server-catalog-secret-test-only';
const CATALOG_TOKEN = 'frappe-read-key:frappe-read-secret-test-only';
const PRODUCT = { id: 'TEST-1', code: 'TEST-1', name: 'Test', description: '', group: 'Headless Demo', uom: 'Nos', image: null, disabled: false, isStockItem: true, hasVariants: false, variantOf: null, attributes: [], modified: '2026-09-17 10:00:00.000000' };
const INPUT = { code: 'TEST-1', name: 'Test', description: '', group: 'Headless Demo', uom: 'Nos', image: null, disabled: false, isStockItem: true };
type StubCall = { method: string; args: any[] };
type Behavior = Partial<Record<string, (...args: any[]) => unknown>>;

async function harness(t: TestContext, behavior: Behavior = {}, overrides: Partial<Config> = {}) {
  const calls: StubCall[] = [];
  const values: Record<string, (...args: any[]) => unknown> = {
    login: (username: string, password: string) => {
      if (username !== 'demo@example.invalid' || password !== 'test-only-password') throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Invalid test credentials');
      return { sid: UPSTREAM_SID, csrf: UPSTREAM_CSRF, user: username };
    },
    user: () => 'demo@example.invalid',
    request: () => ({ data: {} }),
    list: () => ({ data: [PRODUCT], meta: { source: 'frappe', page: 1, pageSize: 20, hasMore: false } }),
    variants: (_id: string, _credentials: unknown, query: any) => ({ data: [{ ...PRODUCT, variantOf: 'TEMPLATE' }], meta: { source: 'frappe', page: query.page, pageSize: query.pageSize, hasMore: false } }),
    detail: () => ({ data: { product: PRODUCT, variants: [] }, meta: { source: 'frappe' } }),
    options: () => ({ data: { itemGroups: ['Headless Demo'], uoms: ['Nos'], publicGroup: 'Headless Demo' } }),
    save: (input: any) => ({ data: { ...PRODUCT, ...input } }),
    remove: () => undefined,
    ...behavior,
  };
  const stub: Record<string, unknown> = { base: 'https://erp-test.metaframer.net' };
  for (const [method, implementation] of Object.entries(values)) stub[method] = async (...args: any[]) => { calls.push({ method, args }); return implementation(...args); };
  const config: Config = { frappeUrl: 'https://erp-test.metaframer.net', origin: ORIGIN, sessionSecret: SESSION_SECRET, catalogSecret: CATALOG_SECRET, catalogToken: CATALOG_TOKEN, publicGroup: 'Headless Demo', production: false, ...overrides };
  const app = createApp(config, stub as unknown as Frappe);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function request(path: string, init: RequestInit = {}) { return fetch(`${base}${path}`, { ...init, redirect: 'manual' }); }
  async function login() {
    const response = await request('/api/v1/auth/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'demo@example.invalid', password: 'test-only-password' }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    const setCookie = response.headers.getSetCookie().find(cookie => cookie.startsWith('mf_admin_session='));
    assert.ok(setCookie);
    return { response, body, setCookie, cookie: setCookie.split(';')[0], csrf: body.data.csrfToken as string };
  }
  return { request, login, calls };
}

function mutationHeaders(cookie: string, csrf: string) { return { Cookie: cookie, Origin: ORIGIN, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }; }

test('login requires the configured browser Origin before forwarding credentials', async t => {
  const { request, calls } = await harness(t);
  for (const origin of [undefined, 'https://attacker.invalid']) {
    const response = await request('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ username: 'demo@example.invalid', password: 'test-only-password' }) });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).title, 'ORIGIN_DENIED');
  }
  assert.equal(calls.length, 0);
});

test('login returns a separate CSRF value and encrypted HttpOnly cookie, never the Frappe session', async t => {
  const { login, request, calls } = await harness(t);
  const session = await login();
  assert.match(session.setCookie, /; HttpOnly/i);
  assert.match(session.setCookie, /; SameSite=Lax/i);
  assert.doesNotMatch(session.setCookie, new RegExp(`${UPSTREAM_SID}|${UPSTREAM_CSRF}|test-only-password`));
  assert.deepEqual(Object.keys(session.body.data).sort(), ['csrfToken', 'user']);
  assert.ok(session.csrf.length >= 32);
  assert.notEqual(session.csrf, UPSTREAM_CSRF);
  const current = await request('/api/v1/auth/session', { headers: { Cookie: session.cookie } });
  assert.equal(current.status, 200);
  assert.equal((await current.json()).data.user, 'demo@example.invalid');
  const userCall = calls.find(call => call.method === 'user');
  assert.deepEqual(userCall?.args[0], { sid: UPSTREAM_SID, csrf: UPSTREAM_CSRF });
  assert.equal(current.headers.get('Cache-Control'), 'no-store');
});

test('anonymous users and an arbitrary Bearer token cannot access admin products', async t => {
  const { request, calls } = await harness(t);
  const headersToTry: HeadersInit[] = [{}, { Authorization: `Bearer ${CATALOG_SECRET}` }];
  for (const headers of headersToTry) {
    const response = await request('/api/v1/products', { headers });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).title, 'AUTHENTICATION_REQUIRED');
  }
  assert.equal(calls.length, 0);
});

test('invalid login payload receives a structured 422 without reaching Frappe', async t => {
  const { request, calls } = await harness(t);
  const response = await request('/api/v1/auth/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: '', password: 'test', role: 'Administrator' }) });
  assert.equal(response.status, 422);
  assert.match(response.headers.get('Content-Type')!, /application\/problem\+json/);
  const body = await response.json();
  assert.equal(body.title, 'VALIDATION_ERROR');
  assert.equal(typeof body.requestId, 'string');
  assert.equal(calls.length, 0);
});

test('each mutation needs both same Origin and the session-specific local CSRF', async t => {
  const { login, request, calls } = await harness(t);
  const session = await login();
  const attempts: HeadersInit[] = [
    { Cookie: session.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
    { Cookie: session.cookie, 'Content-Type': 'application/json', Origin: ORIGIN },
    { Cookie: session.cookie, 'Content-Type': 'application/json', Origin: ORIGIN, 'X-CSRF-Token': UPSTREAM_CSRF },
  ];
  for (const headers of attempts) {
    const response = await request('/api/v1/products', { method: 'POST', headers, body: JSON.stringify(INPUT) });
    assert.equal(response.status, 403);
  }
  assert.equal(calls.filter(call => call.method === 'save').length, 0);
});

test('authenticated creation validates input and passes the user session, not the service token', async t => {
  const { login, request, calls } = await harness(t);
  const session = await login();
  const headers = mutationHeaders(session.cookie, session.csrf);
  const invalid = await request('/api/v1/products', { method: 'POST', headers, body: JSON.stringify({ ...INPUT, flags: { ignore_permissions: true } }) });
  assert.equal(invalid.status, 422);
  assert.equal(calls.filter(call => call.method === 'save').length, 0);
  const valid = await request('/api/v1/products', { method: 'POST', headers, body: JSON.stringify(INPUT) });
  assert.equal(valid.status, 201);
  assert.equal(valid.headers.get('Location'), '/api/v1/products/TEST-1');
  const save = calls.find(call => call.method === 'save');
  assert.deepEqual(save?.args[0], INPUT);
  assert.deepEqual(save?.args[1], { sid: UPSTREAM_SID, csrf: UPSTREAM_CSRF });
});

test('updates require a modified timestamp and preserve upstream stale-write 409', async t => {
  const { login, request, calls } = await harness(t, { save: () => { throw new ApiError(409, 'CONFLICT', 'Stale test version'); } });
  const session = await login();
  const headers = mutationHeaders(session.cookie, session.csrf);
  const missingVersion = await request('/api/v1/products/TEST-1', { method: 'PATCH', headers, body: JSON.stringify({ name: 'Changed' }) });
  assert.equal(missingVersion.status, 422);
  assert.equal(calls.filter(call => call.method === 'save').length, 0);
  const stale = await request('/api/v1/products/TEST-1', { method: 'PATCH', headers, body: JSON.stringify({ name: 'Changed', modified: PRODUCT.modified }) });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).title, 'CONFLICT');
});

test('a name-only PATCH preserves omitted description, image and product flags', async t => {
  const existing = { ...PRODUCT, description: 'Keep this description', image: 'https://example.invalid/existing.jpg', disabled: true, isStockItem: false };
  const { login, request, calls } = await harness(t, { save: input => ({ data: { ...existing, ...input } }) });
  const session = await login();
  const patch = { name: 'Renamed only', modified: PRODUCT.modified };
  const response = await request('/api/v1/products/TEST-1', {
    method: 'PATCH', headers: mutationHeaders(session.cookie, session.csrf), body: JSON.stringify(patch),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { ...existing, ...patch });
  assert.deepEqual(calls.find(call => call.method === 'save')?.args[0], patch);
});

test('creation still applies defaults to omitted optional product fields', async t => {
  const { login, request, calls } = await harness(t);
  const session = await login();
  const input = { code: INPUT.code, name: INPUT.name, group: INPUT.group, uom: INPUT.uom };
  const response = await request('/api/v1/products', {
    method: 'POST', headers: mutationHeaders(session.cookie, session.csrf), body: JSON.stringify(input),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(calls.find(call => call.method === 'save')?.args[0], {
    ...input, description: '', image: null, disabled: false, isStockItem: true,
  });
});

test('Frappe record permission refusal stays 403 without escalating to the catalog account', async t => {
  const { login, request, calls } = await harness(t, { list: () => { throw new ApiError(403, 'PERMISSION_DENIED', 'Test permission denied'); } });
  const session = await login();
  const response = await request('/api/v1/products', { headers: { Cookie: session.cookie } });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).title, 'PERMISSION_DENIED');
  const list = calls.find(call => call.method === 'list');
  assert.deepEqual(list?.args[0], { sid: UPSTREAM_SID, csrf: UPSTREAM_CSRF });
  const current = await request('/api/v1/auth/session', { headers: { Cookie: session.cookie } });
  assert.equal(current.status, 200);
});

test('revoked upstream sessions become 401 and the local cookie is removed', async t => {
  const { login, request, calls } = await harness(t, { user: () => { throw new ApiError(403, 'PERMISSION_DENIED', 'Session no longer exists'); } });
  const session = await login();
  const response = await request('/api/v1/products', { headers: { Cookie: session.cookie } });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).title, 'SESSION_EXPIRED');
  assert.match(response.headers.get('Set-Cookie')!, /Max-Age=0/i);
  assert.equal(calls.filter(call => call.method === 'list').length, 0);
});

test('catalog routes require the inter-server secret and only use the configured read token/group', async t => {
  const { request, calls } = await harness(t);
  for (const authorization of ['', 'Bearer wrong-secret']) {
    const denied = await request('/api/v1/catalog/products', { headers: { Authorization: authorization } });
    assert.equal(denied.status, 401);
  }
  assert.equal(calls.length, 0);
  const allowed = await request('/api/v1/catalog/products?status=all', { headers: { Authorization: `Bearer ${CATALOG_SECRET}` } });
  assert.equal(allowed.status, 200);
  const text = await allowed.text();
  assert.doesNotMatch(text, new RegExp(`${CATALOG_SECRET}|${CATALOG_TOKEN}|${UPSTREAM_SID}`));
  const list = calls.find(call => call.method === 'list');
  assert.deepEqual(list?.args[0], { token: CATALOG_TOKEN });
  assert.equal(list?.args[2], 'Headless Demo');
});

test('catalog group cannot be overridden to expose private inventory', async t => {
  const { request, calls } = await harness(t);
  const response = await request('/api/v1/catalog/products?group=Private', { headers: { Authorization: `Bearer ${CATALOG_SECRET}` } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, []);
  assert.equal(calls.length, 0);
});

test('missing public catalog credentials fails 503 instead of returning demo data', async t => {
  const { request, calls } = await harness(t, {}, { catalogToken: undefined });
  const response = await request('/api/v1/catalog/products', { headers: { Authorization: `Bearer ${CATALOG_SECRET}` } });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).title, 'CATALOG_NOT_CONFIGURED');
  assert.equal(calls.length, 0);
});

test('query schema rejects arbitrary Frappe fields and oversized pages', async t => {
  const { login, request, calls } = await harness(t);
  const session = await login();
  for (const query of ['fields=%5B%22password%22%5D', 'pageSize=1000', 'sort=creation%20desc', 'page=0']) {
    const response = await request(`/api/v1/products?${query}`, { headers: { Cookie: session.cookie } });
    assert.equal(response.status, 422);
  }
  assert.equal(calls.filter(call => call.method === 'list').length, 0);
});

test('there is no generic Frappe resource/method proxy', async t => {
  const { request, calls } = await harness(t);
  for (const path of ['/api/resource/User', '/api/method/frappe.client.get', '/api/v1/proxy?url=https://attacker.invalid']) {
    const response = await request(path);
    assert.equal(response.status, 404);
  }
  assert.equal(calls.length, 0);
});

test('logout sends upstream POST and expires the local session', async t => {
  const { login, request, calls } = await harness(t);
  const session = await login();
  const response = await request('/api/v1/auth/logout', { method: 'POST', headers: mutationHeaders(session.cookie, session.csrf) });
  assert.equal(response.status, 204);
  assert.match(response.headers.get('Set-Cookie')!, /Max-Age=0/i);
  const logout = calls.find(call => call.method === 'request');
  assert.deepEqual(logout?.args, ['/api/method/logout', { sid: UPSTREAM_SID, csrf: UPSTREAM_CSRF }, { method: 'POST' }]);
});

test('variants route forwards the decoded parent, user session and validated pagination to the adapter', async t => {
  const { login, request, calls } = await harness(t);
  const session = await login();
  const response = await request(`/api/v1/products/${encodeURIComponent('TEMPLATE / BLUE')}/variants?page=3&pageSize=12&sort=code&q=Blue`, { headers: { Cookie: session.cookie } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.data));
  assert.deepEqual(body.meta, { source: 'frappe', page: 3, pageSize: 12, hasMore: false });
  const call = calls.find(value => value.method === 'variants');
  assert.deepEqual(call?.args, ['TEMPLATE / BLUE', { sid: UPSTREAM_SID, csrf: UPSTREAM_CSRF }, { q: 'Blue', group: '', status: 'all', page: 3, pageSize: 12, sort: 'code' }]);
  assert.equal(calls.filter(value => value.method === 'detail' || value.method === 'list').length, 0);
});

test('variants route requires admin authentication and rejects unbounded queries before the adapter', async t => {
  const { login, request, calls } = await harness(t);
  const anonymous = await request('/api/v1/products/TEMPLATE/variants');
  assert.equal(anonymous.status, 401);
  const session = await login();
  for (const query of ['pageSize=51', 'page=0', 'fields=*', 'page=10001']) {
    const response = await request(`/api/v1/products/TEMPLATE/variants?${query}`, { headers: { Cookie: session.cookie } });
    assert.equal(response.status, 422, query);
  }
  assert.equal(calls.filter(value => value.method === 'variants').length, 0);
});

test('variants route for the catalog uses only the service token and fixed public group', async t => {
  const { request, calls } = await harness(t);
  const denied = await request('/api/v1/catalog/products/TEMPLATE/variants');
  assert.equal(denied.status, 401);
  const response = await request('/api/v1/catalog/products/TEMPLATE/variants?page=2&pageSize=10&status=all&group=Private', { headers: { Authorization: `Bearer ${CATALOG_SECRET}` } });
  assert.equal(response.status, 200);
  const call = calls.find(value => value.method === 'variants');
  assert.deepEqual(call?.args, ['TEMPLATE', { token: CATALOG_TOKEN }, { q: '', group: 'Private', status: 'all', page: 2, pageSize: 10, sort: '-modified' }, 'Headless Demo']);
  // The adapter enforces the final publicGroup argument, ignoring caller group/status.
  assert.equal(calls.filter(value => value.method === 'user').length, 0);
});

test('variants route for the catalog rejects excessive pages without querying the adapter', async t => {
  const { request, calls } = await harness(t);
  for (const query of ['pageSize=500', 'page=-1', 'order_by=secret', 'page=1.5']) {
    const response = await request(`/api/v1/catalog/products/TEMPLATE/variants?${query}`, { headers: { Authorization: `Bearer ${CATALOG_SECRET}` } });
    assert.equal(response.status, 422, query);
  }
  assert.equal(calls.length, 0);
});

for (const [label, config] of [
  ['default configuration', {}],
  ['production even when opted in', { production: true, enableLocalSetup: true }],
] as const) {
  test(`local setup routes are unavailable in ${label}`, async t => {
    const { request, calls } = await harness(t, {}, config);
    for (const action of ['catalog', 'seed', 'verify']) {
      const response = await request(`/api/v1/local-setup/${action}`, { method: 'POST', headers: { Origin: ORIGIN, 'X-CSRF-Token': 'not-a-session' } });
      assert.equal(response.status, 404, action);
      assert.equal((await response.json()).title, 'NOT_FOUND');
    }
    assert.equal(calls.length, 0);
  });
}

test('local setup opt-in still rejects unauthenticated requests before importing or mutating', async t => {
  const { request, calls } = await harness(t, {}, { enableLocalSetup: true });
  for (const action of ['catalog', 'seed', 'verify']) {
    const response = await request(`/api/v1/local-setup/${action}`, { method: 'POST', headers: { Origin: ORIGIN, 'X-CSRF-Token': 'not-a-session' } });
    assert.equal(response.status, 401, action);
    assert.equal((await response.json()).title, 'AUTHENTICATION_REQUIRED');
  }
  assert.equal(calls.length, 0);
});

test('local setup with a login still rejects missing CSRF before upstream work', async t => {
  const { login, request, calls } = await harness(t, {}, { enableLocalSetup: true });
  const session = await login();
  for (const action of ['catalog', 'seed', 'verify']) {
    const response = await request(`/api/v1/local-setup/${action}`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: session.cookie } });
    assert.equal(response.status, 403, action);
    assert.equal((await response.json()).title, 'CSRF_DENIED');
  }
  assert.deepEqual(calls.map(value => value.method), ['login'], 'No permission, provisioning, seed or verification request may run.');
});

async function bearerLogin(request: Awaited<ReturnType<typeof harness>>['request']) {
  const response = await request('/api/v1/auth/login', {
    method: 'POST', headers: { Origin: PAGES_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo@example.invalid', password: 'test-only-password' }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  return { response, body, token: body.data.accessToken as string, csrf: body.data.csrfToken as string };
}
function bearerHeaders(token: string, csrf?: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Origin: PAGES_ORIGIN, ...(csrf ? { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' } : {}) };
}
const BEARER_CONFIG: Partial<Config> = { authMode: 'bearer', allowedOrigins: PAGES_ORIGIN };

test('CORS origin configuration accepts only complete exact HTTP origins', () => {
  assert.deepEqual([...parseAllowedOrigins(ORIGIN, `${PAGES_ORIGIN}, ${ORIGIN}`)], [ORIGIN, PAGES_ORIGIN]);
  for (const value of ['*', 'null', 'https://*.github.io', `${PAGES_ORIGIN}/repo`, `${PAGES_ORIGIN}/`, 'https://user:pass@github.io', 'javascript:alert(1)']) {
    assert.throws(() => parseAllowedOrigins(ORIGIN, value), /ALLOWED_ORIGINS/, value);
  }
});

test('allowed Pages CORS preflight permits bounded bearer/CSRF headers without authenticating', async t => {
  const { request, calls } = await harness(t, {}, BEARER_CONFIG);
  const response = await request('/api/v1/products/TEST-1', { method: 'OPTIONS', headers: { Origin: PAGES_ORIGIN, 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'Content-Type, Authorization, X-CSRF-Token' } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), PAGES_ORIGIN);
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
  assert.deepEqual(response.headers.get('Access-Control-Allow-Methods')?.split(', '), ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']);
  assert.equal(response.headers.get('Access-Control-Allow-Headers'), 'Content-Type, Authorization, X-CSRF-Token');
  assert.match(response.headers.get('Vary')!, /Origin/);
  assert.equal(calls.length, 0);
});

test('CORS denies lookalike origins, unlisted methods and headers before upstream work', async t => {
  const { request, calls } = await harness(t, {}, BEARER_CONFIG);
  for (const origin of ['https://attacker.github.io', 'https://metafrappe.github.io.attacker.invalid', 'null']) {
    const response = await request('/api/v1/public/products', { headers: { Origin: origin } });
    assert.equal(response.status, 403, origin);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
  const deniedPreflights: HeadersInit[] = [
    { Origin: PAGES_ORIGIN, 'Access-Control-Request-Method': 'PUT' },
    { Origin: PAGES_ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'X-Frappe-CSRF-Token' },
    { 'Access-Control-Request-Method': 'GET' },
  ];
  for (const headers of deniedPreflights) {
    const response = await request('/api/v1/products', { method: 'OPTIONS', headers });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Methods'), null);
  }
  assert.equal(calls.length, 0);
});

test('bearer login returns an opaque sealed token, no cookie or upstream credentials', async t => {
  const { request, calls } = await harness(t, {}, BEARER_CONFIG);
  const session = await bearerLogin(request);
  assert.deepEqual(Object.keys(session.body.data).sort(), ['accessToken', 'csrfToken', 'user']);
  assert.ok(session.token.length > 100);
  assert.ok(session.csrf.length >= 32);
  assert.notEqual(session.csrf, UPSTREAM_CSRF);
  assert.equal(session.response.headers.get('Set-Cookie'), null);
  assert.equal(session.response.headers.get('Access-Control-Allow-Origin'), PAGES_ORIGIN);
  assert.equal(session.response.headers.get('Cache-Control'), 'no-store');
  assert.doesNotMatch(JSON.stringify(session.body), new RegExp(`${UPSTREAM_SID}|${UPSTREAM_CSRF}|test-only-password|${CATALOG_TOKEN}`));
  for (let count = 0; count < 2; count++) {
    const response = await request('/api/v1/auth/session', { headers: bearerHeaders(session.token) });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, { user: 'demo@example.invalid', csrfToken: session.csrf });
  }
  assert.equal(calls.filter(call => call.method === 'user').length, 2, 'Every request must revalidate the upstream session');
  assert.deepEqual(calls.filter(call => call.method === 'user')[0].args, [{ sid: UPSTREAM_SID, csrf: UPSTREAM_CSRF }]);
});

test('bearer authentication rejects tampered, expired, foreign-audience and query-string tokens', async t => {
  const { request, calls } = await harness(t, {}, BEARER_CONFIG);
  const session = await bearerLogin(request);
  const validData = { sid: UPSTREAM_SID, csrf: UPSTREAM_CSRF, user: 'demo@example.invalid', localCsrf: session.csrf, purpose: 'metaframer-admin-bearer-v1', audience: ORIGIN, expiresAt: Date.now() + 60000 };
  const forgedPayloads = [
    { ...validData, expiresAt: Date.now() - 1 },
    { ...validData, audience: 'https://other-app.invalid' },
    { ...validData, purpose: 'cookie-session' },
  ];
  const invalidTokens = ['not-a-token', `${session.token.slice(0, 100)}!${session.token.slice(101)}`, ...await Promise.all(forgedPayloads.map(data => sealData(data, { password: SESSION_SECRET, ttl: 8 * 3600 })))];
  for (const token of invalidTokens) {
    const response = await request('/api/v1/products', { headers: bearerHeaders(token) });
    assert.equal(response.status, 401);
  }
  const queryToken = await request(`/api/v1/products?access_token=${encodeURIComponent(session.token)}`, { headers: { Origin: PAGES_ORIGIN } });
  assert.equal(queryToken.status, 401);
  assert.equal(calls.filter(call => call.method === 'user' || call.method === 'list').length, 0);
});

test('bearer mode cannot use a cookie session as a fallback or promote its envelope', async t => {
  const cookieApp = await harness(t);
  const cookie = await cookieApp.login();
  const bearerApp = await harness(t, {}, BEARER_CONFIG);
  const attemptedCredentials: HeadersInit[] = [{ Cookie: cookie.cookie }, { Authorization: `Bearer ${cookie.cookie.slice('mf_admin_session='.length)}` }];
  for (const headers of attemptedCredentials) {
    const response = await bearerApp.request('/api/v1/products', { headers });
    assert.equal(response.status, 401);
  }
  assert.equal(bearerApp.calls.length, 0);
});

test('bearer mutations need allowed Origin plus local CSRF and retain user permissions', async t => {
  const { request, calls } = await harness(t, {}, BEARER_CONFIG);
  const session = await bearerLogin(request);
  for (const headers of [
    { Authorization: `Bearer ${session.token}`, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json' },
    bearerHeaders(session.token),
    bearerHeaders(session.token, UPSTREAM_CSRF),
    { ...bearerHeaders(session.token, session.csrf), Origin: 'https://attacker.invalid' },
  ]) {
    const response = await request('/api/v1/products', { method: 'POST', headers, body: JSON.stringify(INPUT) });
    assert.equal(response.status, 403);
  }
  assert.equal(calls.filter(call => call.method === 'save').length, 0);
  const response = await request('/api/v1/products', { method: 'POST', headers: bearerHeaders(session.token, session.csrf), body: JSON.stringify(INPUT) });
  assert.equal(response.status, 201);
  assert.deepEqual(calls.find(call => call.method === 'save')?.args, [INPUT, { sid: UPSTREAM_SID, csrf: UPSTREAM_CSRF }]);
});

test('bearer Item permission errors stay 403 and cannot borrow catalog privileges', async t => {
  const { request, calls } = await harness(t, { list: () => { throw new ApiError(403, 'PERMISSION_DENIED', 'Denied'); } }, BEARER_CONFIG);
  const session = await bearerLogin(request);
  const response = await request('/api/v1/products', { headers: bearerHeaders(session.token) });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).title, 'PERMISSION_DENIED');
  assert.deepEqual(calls.find(call => call.method === 'list')?.args[0], { sid: UPSTREAM_SID, csrf: UPSTREAM_CSRF });
});

test('bearer identity mismatch and revoked upstream sessions stop access immediately', async t => {
  for (const user of [() => 'another-user@example.invalid', () => { throw new ApiError(403, 'PERMISSION_DENIED', 'Revoked'); }]) {
    const { request, calls } = await harness(t, { user }, BEARER_CONFIG);
    const session = await bearerLogin(request);
    const response = await request('/api/v1/products', { headers: bearerHeaders(session.token) });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).title, 'SESSION_EXPIRED');
    assert.equal(calls.filter(call => call.method === 'list').length, 0);
  }
});

test('bearer logout invalidates Frappe and a replay cannot regain access', async t => {
  let revoked = false;
  const { request, calls } = await harness(t, {
    user: () => { if (revoked) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Revoked'); return 'demo@example.invalid'; },
    request: (path: string) => { assert.equal(path, '/api/method/logout'); revoked = true; return { data: {} }; },
  }, BEARER_CONFIG);
  const session = await bearerLogin(request);
  const logout = await request('/api/v1/auth/logout', { method: 'POST', headers: bearerHeaders(session.token, session.csrf) });
  assert.equal(logout.status, 204);
  assert.deepEqual(calls.find(call => call.method === 'request')?.args, ['/api/method/logout', { sid: UPSTREAM_SID, csrf: UPSTREAM_CSRF }, { method: 'POST' }]);
  const replay = await request('/api/v1/products', { headers: bearerHeaders(session.token) });
  assert.equal(replay.status, 401);
  assert.equal(calls.filter(call => call.method === 'list').length, 0);
});

test('anonymous browser catalog uses only the server read token and fixed public group', async t => {
  const { request, calls } = await harness(t, {}, { ...BEARER_CONFIG, catalogSecret: undefined });
  for (const path of ['/api/v1/public/products?pageSize=10', '/api/v1/public/products/TEST-1', '/api/v1/public/products/TEMPLATE/variants?page=2&pageSize=5']) {
    const response = await request(path, { headers: { Origin: PAGES_ORIGIN } });
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), PAGES_ORIGIN);
    assert.doesNotMatch(await response.text(), new RegExp(`${CATALOG_TOKEN}|${CATALOG_SECRET}|${UPSTREAM_SID}|${UPSTREAM_CSRF}`));
  }
  const list = calls.find(call => call.method === 'list')!;
  assert.deepEqual(list.args, [{ token: CATALOG_TOKEN }, { q: '', group: '', status: 'active', page: 1, pageSize: 10, sort: '-modified' }, 'Headless Demo']);
  assert.deepEqual(calls.find(call => call.method === 'detail')?.args, ['TEST-1', { token: CATALOG_TOKEN }, 'Headless Demo']);
  assert.deepEqual(calls.find(call => call.method === 'variants')?.args, ['TEMPLATE', { token: CATALOG_TOKEN }, { q: '', group: '', status: 'active', page: 2, pageSize: 5, sort: '-modified' }, 'Headless Demo']);
  assert.equal(calls.filter(call => call.method === 'user' || call.method === 'login').length, 0);
});

test('public catalog cannot request disabled/private inventory, arbitrary fields or unbounded pages', async t => {
  const { request, calls } = await harness(t, {}, BEARER_CONFIG);
  for (const path of ['/api/v1/public/products', '/api/v1/public/products/TEMPLATE/variants']) {
    for (const query of ['status=disabled', 'status=all', 'fields=*', 'pageSize=51', 'page=10001', 'page=0']) {
      const response = await request(`${path}?${query}`);
      assert.equal(response.status, 422, `${path}?${query}`);
    }
  }
  const privateList = await request('/api/v1/public/products?group=Private');
  assert.equal(privateList.status, 200);
  assert.deepEqual((await privateList.json()).data, []);
  assert.equal(calls.length, 0);
});

test('public catalog preserves adapter visibility denial and exposes no mutation endpoints', async t => {
  const { request, calls } = await harness(t, { detail: () => { throw new ApiError(404, 'NOT_FOUND', 'Hidden'); }, variants: () => { throw new ApiError(404, 'NOT_FOUND', 'Hidden'); } }, BEARER_CONFIG);
  for (const path of ['/api/v1/public/products/PRIVATE', '/api/v1/public/products/PRIVATE/variants']) {
    const response = await request(path);
    assert.equal(response.status, 404);
  }
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const response = await request('/api/v1/public/products/TEST-1', { method, headers: { Origin: PAGES_ORIGIN } });
    assert.equal(response.status, 404);
  }
  assert.equal(calls.filter(call => call.method === 'save' || call.method === 'remove').length, 0);
});

test('public catalog fails clearly without service credentials and internal catalog remains guarded', async t => {
  const missing = await harness(t, {}, { ...BEARER_CONFIG, catalogToken: undefined });
  const response = await missing.request('/api/v1/public/products');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).title, 'CATALOG_NOT_CONFIGURED');
  assert.equal(missing.calls.length, 0);
  const ready = await harness(t, {}, BEARER_CONFIG);
  const denied = await ready.request('/api/v1/catalog/products', { headers: { Origin: PAGES_ORIGIN } });
  assert.equal(denied.status, 401);
  assert.equal(ready.calls.length, 0);
});
