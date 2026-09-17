/**
 * Real ERPNext demo records, not a frontend fallback. Imports do not run seeding.
 * Creates six simple Items, one template and two variants; no stock transactions.
 * Existing owned records are preserved. No welcome email or notification is sent.
 * Schema sources (the site's ERPNext revision):
 * https://github.com/frappe/erpnext/blob/4048fb7/erpnext/stock/doctype/item/item.json
 * https://github.com/frappe/erpnext/blob/4048fb7/erpnext/stock/doctype/item_attribute/item_attribute.json
 * https://github.com/frappe/erpnext/blob/4048fb7/erpnext/controllers/item_variant.py
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Credentials, Frappe } from "../server/frappe.ts";
import {
  assertTestSite,
  createDocument,
  DEMO_GROUP,
  ensureDemoGroup,
  openTestSession,
  readDocument,
  safeFailure,
} from "./provision-catalog.ts";

const MARKER = "[metaframer-headless-demo:v1]";
const ATTRIBUTE = "Metaframer Demo Size";
const TEMPLATE = "DEMO-MF-TRAIL-SHIRT";
const photo = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=80`;
const ITEMS = [
  {
    code: "DEMO-MF-DESK-LAMP",
    name: "Atlas Masa Lambası",
    description: "Çalışma masaları için örnek ürün.",
    image: photo("photo-1470770841072-f978cf4d019e"),
  },
  {
    code: "DEMO-MF-PACK",
    name: "Rota Sırt Çantası",
    description: "Günlük kullanım için örnek sırt çantası.",
    image: photo("photo-1464822759023-fed622ff2c3b"),
  },
  {
    code: "DEMO-MF-MUG",
    name: "Vadi Seramik Kupa",
    description: "Seramik ürün kategorisi için örnek kayıt.",
    image: photo("photo-1500530855697-b586d89ba3ee"),
  },
  {
    code: "DEMO-MF-CHAIR",
    name: "Koru Çalışma Sandalyesi",
    description: "Ofis envanteri için örnek kayıt.",
    image: photo("photo-1470252649378-9c29740c9fa8"),
  },
  {
    code: "DEMO-MF-NOTEBOOK",
    name: "Ufuk Not Defteri",
    description: "Kırtasiye ürünleri için örnek kayıt.",
    image: photo("photo-1469474968028-56623f02e42e"),
  },
  {
    code: "DEMO-MF-BOTTLE",
    name: "Doruk Su Şişesi",
    description: "Aksesuar kategorisi için örnek kayıt.",
    image: photo("photo-1441974231531-c6227db76b6e"),
  },
];

export interface DemoSeedResult {
  group: string;
  created: string[];
  existing: string[];
  templateId: string;
  variantIds: string[];
}

export async function seedDemo(
  frappe: Frappe,
  credentials: Credentials,
): Promise<DemoSeedResult> {
  assertTestSite(frappe);
  await ensureDemoGroup(frappe, credentials);
  const { data: options } = await frappe.options(credentials, DEMO_GROUP);
  const uom = options.uoms.includes("Nos") ? "Nos" : options.uoms[0];
  if (!uom)
    throw new Error(
      "Erişilebilir aktif UOM bulunamadı; demo ürün oluşturulmadı.",
    );
  const created: string[] = [];
  const existing: string[] = [];

  async function ensureItem(code: string, values: Record<string, unknown>) {
    const present = await readDocument(frappe, credentials, "Item", code);
    if (present) {
      if (
        present.item_code !== code ||
        present.item_group !== DEMO_GROUP ||
        !String(present.description || "").includes(MARKER)
      )
        throw new Error(
          `Demo kodu mevcut başka bir kayda ait: ${code}. Kayıt değiştirilmedi.`,
        );
      if (
        Boolean(present.has_variants) !== Boolean(values.has_variants) ||
        (present.variant_of || null) !== (values.variant_of || null)
      )
        throw new Error(
          `Demo ürününün varyant yapısı beklenenle aynı değil: ${code}. Kayıt değiştirilmedi.`,
        );
      existing.push(code);
      return;
    }
    const description = `${MARKER} ${String(values.description || "")} Demo üründür; manzara görseli temsilidir.`;
    const result = await createDocument(frappe, credentials, "Item", {
      item_code: code,
      item_group: DEMO_GROUP,
      stock_uom: uom,
      is_stock_item: 1,
      is_sales_item: 1,
      disabled: 0,
      ...values,
      description,
    });
    if (result.name !== code || result.item_code !== code)
      throw new Error(
        "ERPNext ürün kodunu isimlendirme ayarları nedeniyle değiştirdi. Otomatik yeniden denemeden önce demo kayıtlarını kontrol edin.",
      );
    const persisted = await readDocument(frappe, credentials, "Item", code);
    if (!persisted || !String(persisted.description || "").includes(MARKER))
      throw new Error("Demo ürünün kalıcı kaydı doğrulanamadı.");
    created.push(code);
  }

  const attribute = await readDocument(
    frappe,
    credentials,
    "Item Attribute",
    ATTRIBUTE,
  );
  if (attribute) {
    const values = new Map(
      (attribute.item_attribute_values || []).map((row: any) => [
        row.attribute_value,
        row.abbr,
      ]),
    );
    if (
      attribute.numeric_values ||
      attribute.disabled ||
      values.get("S") !== "S" ||
      values.get("M") !== "M"
    )
      throw new Error(
        "Metaframer Demo Size mevcut ancak beklenen S/M seçenekleriyle uyuşmuyor. Özellik değiştirilmedi.",
      );
  } else {
    await createDocument(frappe, credentials, "Item Attribute", {
      attribute_name: ATTRIBUTE,
      numeric_values: 0,
      disabled: 0,
      item_attribute_values: [
        { attribute_value: "S", abbr: "S" },
        { attribute_value: "M", abbr: "M" },
      ],
    });
  }

  for (const item of ITEMS)
    await ensureItem(item.code, {
      item_name: item.name,
      description: item.description,
      image: item.image,
    });
  const templateImage = photo("photo-1464822759023-fed622ff2c3b");
  await ensureItem(TEMPLATE, {
    item_name: "Rota Tişört",
    description: "S ve M bedenlerini karşılaştırmak için varyant şablonu.",
    image: templateImage,
    has_variants: 1,
    variant_based_on: "Item Attribute",
    attributes: [{ attribute: ATTRIBUTE }],
  });
  const variantIds: string[] = [];
  for (const size of ["S", "M"]) {
    const code = `${TEMPLATE}-${size}`;
    await ensureItem(code, {
      item_name: `Rota Tişört · ${size}`,
      description: `${size} beden varyantı.`,
      image: templateImage,
      has_variants: 0,
      variant_of: TEMPLATE,
      variant_based_on: "Item Attribute",
      attributes: [{ attribute: ATTRIBUTE, attribute_value: size }],
    });
    variantIds.push(code);
  }
  return {
    group: DEMO_GROUP,
    created,
    existing,
    templateId: TEMPLATE,
    variantIds,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const main = async () => {
    const context = await openTestSession();
    try {
      const result = await seedDemo(context.frappe, context.credentials);
      console.log(
        `Canlı demo kayıtları doğrulandı: ${result.created.length} yeni, ${result.existing.length} mevcut ürün. Grup: ${result.group}; 1 şablon, 2 varyant. Görseller temsilidir.`,
      );
    } finally {
      await context.close();
    }
  };
  main().catch((error) => {
    console.error(`Demo kurulumu tamamlanamadı: ${safeFailure(error)}`);
    process.exitCode = 1;
  });
}
