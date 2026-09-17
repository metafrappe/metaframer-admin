import { randomUUID } from "node:crypto";
import { ApiError, Frappe, type Credentials } from "./frappe.ts";
import type {
  Product,
  ProductList,
  ProductDetail,
} from "../shared/contracts.ts";

export async function verifyLive(
  frappe: Frappe,
  credentials: Credentials,
  group: string,
  storefront = "http://localhost:4301",
  adminRequest?: (method: string, path: string, body?: unknown) => Promise<any>,
) {
  if (frappe.base !== "https://erp-test.metaframer.net")
    throw new ApiError(
      403,
      "TEST_SITE_REQUIRED",
      "Bu doğrulama yalnızca ERP test sitesinde kullanılabilir.",
    );
  if (!adminRequest)
    throw new ApiError(
      500,
      "ADMIN_TRANSPORT_REQUIRED",
      "Canlı kontrol yönetim API’si üzerinden çalışmalıdır.",
    );
  const steps: string[] = [];
  const code = `MF-SMOKE-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const marker = `Headless roundtrip ${randomUUID()}`;
  const { data: options } = await frappe.options(credentials, group);
  if (!options.itemGroups.includes(group) || !options.uoms.length)
    throw new ApiError(
      422,
      "DEMO_GROUP_REQUIRED",
      "Önce katalog bağlantısını ve demo ürün grubunu oluşturun.",
    );
  const check = (ok: boolean, message: string) => {
    if (!ok) throw new ApiError(502, "VERIFICATION_FAILED", message);
  };
  const getStorefront = async (id: string) => {
    const url = new URL(
      `/api/v1/products/${encodeURIComponent(id)}`,
      storefront,
    );
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      throw new ApiError(
        403,
        "LOCAL_SITE_REQUIRED",
        "Test vitrini yerel olmalıdır.",
      );
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });
    const body = (await response.json()) as ProductDetail;
    return { status: response.status, body };
  };
  let createdId = code;
  let attempted = false;
  let removed = false;
  try {
    attempted = true;
    const created = await adminRequest("POST", "/api/v1/products", {
      code,
      name: `API doğrulama ${code}`,
      description: marker,
      group,
      uom: options.uoms[0],
      image: null,
      disabled: false,
      isStockItem: false,
    });
    createdId = created.data.id;
    const fresh = await frappe.doc(createdId, credentials);
    check(
      fresh.item_code === code && fresh.description === marker,
      "Oluşturulan ürün Frappe üzerinde doğrulanamadı.",
    );
    steps.push(
      `YÖNETİM API POST + FRAPPE GET: ${code} Frappe üzerinde bağımsız GET ile doğrulandı.`,
    );
    const publicRead = await getStorefront(createdId);
    check(
      publicRead.status === 200 && publicRead.body.data.product.code === code,
      "Oluşturulan ürün vitrin API’sinde görülmedi.",
    );
    steps.push(
      "VİTRİN: Aynı ürün iki repo arasındaki API bağlantısıyla okundu.",
    );
    const changedName = `Güncellendi ${code}`;
    await adminRequest(
      "PATCH",
      `/api/v1/products/${encodeURIComponent(createdId)}`,
      { name: changedName, modified: fresh.modified },
    );
    const updated = await frappe.doc(createdId, credentials);
    check(
      updated.item_name === changedName,
      "Güncelleme Frappe üzerinde kalıcı değil.",
    );
    const storefrontUpdated = await getStorefront(createdId);
    check(
      storefrontUpdated.status === 200 &&
        storefrontUpdated.body.data.product.name === changedName,
      "Güncelleme vitrinde görülmedi.",
    );
    steps.push(
      "UPDATE: Yeni ad hem Frappe’den hem vitrinden tekrar okunarak doğrulandı.",
    );
    let rejected = false;
    try {
      await adminRequest(
        "PATCH",
        `/api/v1/products/${encodeURIComponent(createdId)}`,
        { name: "Should never persist", modified: fresh.modified },
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) rejected = true;
      else throw error;
    }
    check(rejected, "Eski sürümle güncelleme reddedilmedi.");
    steps.push(
      "ÇAKIŞMA: Eski modified değeriyle üzerine yazma 409 ile reddedildi.",
    );
    await adminRequest(
      "DELETE",
      `/api/v1/products/${encodeURIComponent(createdId)}`,
    );
    removed = true;
    let absent = false;
    try {
      await frappe.doc(createdId, credentials);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) absent = true;
      else throw error;
    }
    check(absent, "Silinen kayıt Frappe’de hâlâ var.");
    check(
      (await getStorefront(createdId)).status === 404,
      "Silinen ürün vitrin API’sinde hâlâ var.",
    );
    steps.push("DELETE: Geçici ürün silindi; Frappe ve vitrin 404 döndürdü.");
    return { steps };
  } finally {
    if (attempted && !removed) {
      try {
        const doc = await frappe.doc(createdId, credentials);
        if (doc.description === marker && !doc.has_variants)
          await adminRequest(
            "DELETE",
            `/api/v1/products/${encodeURIComponent(createdId)}`,
          );
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404))
          console.info(
            JSON.stringify({
              code: "LIVE_TEST_CLEANUP_REQUIRED",
              item: createdId,
            }),
          );
      }
    }
  }
}
