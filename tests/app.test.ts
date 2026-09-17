/** Local HTTP integration tests. The Frappe dependency is an explicit stub. */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createApp, type Config } from '../server/app.ts';
import { ApiError, type Frappe } from '../server/frappe.ts';

const ORIGIN = 'http://admin.local.test';
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
  const config: Config = { frappeUrl: 'https://erp-test.metaframer.net', origin: ORIGIN, sessionSecret: 'a-test-only-session-secret-over-32-characters', catalogSecret: CATALOG_SECRET, catalogToken: CATALOG_TOKEN, publicGroup: 'Headless Demo', production: false, ...overrides };
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
