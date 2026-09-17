/**
 * Opt-in provisioning for the ERP test site. Importing this module does not run it.
 * Official pinned API sources:
 * https://github.com/frappe/frappe/blob/988e54f3c4c291e2077a83809663f123731abe76/frappe/core/page/permission_manager/permission_manager.py
 * https://github.com/frappe/frappe/blob/988e54f3c4c291e2077a83809663f123731abe76/frappe/permissions.py
 * https://github.com/frappe/frappe/blob/988e54f3c4c291e2077a83809663f123731abe76/frappe/core/doctype/user/user.py
 *
 * The permission-manager add RPC preserves existing Item permissions. The lower
 * level frappe.permissions.add_permission function is NOT a whitelisted RPC.
 * Never print the returned catalogToken or include it in an HTTP response.
 */
import "dotenv/config";
import { parse } from "dotenv";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { ApiError, Frappe, type Credentials } from "../server/frappe.ts";

export const DEMO_GROUP = "Metaframer Demo";
const ROLE = "Metaframer Catalog Reader";
const USER = "catalog-headless@metaframer.net";
const USER_MARKER =
  "Managed by metaframer-admin catalog provisioning (erp-test only).";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ENV_PATH = path.join(ROOT, ".env");
const PERMISSION_RPC =
  "/api/method/frappe.core.page.permission_manager.permission_manager";
const ACCESS_FIELDS = [
  "read",
  "select",
  "write",
  "create",
  "delete",
  "submit",
  "cancel",
  "amend",
  "report",
  "export",
  "import",
  "share",
  "print",
  "email",
  "mask",
  "if_owner",
  "apply_user_permissions",
];

export function assertTestSite(frappe: Frappe) {
  if (new URL(frappe.base).origin !== "https://erp-test.metaframer.net")
    throw new Error(
      "Kurulum yalnızca https://erp-test.metaframer.net test sitesinde çalışır.",
    );
}

export async function readDocument(
  frappe: Frappe,
  credentials: Credentials,
  doctype: string,
  name: string,
): Promise<Record<string, any> | null> {
  try {
    const result = await frappe.request(
      `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
      credentials,
    );
    if (!result.data?.data?.name)
      throw new Error("Frappe beklenen belgeyi döndürmedi.");
    return result.data.data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function listDocuments(
  frappe: Frappe,
  credentials: Credentials,
  doctype: string,
  fields: string[],
  filters: unknown[] = [],
  limit = 100,
): Promise<Record<string, any>[]> {
  const params = new URLSearchParams({
    fields: JSON.stringify(fields),
    filters: JSON.stringify(filters),
    limit_page_length: String(limit),
    order_by: "name asc",
  });
  const { data } = await frappe.request(
    `/api/resource/${encodeURIComponent(doctype)}?${params}`,
    credentials,
  );
  if (!Array.isArray(data.data))
    throw new Error("Frappe beklenen belge listesini döndürmedi.");
  return data.data;
}

export async function createDocument(
  frappe: Frappe,
  credentials: Credentials,
  doctype: string,
  values: Record<string, unknown>,
): Promise<Record<string, any>> {
  const { data } = await frappe.request(
    `/api/resource/${encodeURIComponent(doctype)}`,
    credentials,
    { method: "POST", body: { doctype, ...values } },
  );
  if (!data.data?.name)
    throw new Error(
      "Frappe oluşturulan belgeyi doğrulayamadı. Tekrar çalıştırmadan önce siteyi kontrol edin.",
    );
  return data.data;
}

export async function ensureDemoGroup(
  frappe: Frappe,
  credentials: Credentials,
): Promise<boolean> {
  assertTestSite(frappe);
  const existing = await readDocument(
    frappe,
    credentials,
    "Item Group",
    DEMO_GROUP,
  );
  if (existing) {
    if (existing.is_group)
      throw new Error(
        "Metaframer Demo mevcut ancak yaprak ürün grubu değil. Değişiklik yapılmadı.",
      );
    return false;
  }
  const roots = await listDocuments(
    frappe,
    credentials,
    "Item Group",
    ["name", "parent_item_group", "is_group"],
    [
      ["is_group", "=", 1],
      ["parent_item_group", "is", "not set"],
    ],
    10,
  );
  if (roots.length !== 1)
    throw new Error(
      "Tek bir kök Item Group bulunamadı. Kök grup otomatik tahmin edilmedi.",
    );
  await createDocument(frappe, credentials, "Item Group", {
    item_group_name: DEMO_GROUP,
    parent_item_group: roots[0].name,
    is_group: 0,
  });
  return true;
}

export async function openTestSession() {
  const frappe = new Frappe(
    process.env.FRAPPE_URL || "https://erp-test.metaframer.net",
  );
  assertTestSite(frappe);
  const username = process.env.FRAPPE_TEST_USER;
  const password = process.env.FRAPPE_TEST_PASSWORD;
  const apiKey = process.env.FRAPPE_TEST_API_KEY;
  const apiSecret = process.env.FRAPPE_TEST_API_SECRET;
  let credentials: Credentials;
  let loggedIn = false;
  if (username && password) {
    const session = await frappe.login(username, password);
    credentials = { sid: session.sid, csrf: session.csrf };
    loggedIn = true;
  } else if (apiKey && apiSecret) {
    credentials = { token: `${apiKey}:${apiSecret}` };
    await frappe.user(credentials);
  } else
    throw new Error(
      "İşlem çalışmadı: FRAPPE_TEST_USER/PASSWORD veya FRAPPE_TEST_API_KEY/SECRET gerekli. Hiçbir site kaydı değiştirilmedi.",
    );
  return {
    frappe,
    credentials,
    close: async () => {
      if (loggedIn)
        await frappe.request("/api/method/logout", credentials, {
          method: "POST",
        });
    },
  };
}

function readEnv() {
  try {
    execFileSync("git", ["check-ignore", "--quiet", ".env"], {
      cwd: ROOT,
      stdio: "ignore",
    });
  } catch {
    throw new Error(
      "Gizli anahtar kaydedilemedi: repo .env dosyası Git tarafından yok sayılmalı ve izlenmemeli.",
    );
  }
  if (!existsSync(ENV_PATH)) return "";
  const stat = lstatSync(ENV_PATH);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(
      ".env normal dosya olmalı; sembolik bağlantıya anahtar yazılmadı.",
    );
  return readFileSync(ENV_PATH, "utf8");
}

function configuredToken(values: Record<string, string>): string | undefined {
  return (
    values.FRAPPE_CATALOG_TOKEN ||
    (values.FRAPPE_CATALOG_API_KEY && values.FRAPPE_CATALOG_API_SECRET
      ? `${values.FRAPPE_CATALOG_API_KEY}:${values.FRAPPE_CATALOG_API_SECRET}`
      : undefined)
  );
}

function saveEnv(token?: string) {
  const current = readEnv();
  const values = parse(current);
  const existing = configuredToken(values);
  if (token && existing && existing !== token)
    throw new Error(
      "Mevcut yerel katalog anahtarı değiştirilmedi. Çakışan yapılandırmayı kontrol edin.",
    );
  const updates: Record<string, string> = { CATALOG_ITEM_GROUP: DEMO_GROUP };
  if (token) updates.FRAPPE_CATALOG_TOKEN = token;
  let next = current;
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^(?:export\\s+)?${key}\\s*=.*$`, "gm");
    if (pattern.test(next)) next = next.replace(pattern, () => line);
    else next += `${next && !next.endsWith("\n") ? "\n" : ""}${line}\n`;
  }
  const temporary = `${ENV_PATH}.provision-${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, next, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, ENV_PATH);
    chmodSync(ENV_PATH, 0o600);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

async function permissions(
  frappe: Frappe,
  credentials: Credentials,
  filter: { doctype?: string; role?: string },
) {
  const { data } = await frappe.request(
    `${PERMISSION_RPC}.get_permissions?${new URLSearchParams(filter)}`,
    credentials,
  );
  if (!Array.isArray(data.message))
    throw new Error("Yetki listesi doğrulanamadı.");
  return data.message as Record<string, any>[];
}

function permissionSignature(row: Record<string, any>) {
  return JSON.stringify([
    row.parent,
    row.role,
    Number(row.permlevel || 0),
    ...ACCESS_FIELDS.map((field) => Number(row[field] || 0)),
  ]);
}

function verifyCatalogPermissions(rows: Record<string, any>[]) {
  if (
    rows.length !== 1 ||
    rows[0].parent !== "Item" ||
    Number(rows[0].permlevel) !== 0 ||
    Number(rows[0].read) !== 1 ||
    ACCESS_FIELDS.filter((field) => !["read", "select"].includes(field)).some(
      (field) => Number(rows[0][field] || 0),
    )
  ) {
    throw new Error(
      "Katalog rolü yalnızca Item okuma yetkisine sahip değil. Mevcut yetkiler otomatik değiştirilmedi.",
    );
  }
}

async function verifyToken(frappe: Frappe, token: string) {
  const credentials = { token };
  if ((await frappe.user(credentials)) !== USER)
    throw new Error(
      "Yerel katalog anahtarı ayrılmış katalog kullanıcısına ait değil. Anahtar değiştirilmedi.",
    );
  for (const permType of ["read", "write", "create", "delete"]) {
    const params = new URLSearchParams({
      doctype: "Item",
      docname: "",
      perm_type: permType,
    });
    const { data } = await frappe.request(
      `/api/method/frappe.client.has_permission?${params}`,
      credentials,
    );
    if (Boolean(data.message?.has_permission) !== (permType === "read"))
      throw new Error(
        "Katalog hesabının etkin Item yetkileri salt okunur değil. Katalog etkinleştirilmedi.",
      );
  }
  await frappe.list(
    credentials,
    { q: "", group: "", status: "active", page: 1, pageSize: 1, sort: "code" },
    DEMO_GROUP,
  );
}

export interface CatalogProvisionResult {
  user: string;
  role: string;
  group: string;
  created: string[];
  tokenStatus: "generated" | "existing";
  /** SECRET: internal caller only. Never serialize this field into HTTP JSON/logs. */
  catalogToken?: string;
}

export async function provisionCatalog(
  frappe: Frappe,
  credentials: Credentials,
): Promise<CatalogProvisionResult> {
  assertTestSite(frappe);
  const envValues = parse(readEnv()); // Check safe local key storage before any remote mutation.
  const localToken =
    configuredToken(envValues) ||
    configuredToken(process.env as Record<string, string>);
  const created: string[] = [];
  const initialUser = await readDocument(frappe, credentials, "User", USER);
  if (initialUser) {
    const assigned = (initialUser.roles || []).map((entry: any) => entry.role);
    if (
      initialUser.bio !== USER_MARKER ||
      !initialUser.enabled ||
      initialUser.user_type !== "Website User" ||
      assigned.length !== 1 ||
      assigned[0] !== ROLE
    )
      throw new Error(
        "Katalog e-postası zaten farklı bir hesap için kullanılıyor. Kullanıcı ve rolleri değiştirilmedi.",
      );
    if (
      initialUser.api_key &&
      (!localToken || localToken.split(":")[0] !== initialUser.api_key)
    )
      throw new Error(
        "Katalog hesabında mevcut API anahtarı var; eşleşen yerel anahtar olmadan döndürülmedi veya değiştirilmedi.",
      );
    if (initialUser.api_key && localToken)
      await verifyToken(frappe, localToken);
  } else if (localToken)
    throw new Error(
      "Yerel katalog anahtarı var ancak ayrılmış hesap bulunamadı. Mevcut yapılandırma değiştirilmedi.",
    );

  const existingRole = await readDocument(frappe, credentials, "Role", ROLE);
  if (existingRole && (existingRole.disabled || existingRole.desk_access))
    throw new Error(
      "Mevcut katalog rolü beklenen web erişimi ayarlarında değil. Rol değiştirilmedi.",
    );
  const previousPermissions = await permissions(frappe, credentials, {
    doctype: "Item",
  });
  const existingRolePermissions = existingRole
    ? await permissions(frappe, credentials, { role: ROLE })
    : [];
  if (existingRolePermissions.length)
    verifyCatalogPermissions(existingRolePermissions);
  if (!existingRole) {
    await createDocument(frappe, credentials, "Role", {
      role_name: ROLE,
      desk_access: 0,
      disabled: 0,
    });
    created.push("Role");
  }
  if (!existingRolePermissions.length) {
    await frappe.request(`${PERMISSION_RPC}.add`, credentials, {
      method: "POST",
      body: { parent: "Item", role: ROLE, permlevel: 0 },
    });
    // Custom DocPerm defaults export=1 in this Frappe revision. Restrict only
    // the new dedicated row; never reset or replace other Item permissions.
    await frappe.request(`${PERMISSION_RPC}.update`, credentials, {
      method: "POST",
      body: {
        doctype: "Item",
        role: ROLE,
        permlevel: 0,
        ptype: "export",
        value: "0",
        if_owner: 0,
      },
    });
    created.push("Item read permission");
  }
  verifyCatalogPermissions(
    await permissions(frappe, credentials, { role: ROLE }),
  );
  const afterPermissions = new Set(
    (await permissions(frappe, credentials, { doctype: "Item" })).map(
      permissionSignature,
    ),
  );
  if (
    previousPermissions.some(
      (row) => !afterPermissions.has(permissionSignature(row)),
    )
  )
    throw new Error(
      "Mevcut Item yetkilerinin korunduğu doğrulanamadı; işlem durduruldu.",
    );
  if (await ensureDemoGroup(frappe, credentials)) created.push("Item Group");

  const user =
    initialUser ||
    (await createDocument(frappe, credentials, "User", {
      email: USER,
      first_name: "Metaframer Catalog",
      last_name: "Read Only",
      enabled: 1,
      user_type: "Website User",
      send_welcome_email: 0,
      bio: USER_MARKER,
      roles: [{ role: ROLE }],
    }));
  if (!initialUser) created.push("User");

  const restrictions = await listDocuments(
    frappe,
    credentials,
    "User Permission",
    ["name", "for_value", "apply_to_all_doctypes", "applicable_for"],
    [
      ["user", "=", USER],
      ["allow", "=", "Item Group"],
    ],
    100,
  );
  if (restrictions.some((row) => row.for_value !== DEMO_GROUP))
    throw new Error(
      "Katalog hesabında farklı Item Group izinleri var. Kapsam otomatik genişletilmedi.",
    );
  if (
    !restrictions.some(
      (row) =>
        row.for_value === DEMO_GROUP &&
        (row.apply_to_all_doctypes || row.applicable_for === "Item"),
    )
  ) {
    await createDocument(frappe, credentials, "User Permission", {
      user: USER,
      allow: "Item Group",
      for_value: DEMO_GROUP,
      apply_to_all_doctypes: 0,
      applicable_for: "Item",
      hide_descendants: 1,
    });
    created.push("Item Group user restriction");
  }

  if (user.api_key) {
    if (!localToken)
      throw new Error(
        "Mevcut katalog anahtarı korunuyor; eşleşen yerel anahtar bulunamadı.",
      );
    await verifyToken(frappe, localToken);
    saveEnv();
    return {
      user: USER,
      role: ROLE,
      group: DEMO_GROUP,
      created,
      tokenStatus: "existing",
    };
  }
  const { data } = await frappe.request(
    "/api/method/frappe.core.doctype.user.user.generate_keys",
    credentials,
    { method: "POST", body: { user: USER } },
  );
  const key = data.message?.api_key;
  const secret = data.message?.api_secret;
  if (
    typeof key !== "string" ||
    typeof secret !== "string" ||
    !/^[A-Za-z0-9]+$/.test(key) ||
    !/^[A-Za-z0-9]+$/.test(secret)
  )
    throw new Error(
      "Yeni API anahtarının yanıtı doğrulanamadı. Yeniden anahtar üretmeden önce hesabı kontrol edin.",
    );
  const token = `${key}:${secret}`;
  // Persist immediately: a later verification error must not lose the new secret.
  saveEnv(token);
  await verifyToken(frappe, token);
  return {
    user: USER,
    role: ROLE,
    group: DEMO_GROUP,
    created,
    tokenStatus: "generated",
    catalogToken: token,
  };
}

export function safeFailure(error: unknown): string {
  return error instanceof ApiError
    ? `${error.status} ${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : "İşlem doğrulanamadı.";
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const main = async () => {
    const context = await openTestSession();
    try {
      const result = await provisionCatalog(
        context.frappe,
        context.credentials,
      );
      console.log(
        `Katalog yapılandırıldı: ${result.user}; ${result.group}; anahtar durumu: ${result.tokenStatus}. .env izinleri 600. Anahtar ekrana yazılmadı.`,
      );
    } finally {
      await context.close();
    }
  };
  main().catch((error) => {
    console.error(`Katalog kurulumu tamamlanamadı: ${safeFailure(error)}`);
    process.exitCode = 1;
  });
}
