/**
 * Adapter contract tests with explicit, in-memory upstream test doubles.
 * These assertions do not prove access to or CRUD success on a live Frappe site.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, Frappe, mapProduct, type ListQuery } from '../server/frappe.ts';

const BASE = 'https://erp-test.metaframer.net';
const SESSION = { sid: 'test-session-only', csrf: 'test-csrf-only' };
const TOKEN = { token: 'test-key:test-secret' };
const query: ListQuery = { q: '', group: '', status: 'all', page: 1, pageSize: 2, sort: 'name' };
type Call = { url: URL; init: RequestInit; headers: Headers };

function json(data: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

function fixture(overrides: Record<string, unknown> = {}) {
  return { name: 'TEST-001', item_code: 'TEST-001', item_name: 'Test product', description: '<p>Test description</p>', item_group: 'Products', stock_uom: 'Nos', image: '/files/test.png', disabled: 0, is_sales_item: 1, is_stock_item: 1, has_variants: 0, variant_of: null, attributes: [], modified: '2026-09-17 10:00:00.000000', ...overrides };
}

function upstream(responses: Array<Response | Error | ((call: Call) => Response)>) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const call = { url: new URL(String(input)), init, headers: new Headers(init.headers) };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected upstream request: ${call.url.pathname}`);
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(call) : next;
  };
  return { api: new Frappe(BASE, fetcher), calls };
}

function problem(status: number, code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  };
}

test('password login obtains its own upstream session and CSRF, then verifies the user', async () => {
  const cookies = new Headers();
  cookies.append('Set-Cookie', 'full_name=Test; Path=/');
  cookies.append('Set-Cookie', 'sid=test-login-session; Path=/; HttpOnly; Secure');
  const { api, calls } = upstream([
    json({ message: 'Logged In' }, 200, cookies),
    new Response('<script>frappe.csrf_token = "csrf123abc";</script>', { headers: { 'Content-Type': 'text/html' } }),
    json({ message: 'test-user@example.invalid' }),
  ]);
  const result = await api.login('test-user@example.invalid', 'test-password-only');
  assert.deepEqual(result, { sid: 'test-login-session', csrf: 'csrf123abc', user: 'test-user@example.invalid' });
  assert.deepEqual(calls.map(c => [c.url.pathname, c.init.method]), [
    ['/api/method/login', 'POST'], ['/desk', 'GET'], ['/api/method/frappe.auth.get_logged_user', 'GET'],
  ]);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { usr: 'test-user@example.invalid', pwd: 'test-password-only' });
  assert.equal(calls[0].headers.get('Cookie'), null);
  assert.equal(calls[1].headers.get('Cookie'), 'sid=test-login-session');
  assert.equal(calls[1].headers.get('Accept'), 'text/html');
  assert.equal(calls[2].headers.get('X-Frappe-CSRF-Token'), 'csrf123abc');
  assert.ok(calls.every(c => c.init.redirect === 'manual' && c.init.cache === 'no-store'));
});

test('an HTTP 200 login without a real session is not accepted as authenticated', async () => {
  const { api, calls } = upstream([json({ verification: { method: 'OTP' } }, 200, { 'Set-Cookie': 'sid=Guest; Path=/' })]);
  await assert.rejects(api.login('test@example.invalid', 'test-only'), problem(401, 'LOGIN_INCOMPLETE'));
  assert.equal(calls.length, 1);
});

test('CSRF bootstrap failure logs out the orphan upstream session with POST', async () => {
  const { api, calls } = upstream([
    json({ message: 'Logged In' }, 200, { 'Set-Cookie': 'sid=bootstrap-test; Path=/' }),
    new Response('<html>No CSRF bootstrap</html>'),
    json({ message: 'Logged Out' }),
  ]);
  await assert.rejects(api.login('test@example.invalid', 'test-only'), problem(502, 'CSRF_BOOTSTRAP_FAILED'));
  assert.equal(calls[2].url.pathname, '/api/method/logout');
  assert.equal(calls[2].init.method, 'POST');
});

test('a Guest response cannot pass the current-user check', async () => {
  const { api } = upstream([json({ message: 'Guest' })]);
  await assert.rejects(api.user(SESSION), problem(401, 'AUTHENTICATION_REQUIRED'));
});

test('session writes send Frappe CSRF while token requests do not borrow a session', async () => {
  const { api, calls } = upstream([json({ data: fixture() }), json({ message: 'token-user@example.invalid' })]);
  await api.request('/api/resource/Item', SESSION, { method: 'POST', body: { item_code: 'TEST' } });
  await api.user(TOKEN);
  assert.equal(calls[0].headers.get('Cookie'), 'sid=test-session-only');
  assert.equal(calls[0].headers.get('X-Frappe-CSRF-Token'), 'test-csrf-only');
  assert.equal(calls[0].headers.get('Authorization'), null);
  assert.equal(calls[0].headers.get('Content-Type'), 'application/json');
  assert.equal(calls[1].headers.get('Authorization'), 'token test-key:test-secret');
  assert.equal(calls[1].headers.get('Cookie'), null);
  assert.equal(calls[1].headers.get('X-Frappe-CSRF-Token'), null);
});

for (const [upstreamStatus, excType, status, code] of [
  [401, 'AuthenticationError', 401, 'AUTHENTICATION_REQUIRED'],
  [403, 'PermissionError', 403, 'PERMISSION_DENIED'],
  [404, 'DoesNotExistError', 404, 'NOT_FOUND'],
  [417, 'TimestampMismatchError', 409, 'CONFLICT'],
  [409, 'DuplicateEntryError', 409, 'CONFLICT'],
  [417, 'LinkExistsError', 409, 'CONFLICT'],
  [417, 'MandatoryError', 422, 'FRAPPE_VALIDATION'],
  [429, '', 429, 'RATE_LIMITED'],
  [500, 'SomeInternalError', 502, 'UPSTREAM_ERROR'],
] as const) {
  test(`maps upstream ${upstreamStatus}/${excType || 'rate limit'} without exposing its traceback`, async () => {
    const { api } = upstream([json({ exc_type: excType, exc: 'private upstream traceback', _server_messages: 'internal implementation detail' }, upstreamStatus)]);
    await assert.rejects(api.doc('TEST', SESSION), error => {
      problem(status, code)(error);
      assert.doesNotMatch(String(error), /private upstream traceback|internal implementation detail/);
      return true;
    });
  });
}

test('distinguishes upstream timeout from a transport failure', async () => {
  const timeout = Object.assign(new Error('timeout detail'), { name: 'TimeoutError' });
  const { api } = upstream([timeout, new Error('private network detail')]);
  await assert.rejects(api.user(SESSION), problem(504, 'UPSTREAM_UNAVAILABLE'));
  await assert.rejects(api.user(SESSION), problem(502, 'UPSTREAM_UNAVAILABLE'));
});

test('public catalog enforces its configured group, enabled and sales filters even for an admin-shaped query', async () => {
  const { api, calls } = upstream([json({ data: [fixture(), fixture({ name: 'TEST-002' }), fixture({ name: 'TEST-003' })] })]);
  const result = await api.list(TOKEN, { ...query, q: 'Chair & desk', group: 'Private inventory', status: 'disabled', page: 3, sort: 'code' }, 'Headless Demo');
  const params = calls[0].url.searchParams;
  assert.deepEqual(JSON.parse(params.get('filters')!), [['item_group', '=', 'Headless Demo'], ['disabled', '=', 0], ['is_sales_item', '=', 1]]);
  assert.deepEqual(JSON.parse(params.get('or_filters')!), [['item_code', 'like', '%Chair & desk%'], ['item_name', 'like', '%Chair & desk%']]);
  assert.equal(params.get('order_by'), 'item_code asc, name asc');
  assert.equal(params.get('limit_start'), '4');
  assert.equal(params.get('limit_page_length'), '3');
  assert.equal(result.data.length, 2);
  assert.deepEqual(result.meta, { page: 3, pageSize: 2, hasMore: true, source: 'frappe' });
  assert.ok(!JSON.parse(params.get('fields')!).includes('valuation_rate'));
});

test('normal admin queries preserve status/group and report the last page correctly', async () => {
  const { api, calls } = upstream([json({ data: [fixture()] })]);
  const result = await api.list(SESSION, { ...query, group: 'Parts', status: 'disabled', sort: '-modified' });
  assert.deepEqual(JSON.parse(calls[0].url.searchParams.get('filters')!), [['item_group', '=', 'Parts'], ['disabled', '=', 1]]);
  assert.equal(calls[0].url.searchParams.get('order_by'), 'modified desc, name asc');
  assert.equal(result.meta.hasMore, false);
});

test('malformed successful upstream listing fails visibly instead of masquerading as an empty catalog', async () => {
  const { api } = upstream([json({ message: 'not a document list' })]);
  await assert.rejects(api.list(SESSION, query), problem(502, 'UPSTREAM_INVALID'));
});

for (const change of [{ disabled: 1 }, { is_sales_item: 0 }, { item_group: 'Private' }]) {
  test(`public detail hides products outside the catalog contract: ${JSON.stringify(change)}`, async () => {
    const { api, calls } = upstream([json({ data: fixture({ item_group: 'Headless Demo', ...change }) })]);
    await assert.rejects(api.detail('TEST-001', TOKEN, 'Headless Demo'), problem(404, 'NOT_FOUND'));
    assert.equal(calls.length, 1);
  });
}

test('variant detail returns the first bounded page without one document request per variant', async () => {
  const variants = Array.from({ length: 51 }, (_, index) => fixture({ name: `TEST-001-${index}`, item_code: `TEST-001-${index}`, variant_of: 'TEST-001' }));
  const { api, calls } = upstream([
    json({ data: fixture({ has_variants: 1 }) }),
    json({ data: variants }),
  ]);
  const result = await api.detail('TEST-001', SESSION);
  assert.deepEqual(JSON.parse(calls[1].url.searchParams.get('filters')!), [['variant_of', '=', 'TEST-001']]);
  assert.equal(calls[1].url.searchParams.get('limit_start'), '0');
  assert.equal(calls[1].url.searchParams.get('limit_page_length'), '51');
  assert.equal(calls.length, 2, 'Detail must issue one parent read and one variant list only.');
  assert.equal(result.data.variants.length, 50);
  assert.deepEqual(result.data.variants[0].attributes, []);
  assert.deepEqual(result.meta.variants, { page: 1, pageSize: 50, hasMore: true });
});

test('the paginated variants method preserves public visibility and asks only for the requested page', async () => {
  const { api, calls } = upstream([
    json({ data: fixture({ has_variants: 1, item_group: 'Headless Demo' }) }),
    json({ data: [fixture({ name: 'TEST-001-RED', variant_of: 'TEST-001', item_group: 'Headless Demo' })] }),
  ]);
  const result = await api.variants('TEST-001', TOKEN, { ...query, page: 2, pageSize: 10, status: 'all', sort: 'code' }, 'Headless Demo');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.pathname, '/api/resource/Item/TEST-001');
  assert.deepEqual(JSON.parse(calls[1].url.searchParams.get('filters')!), [['item_group', '=', 'Headless Demo'], ['disabled', '=', 0], ['is_sales_item', '=', 1], ['variant_of', '=', 'TEST-001']]);
  assert.equal(calls[1].url.searchParams.get('limit_start'), '10');
  assert.equal(calls[1].url.searchParams.get('limit_page_length'), '11');
  assert.deepEqual(result.meta, { page: 2, pageSize: 10, hasMore: false, source: 'frappe' });
  assert.equal(result.data.length, 1);
});

test('requesting variants cannot bypass the hidden parent template check', async () => {
  const { api, calls } = upstream([json({ data: fixture({ has_variants: 1, disabled: 1, item_group: 'Headless Demo' }) })]);
  await assert.rejects(api.variants('TEST-001', TOKEN, query, 'Headless Demo'), problem(404, 'NOT_FOUND'));
  assert.equal(calls.length, 1, 'Hidden parent must not trigger a variant list.');
});

test('create maps only permitted product fields, never upstream permission escape flags', async () => {
  const { api, calls } = upstream([json({ data: fixture() }, 201)]);
  await api.save({ code: 'TEST-001', name: 'Test product', group: 'Products', uom: 'Nos', description: 'Description', image: null, disabled: false, isStockItem: true, flags: { ignore_permissions: true }, valuation_rate: 999 } as any, SESSION);
  assert.equal(calls[0].url.pathname, '/api/resource/Item');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { item_code: 'TEST-001', item_name: 'Test product', item_group: 'Products', stock_uom: 'Nos', description: 'Description', image: null, disabled: false, is_stock_item: true, doctype: 'Item', is_sales_item: 1 });
});

test('update encodes the complete Item identifier and carries last-read modified for Frappe concurrency checks', async () => {
  const original = fixture({ name: 'SKU / A?x=1', item_code: 'SKU / A?x=1' });
  const { api, calls } = upstream([json({ data: original }), json({ data: { ...original, item_name: 'Updated' } })]);
  await api.save({ name: 'Updated', modified: original.modified }, SESSION, original.name);
  assert.equal(calls[1].url.href, `${BASE}/api/resource/Item/SKU%20%2F%20A%3Fx%3D1`);
  assert.equal(calls[1].init.method, 'PUT');
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), { item_name: 'Updated', modified: original.modified });
});

test('stale update is rejected before any upstream mutation', async () => {
  const { api, calls } = upstream([json({ data: fixture() })]);
  await assert.rejects(api.save({ name: 'Stale overwrite', modified: '2026-09-16 10:00:00.000000' }, SESSION, 'TEST-001'), problem(409, 'CONFLICT'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'GET');
});

test('changing an existing Item code is rejected instead of pretending to rename it', async () => {
  const { api, calls } = upstream([json({ data: fixture() })]);
  await assert.rejects(api.save({ code: 'DIFFERENT-CODE' }, SESSION, 'TEST-001'), problem(422, 'IMMUTABLE_CODE'));
  assert.equal(calls.length, 1);
});

test('template deletion cannot trigger ERPNext variant cascade', async () => {
  const { api, calls } = upstream([json({ data: fixture({ has_variants: 1 }) })]);
  await assert.rejects(api.remove('TEST-001', SESSION), problem(409, 'VARIANT_TEMPLATE_PROTECTED'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'GET');
});

test('ordinary Item deletion reaches upstream DELETE and propagates linked-record refusal', async () => {
  const { api, calls } = upstream([json({ data: fixture() }), json({ exc_type: 'LinkExistsError' }, 417)]);
  await assert.rejects(api.remove('TEST-001', SESSION), problem(409, 'CONFLICT'));
  assert.equal(calls[1].init.method, 'DELETE');
  assert.equal(calls[1].headers.get('X-Frappe-CSRF-Token'), SESSION.csrf);
});

for (const [label, response] of [
  ['HTML', new Response('<html>proxy login page</html>', { status: 200 })],
  ['truncated JSON', new Response('{"data":', { status: 200 })],
] as const) {
  test(`an HTTP 200 with ${label} fails as an invalid upstream response`, async () => {
    const { api } = upstream([response]);
    await assert.rejects(api.request('/api/resource/Item', SESSION), problem(502, 'UPSTREAM_INVALID'));
  });
}

test('successful save with an empty document is rejected rather than reported as a saved product', async () => {
  const { api } = upstream([json({ data: {} }, 201)]);
  await assert.rejects(api.save({ code: 'TEST-001', name: 'Test', group: 'Products', uom: 'Nos' }, SESSION), problem(502, 'UPSTREAM_INVALID'));
});

for (const [label, response] of [
  ['HTML', new Response('<html>proxy response</html>', { status: 200 })],
  ['an unexpected message', json({ message: 'queued' })],
  ['an empty object', json({})],
] as const) {
  test(`DELETE returning ${label} cannot be claimed as a completed deletion`, async () => {
    const { api, calls } = upstream([json({ data: fixture() }), response]);
    await assert.rejects(api.remove('TEST-001', SESSION), problem(502, 'UPSTREAM_INVALID'));
    assert.equal(calls[1].init.method, 'DELETE');
  });
}

test('DELETE accepts the pinned Frappe v1 202 data=ok acknowledgement', async () => {
  const { api, calls } = upstream([json({ data: fixture() }), json({ data: 'ok' }, 202)]);
  await api.remove('TEST-001', SESSION);
  assert.equal(calls[1].init.method, 'DELETE');
});

test('form options query leaf groups and enabled UOMs from the current upstream account', async () => {
  const { api, calls } = upstream([json({ data: [{ name: 'Products' }] }), json({ data: [{ name: 'Nos' }] })]);
  const result = await api.options(SESSION, 'Headless Demo');
  assert.deepEqual(calls.map(c => decodeURIComponent(c.url.pathname)), ['/api/resource/Item Group', '/api/resource/UOM']);
  assert.deepEqual(JSON.parse(calls[0].url.searchParams.get('filters')!), [['is_group', '=', 0]]);
  assert.deepEqual(JSON.parse(calls[1].url.searchParams.get('filters')!), [['enabled', '=', 1]]);
  assert.deepEqual(result.data, { itemGroups: ['Products'], uoms: ['Nos'], publicGroup: 'Headless Demo' });
});

test('product DTO does not expose raw description markup or private-file relative URLs', () => {
  const result = mapProduct(fixture({ image: '/private/files/confidential.png', description: '<p>A &amp; B</p><img src=x onerror=alert(1)>', valuation_rate: 50 }), BASE);
  assert.equal(result.image, null);
  assert.equal(result.description, 'A & B');
  assert.equal('valuation_rate' in result, false);
  assert.equal(mapProduct(fixture({ image: 'javascript:alert(1)' }), BASE).image, null);
});
