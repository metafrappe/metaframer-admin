import { randomUUID } from "node:crypto";
import type { Product, ProductInput } from "../shared/contracts.ts";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export type Credentials = { sid: string; csrf?: string } | { token: string };
export type ListQuery = {
  q: string;
  group: string;
  status: "active" | "disabled" | "all";
  page: number;
  pageSize: number;
  sort: "name" | "-modified" | "code";
};
const fields = [
  "name",
  "item_code",
  "item_name",
  "description",
  "item_group",
  "stock_uom",
  "image",
  "disabled",
  "is_stock_item",
  "has_variants",
  "variant_of",
  "modified",
];
const publicFields = [
  "name",
  "item_code",
  "item_name",
  "description",
  "item_group",
  "stock_uom",
  "image",
  "disabled",
  "is_stock_item",
  "has_variants",
  "variant_of",
  "modified",
];
const cleanText = (value: unknown) =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
function safeImage(value: unknown, base: string): string | null {
  if (!value || typeof value !== "string" || value.startsWith("/private/"))
    return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function mapProduct(doc: Record<string, any>, base: string): Product {
  return {
    id: doc.name,
    code: doc.item_code,
    name: doc.item_name || doc.item_code,
    description: cleanText(doc.description),
    group: doc.item_group,
    uom: doc.stock_uom,
    image: safeImage(doc.image, base),
    disabled: Boolean(doc.disabled),
    isStockItem: Boolean(doc.is_stock_item),
    hasVariants: Boolean(doc.has_variants),
    variantOf: doc.variant_of || null,
    attributes: (doc.attributes || []).map((a: any) => ({
      name: String(a.attribute),
      value: String(a.attribute_value || ""),
    })),
    modified: String(doc.modified || ""),
  };
}
export class Frappe {
  constructor(
    public base: string,
    private fetcher: typeof fetch = fetch,
  ) {
    this.base = new URL(base).origin;
  }
  async request(
    path: string,
    credentials?: Credentials,
    options: { method?: string; body?: unknown; raw?: boolean } = {},
  ): Promise<any> {
    const headers = new Headers({
      Accept: options.raw ? "text/html" : "application/json",
      "X-Request-ID": randomUUID(),
    });
    if (credentials && "sid" in credentials) {
      headers.set("Cookie", `sid=${credentials.sid}`);
      if (credentials.csrf)
        headers.set("X-Frappe-CSRF-Token", credentials.csrf);
    }
    if (credentials && "token" in credentials)
      headers.set("Authorization", `token ${credentials.token}`);
    if (options.body !== undefined)
      headers.set("Content-Type", "application/json");
    let res: Response;
    try {
      res = await this.fetcher(`${this.base}${path}`, {
        method: options.method || "GET",
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(20000),
        redirect: "manual",
        cache: "no-store",
      });
    } catch (error) {
      throw new ApiError(
        error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name)
          ? 504
          : 502,
        "UPSTREAM_UNAVAILABLE",
        "Frappe sunucusuna ulaşılamadı. Lütfen tekrar deneyin.",
      );
    }
    const text = await res.text();
    if (options.raw && res.ok) return text;
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      if (res.ok)
        throw new ApiError(
          502,
          "UPSTREAM_INVALID",
          "Frappe geçerli JSON yanıtı döndürmedi. İşlem sonucunu yeniden okuyarak kontrol edin.",
        );
      data = {};
    }
    if (res.ok && (!data || typeof data !== "object" || Array.isArray(data)))
      throw new ApiError(
        502,
        "UPSTREAM_INVALID",
        "Frappe geçersiz yanıt döndürdü.",
      );
    if (!res.ok) {
      const type = String(data.exc_type || "");
      if (res.status === 401 || type === "AuthenticationError")
        throw new ApiError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Giriş bilgileri geçersiz veya oturum süresi doldu.",
        );
      if (res.status === 403 || type === "PermissionError")
        throw new ApiError(
          403,
          "PERMISSION_DENIED",
          "Frappe kullanıcınız bu işlem için yetkili değil.",
        );
      if (res.status === 404 || type === "DoesNotExistError")
        throw new ApiError(
          404,
          "NOT_FOUND",
          "Ürün veya istenen kayıt bulunamadı.",
        );
      if (
        [
          "TimestampMismatchError",
          "DuplicateEntryError",
          "LinkExistsError",
        ].includes(type) ||
        res.status === 409
      )
        throw new ApiError(
          409,
          "CONFLICT",
          type === "TimestampMismatchError"
            ? "Kayıt başka bir işlemde değişti. Sayfayı yenileyip tekrar deneyin."
            : type === "DuplicateEntryError"
              ? "Bu ürün kodu zaten kullanılıyor."
              : "Ürün başka kayıtlarda kullanıldığı için silinemiyor. Pasife alabilirsiniz.",
        );
      if (res.status === 429)
        throw new ApiError(
          429,
          "RATE_LIMITED",
          "Çok fazla istek gönderildi. Biraz sonra tekrar deneyin.",
        );
      if (res.status === 417 || (res.status >= 400 && res.status < 500))
        throw new ApiError(
          422,
          "FRAPPE_VALIDATION",
          "Frappe bu değişikliği kabul etmedi. Ürün grubu, birim ve zorunlu alanları kontrol edin.",
        );
      throw new ApiError(
        502,
        "UPSTREAM_ERROR",
        "Frappe işlemi tamamlayamadı. İşlem sonucu belirsizse yeniden kaydetmeden önce listeyi yenileyin.",
      );
    }
    return { data, headers: res.headers };
  }
  async login(username: string, password: string) {
    const { data, headers } = await this.request(
      "/api/method/login",
      undefined,
      { method: "POST", body: { usr: username, pwd: password } },
    );
    const cookie = (headers as Headers)
      .getSetCookie()
      .find((value) => value.startsWith("sid="));
    const sid = cookie?.match(/^sid=([^;]+)/)?.[1];
    if (!sid || sid === "Guest")
      throw new ApiError(
        401,
        "LOGIN_INCOMPLETE",
        data?.verification
          ? "Bu hesap ek doğrulama gerektiriyor. Frappe üzerinden giriş yöntemini kontrol edin."
          : "Giriş tamamlanamadı. Kullanıcı bilgilerini kontrol edin.",
      );
    const html: string = await this.request("/desk", { sid }, { raw: true });
    const csrf = html.match(/frappe\.csrf_token\s*=\s*["']([^"']+)["']/)?.[1];
    if (!csrf) {
      await this.request(
        "/api/method/logout",
        { sid },
        { method: "POST" },
      ).catch(() => {});
      throw new ApiError(
        502,
        "CSRF_BOOTSTRAP_FAILED",
        "Frappe oturumu başlatıldı ancak güvenlik bilgisi alınamadı.",
      );
    }
    const user = await this.user({ sid, csrf });
    return { sid, csrf, user };
  }
  async user(credentials: Credentials): Promise<string> {
    const { data } = await this.request(
      "/api/method/frappe.auth.get_logged_user",
      credentials,
    );
    if (!data.message || data.message === "Guest")
      throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Lütfen giriş yapın.");
    return data.message;
  }
  async list(
    credentials: Credentials,
    query: ListQuery,
    publicGroup?: string,
    variantOf?: string,
  ) {
    const filters: any[] = [];
    if (publicGroup)
      filters.push(
        ["item_group", "=", publicGroup],
        ["disabled", "=", 0],
        ["is_sales_item", "=", 1],
      );
    else {
      if (query.group) filters.push(["item_group", "=", query.group]);
      if (query.status !== "all")
        filters.push(["disabled", "=", query.status === "disabled" ? 1 : 0]);
    }
    if (variantOf) filters.push(["variant_of", "=", variantOf]);
    const orFilters = query.q
      ? [
          ["item_code", "like", `%${query.q}%`],
          ["item_name", "like", `%${query.q}%`],
        ]
      : [];
    const params = new URLSearchParams({
      fields: JSON.stringify(publicGroup ? publicFields : fields),
      filters: JSON.stringify(filters),
      or_filters: JSON.stringify(orFilters),
      order_by: {
        name: "item_name asc, name asc",
        code: "item_code asc, name asc",
        "-modified": "modified desc, name asc",
      }[query.sort],
      limit_start: String((query.page - 1) * query.pageSize),
      limit_page_length: String(query.pageSize + 1),
    });
    const { data } = await this.request(
      `/api/resource/Item?${params}`,
      credentials,
    );
    if (!Array.isArray(data.data))
      throw new ApiError(
        502,
        "UPSTREAM_INVALID",
        "Frappe geçersiz liste yanıtı döndürdü.",
      );
    const docs = data.data;
    return {
      data: docs
        .slice(0, query.pageSize)
        .map((d: any) => mapProduct(d, this.base)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        hasMore: docs.length > query.pageSize,
        source: "frappe" as const,
      },
    };
  }
  async doc(
    id: string,
    credentials: Credentials,
  ): Promise<Record<string, any>> {
    const { data } = await this.request(
      `/api/resource/Item/${encodeURIComponent(id)}`,
      credentials,
    );
    if (
      !data.data ||
      typeof data.data.name !== "string" ||
      typeof data.data.item_code !== "string" ||
      typeof data.data.item_group !== "string" ||
      typeof data.data.stock_uom !== "string"
    )
      throw new ApiError(
        502,
        "UPSTREAM_INVALID",
        "Frappe geçersiz ürün yanıtı döndürdü.",
      );
    return data.data;
  }
  async detail(id: string, credentials: Credentials, publicGroup?: string) {
    const doc = await this.doc(id, credentials);
    if (
      publicGroup &&
      (doc.disabled || !doc.is_sales_item || doc.item_group !== publicGroup)
    )
      throw new ApiError(404, "NOT_FOUND", "Ürün bulunamadı.");
    const variantResult = doc.has_variants
      ? await this.list(
          credentials,
          {
            q: "",
            group: "",
            status: "all",
            page: 1,
            pageSize: 50,
            sort: "code",
          },
          publicGroup,
          id,
        )
      : { data: [], meta: { page: 1, pageSize: 50, hasMore: false } };
    return {
      data: {
        product: mapProduct(doc, this.base),
        variants: variantResult.data,
      },
      meta: {
        source: "frappe" as const,
        variants: {
          page: 1,
          pageSize: 50,
          hasMore: variantResult.meta.hasMore,
        },
      },
    };
  }
  async variants(
    id: string,
    credentials: Credentials,
    query: ListQuery,
    publicGroup?: string,
  ) {
    const doc = await this.doc(id, credentials);
    if (
      publicGroup &&
      (doc.disabled || !doc.is_sales_item || doc.item_group !== publicGroup)
    )
      throw new ApiError(404, "NOT_FOUND", "Ürün bulunamadı.");
    if (!doc.has_variants)
      return {
        data: [],
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          hasMore: false,
          source: "frappe" as const,
        },
      };
    return this.list(
      credentials,
      { ...query, q: "", group: "", sort: "code" },
      publicGroup,
      id,
    );
  }
  async options(credentials: Credentials, publicGroup: string) {
    const fetchNames = async (doctype: string, filters: any[]) => {
      const names: string[] = [];
      for (let start = 0; start < 10000; start += 500) {
        const params = new URLSearchParams({
          fields: '["name"]',
          filters: JSON.stringify(filters),
          order_by: "name asc",
          limit_start: String(start),
          limit_page_length: "500",
        });
        const { data } = await this.request(
          `/api/resource/${encodeURIComponent(doctype)}?${params}`,
          credentials,
        );
        names.push(...data.data.map((d: any) => d.name));
        if (data.data.length < 500) break;
      }
      return names;
    };
    const [itemGroups, uoms] = await Promise.all([
      fetchNames("Item Group", [["is_group", "=", 0]]),
      fetchNames("UOM", [["enabled", "=", 1]]),
    ]);
    return { data: { itemGroups, uoms, publicGroup } };
  }
  async save(
    input: Partial<ProductInput> & { modified?: string },
    credentials: Credentials,
    id?: string,
  ) {
    const mapping = {
      code: "item_code",
      name: "item_name",
      description: "description",
      group: "item_group",
      uom: "stock_uom",
      image: "image",
      disabled: "disabled",
      isStockItem: "is_stock_item",
      modified: "modified",
    };
    const body: Record<string, any> = {};
    for (const [key, target] of Object.entries(mapping))
      if (key in input) body[target] = (input as any)[key];
    if (id) {
      const current = await this.doc(id, credentials);
      if (input.code && input.code !== current.item_code)
        throw new ApiError(
          422,
          "IMMUTABLE_CODE",
          "Ürün kodu oluşturulduktan sonra değiştirilemez.",
        );
      if (input.modified && input.modified !== current.modified)
        throw new ApiError(
          409,
          "CONFLICT",
          "Kayıt başka bir işlemde değişti. Önce güncel kaydı yükleyin.",
        );
      body.modified = input.modified || current.modified;
      delete body.item_code;
    } else {
      body.doctype = "Item";
      body.is_sales_item = 1;
    }
    const { data } = await this.request(
      `/api/resource/Item${id ? `/${encodeURIComponent(id)}` : ""}`,
      credentials,
      { method: id ? "PUT" : "POST", body },
    );
    if (
      !data.data ||
      typeof data.data.name !== "string" ||
      !data.data.name ||
      typeof data.data.item_code !== "string" ||
      typeof data.data.item_group !== "string" ||
      typeof data.data.stock_uom !== "string" ||
      (id && data.data.name !== id) ||
      (!id && data.data.item_code !== input.code)
    )
      throw new ApiError(
        502,
        "UPSTREAM_INVALID",
        "Frappe kayıt sonucunu doğrulayamadı. Tekrar kaydetmeden önce ürün listesini yenileyin.",
      );
    return { data: mapProduct(data.data, this.base) };
  }
  async remove(id: string, credentials: Credentials) {
    const doc = await this.doc(id, credentials);
    if (doc.has_variants)
      throw new ApiError(
        409,
        "VARIANT_TEMPLATE_PROTECTED",
        "Varyant şablonu silinemez. Ürünü pasife alabilirsiniz.",
      );
    const { data } = await this.request(
      `/api/resource/Item/${encodeURIComponent(id)}`,
      credentials,
      { method: "DELETE" },
    );
    if (data.data !== "ok")
      throw new ApiError(
        502,
        "UPSTREAM_INVALID",
        "Frappe silme işlemini doğrulamadı. Ürün listesini yenileyerek kontrol edin.",
      );
  }
}
