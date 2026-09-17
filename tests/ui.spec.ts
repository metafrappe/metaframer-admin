import { expect, test, type Page } from "@playwright/test";
import type { Product, ProductInput } from "../shared/contracts";

// These intercepted API fixtures verify browser behavior and the API contract.
// They do not verify, or claim to verify, live ERPNext persistence.
const initialProduct: Product = {
  id: "UI-ONLY-001",
  code: "UI-ONLY-001",
  name: "Kontrollü test ürünü",
  description: "Yalnızca arayüz sözleşme testi; canlı ERPNext ürünü değildir.",
  group: "Metaframer Demo",
  uom: "Nos",
  image: null,
  disabled: false,
  isStockItem: true,
  hasVariants: false,
  variantOf: null,
  attributes: [],
  modified: "2026-09-17 10:00:00",
};
const template: Product = {
  ...initialProduct,
  id: "UI-TEMPLATE",
  code: "UI-TEMPLATE",
  name: "Test varyant şablonu",
  hasVariants: true,
};
const variant: Product = {
  ...initialProduct,
  id: "UI-VARIANT",
  code: "UI-VARIANT",
  name: "Yeşil varyant",
  variantOf: template.id,
  attributes: [{ name: "Renk", value: "Yeşil" }],
};

async function interceptAdmin(page: Page, { signedIn = true } = {}) {
  let session = signedIn;
  let rejectWrite = false;
  let listError = 0;
  let rejectLogin = false;
  const products = new Map(
    [initialProduct, template, variant].map((product) => [
      product.id,
      { ...product },
    ]),
  );
  const writes: {
    method: string;
    path: string;
    body: Record<string, unknown>;
    csrf?: string;
  }[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const problem = (status: number, detail: string) =>
      route.fulfill({
        status,
        contentType: "application/problem+json",
        body: JSON.stringify({
          status,
          title: "UI test error",
          detail,
          requestId: "ui-contract-request",
        }),
      });
    const user = {
      user: "ui-test@example.invalid",
      csrfToken: "controlled-ui-csrf-token",
    };
    if (path === "/api/v1/auth/session")
      return session
        ? route.fulfill({ json: { data: user } })
        : problem(401, "Oturum bulunamadı.");
    if (path === "/api/v1/auth/login") {
      writes.push({ method, path, body: request.postDataJSON() });
      if (rejectLogin)
        return problem(401, "Kullanıcı adı veya şifre geçersiz.");
      session = true;
      return route.fulfill({ json: { data: user } });
    }
    if (!session) return problem(401, "Oturumunuz sona erdi.");
    if (path === "/api/v1/auth/logout") {
      session = false;
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/v1/product-options")
      return route.fulfill({
        json: {
          data: {
            itemGroups: ["Metaframer Demo", "Diğer"],
            uoms: ["Nos", "Adet"],
            publicGroup: "Metaframer Demo",
          },
        },
      });
    if (path === "/api/v1/apps")
      return route.fulfill({
        json: {
          data: [
            {
              id: "erpnext",
              name: "ERPNext",
              url: "https://erp-test.metaframer.net/desk",
              mode: "native",
            },
          ],
        },
      });
    if (method !== "GET") {
      writes.push({
        method,
        path,
        body: method === "DELETE" ? {} : request.postDataJSON(),
        csrf: request.headers()["x-csrf-token"],
      });
      if (rejectWrite)
        return problem(
          409,
          "Ürün başka bir kullanıcı tarafından değiştirildi. Sayfayı yenileyin.",
        );
    }
    if (path === "/api/v1/products") {
      if (method === "POST") {
        const input = request.postDataJSON() as ProductInput;
        const created = { ...initialProduct, ...input, id: input.code };
        products.set(created.id, created);
        return route.fulfill({ status: 201, json: { data: created } });
      }
      if (listError)
        return problem(
          listError,
          "ERPNext bağlantısı geçici olarak kullanılamıyor.",
        );
      const query = url.searchParams.get("q")?.toLocaleLowerCase("tr") || "";
      const group = url.searchParams.get("group");
      const status = url.searchParams.get("status");
      const values = Array.from(products.values()).filter(
        (product) =>
          (!query ||
            `${product.name} ${product.code}`
              .toLocaleLowerCase("tr")
              .includes(query)) &&
          (!group || product.group === group) &&
          (status === "disabled"
            ? product.disabled
            : status === "active"
              ? !product.disabled
              : true),
      );
      const pageNumber = Number(url.searchParams.get("page") || 1);
      const pageSize = Number(url.searchParams.get("pageSize") || 20);
      const start = (pageNumber - 1) * pageSize;
      return route.fulfill({
        json: {
          data: values.slice(start, start + pageSize),
          meta: {
            page: pageNumber,
            pageSize,
            hasMore: start + pageSize < values.length,
            source: "frappe",
          },
        },
      });
    }
    if (path.startsWith("/api/v1/products/")) {
      const id = decodeURIComponent(path.slice("/api/v1/products/".length));
      const product = products.get(id);
      if (!product) return problem(404, "Ürün bulunamadı.");
      if (method === "DELETE") {
        products.delete(id);
        return route.fulfill({ status: 204 });
      }
      if (method === "PATCH") {
        const input = request.postDataJSON() as ProductInput;
        const updated = {
          ...product,
          ...input,
          modified: "2026-09-17 11:00:00",
        };
        products.set(id, updated);
        return route.fulfill({ json: { data: updated } });
      }
      return route.fulfill({
        json: {
          data: {
            product,
            variants: Array.from(products.values()).filter(
              (item) => item.variantOf === id,
            ),
          },
          meta: { source: "frappe" },
        },
      });
    }
    return problem(404, "Test yolu bulunamadı.");
  });
  return {
    products,
    writes,
    expire: () => {
      session = false;
    },
    rejectWrite: () => {
      rejectWrite = true;
    },
    listError: (value: number) => {
      listError = value;
    },
    rejectLogin: (value: boolean) => {
      rejectLogin = value;
    },
  };
}

for (const width of [390, 768, 1280, 1536]) {
  test(`products and form fit ${width}px without horizontal scrolling`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await interceptAdmin(page);
    await page.goto("/products");
    await expect(
      page.getByRole("heading", { name: "Ürünler", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByText(initialProduct.name, { exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (width === 390) {
      await expect(page.locator(".sidebar")).toHaveAttribute("inert", "");
      await page.getByRole("button", { name: "Menüyü aç" }).click();
      await expect(
        page.getByRole("button", { name: "Menüyü kapat" }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Menüyü aç" }),
      ).toBeFocused();
    }
    await page.getByRole("link", { name: "Yeni ürün", exact: true }).click();
    await expect(page.getByLabel("Ürün adı", { exact: false })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("real login request shape, invalid login feedback, and no password persistence", async ({
  page,
}) => {
  const fixture = await interceptAdmin(page, { signedIn: false });
  fixture.rejectLogin(true);
  await page.goto("/products");
  await expect(page).toHaveURL(/\/login$/);
  await page
    .getByLabel("E-posta veya kullanıcı adı")
    .fill("ui-test@example.invalid");
  await page.getByLabel("Şifre", { exact: true }).fill("UI-only-test-password");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Kullanıcı adı veya şifre geçersiz.",
  );
  fixture.rejectLogin(false);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Ürünler", exact: true }),
  ).toBeVisible();
  expect(fixture.writes[0].body).toEqual({
    username: "ui-test@example.invalid",
    password: "UI-only-test-password",
  });
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("UI-only-test-password");
  await page.getByRole("button", { name: "Çıkış yap" }).click();
  await expect(
    page.getByRole("heading", { name: "Hesabınıza giriş yapın" }),
  ).toBeVisible();
});

test("create, read, modify and delete follow accepted responses and carry CSRF/version", async ({
  page,
}) => {
  const fixture = await interceptAdmin(page);
  await page.goto("/products/new");
  await page.getByRole("button", { name: "Ürünü oluştur" }).click();
  await expect(page.getByText("Bu alan zorunludur.")).toHaveCount(2);
  await page.getByLabel("Ürün adı", { exact: false }).fill("UI yeni ürün");
  await page.getByLabel("Ürün kodu", { exact: false }).fill("UI-NEW-001");
  await page.getByLabel("Açıklama").fill("Arayüz testi kaydı.");
  await page.getByRole("button", { name: "Ürünü oluştur" }).click();
  await expect(
    page.getByRole("heading", { name: "UI yeni ürün", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Ürün ERPNext’te oluşturuldu.",
  );
  expect(fixture.products.get("UI-NEW-001")?.name).toBe("UI yeni ürün");
  await page.getByRole("link", { name: "Düzenle", exact: true }).click();
  await expect(page.getByLabel("Ürün kodu", { exact: false })).toHaveAttribute(
    "readonly",
    "",
  );
  await page.getByLabel("Ürün adı", { exact: false }).fill("UI güncel ürün");
  await page.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  await expect(
    page.getByRole("heading", { name: "UI güncel ürün", exact: true }),
  ).toBeVisible();
  const patch = fixture.writes.find((write) => write.method === "PATCH");
  expect(patch?.body.modified).toBe(initialProduct.modified);
  expect(patch?.body).not.toHaveProperty("code");
  expect(patch?.body).not.toHaveProperty("description");
  expect(patch?.csrf).toBe("controlled-ui-csrf-token");
  await page.getByRole("button", { name: "Ürünü sil", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  expect(
    fixture.writes.filter((write) => write.method === "DELETE"),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "Ürünü sil", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Ürünü sil", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ürünler", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Ürün ERPNext’ten silindi.",
  );
  expect(fixture.products.has("UI-NEW-001")).toBe(false);
  expect(fixture.writes.find((write) => write.method === "DELETE")?.csrf).toBe(
    "controlled-ui-csrf-token",
  );
});

test("search filters stay in the URL when paging real response pages", async ({
  page,
}) => {
  const fixture = await interceptAdmin(page);
  for (let index = 1; index <= 21; index++) {
    const id = `PAGE-ONLY-${index}`;
    fixture.products.set(id, {
      ...initialProduct,
      id,
      code: id,
      name: `Sayfalı test ${index}`,
    });
  }
  await page.goto("/products?q=Sayfalı&group=Metaframer+Demo&status=active");
  await expect(page.locator(".desktop-table tbody tr")).toHaveCount(20);
  await page.getByRole("button", { name: "Sonraki", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("textbox", { name: "Ürün ara" })).toHaveValue(
    "Sayfalı",
  );
  await expect(page.getByLabel("Ürün grubu", { exact: true })).toHaveValue(
    "Metaframer Demo",
  );
  await expect(page.getByLabel("Ürün durumu")).toHaveValue("active");
  await expect(page.locator(".desktop-table tbody tr")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Sonraki", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Önceki", exact: true }).click();
  await expect(page.locator(".desktop-table tbody tr")).toHaveCount(20);
  await expect(
    page.getByRole("button", { name: "Önceki", exact: true }),
  ).toBeDisabled();
});

test("template deletion is disabled and variants remain real linked records", async ({
  page,
}) => {
  const fixture = await interceptAdmin(page);
  await page.goto(`/products/${template.id}`);
  await expect(
    page.getByRole("button", { name: "Ürünü sil", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Varyant şablonu silinemez; pasife alabilirsiniz."),
  ).toBeVisible();
  await expect(page.getByText("Renk: Yeşil")).toBeVisible();
  await page.getByRole("link", { name: /Yeşil varyant/ }).click();
  await expect(
    page.getByRole("heading", { name: "Yeşil varyant", exact: true }),
  ).toBeVisible();
  expect(fixture.writes).toHaveLength(0);
});

test("variant pages append safely, retry failures, and reset for another product", async ({
  page,
}) => {
  const fixture = await interceptAdmin(page);
  const firstPage = Array.from({ length: 50 }, (_, index) => ({
    ...variant,
    id: `UI-PAGED-${index + 1}`,
    code: `UI-PAGED-${index + 1}`,
    name: `Sayfalı varyant ${index + 1}`,
    attributes: [],
  }));
  for (const product of firstPage) fixture.products.set(product.id, product);
  const nextVariant = {
    ...variant,
    id: "UI-PAGED-51",
    code: "UI-PAGED-51",
    name: "Son varyant",
    attributes: [],
  };
  let calls = 0;
  let releaseFailure = () => {};
  const failureGate = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  await page.route("**/api/v1/products/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/v1/products/${template.id}`) {
      return route.fulfill({
        json: {
          data: { product: template, variants: firstPage },
          meta: {
            source: "frappe",
            variants: { page: 1, pageSize: 50, hasMore: true },
          },
        },
      });
    }
    if (url.pathname === `/api/v1/products/${template.id}/variants`) {
      calls++;
      expect(url.searchParams.get("page")).toBe("2");
      expect(url.searchParams.get("pageSize")).toBe("50");
      if (calls === 1) {
        await failureGate;
        return route.fulfill({
          status: 503,
          json: { detail: "Varyant sayfası geçici olarak alınamadı." },
        });
      }
      return route.fulfill({
        json: {
          data: [firstPage[0], nextVariant],
          meta: { page: 2, pageSize: 50, hasMore: false, source: "frappe" },
        },
      });
    }
    return route.fallback();
  });
  await page.goto(`/products/${template.id}`);
  await expect(page.locator(".variant-row")).toHaveCount(50);
  await page.getByRole("button", { name: "Daha fazla varyant" }).click();
  await expect(
    page.getByRole("button", { name: "Varyantlar yükleniyor…" }),
  ).toBeDisabled();
  releaseFailure();
  await expect(page.getByRole("alert")).toContainText(
    "Varyant sayfası geçici olarak alınamadı.",
  );
  await expect(page.locator(".variant-row")).toHaveCount(50);
  await page.getByRole("button", { name: "Yeniden dene", exact: true }).click();
  await expect(page.locator(".variant-row")).toHaveCount(51);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Daha fazla varyant" }),
  ).toHaveCount(0);
  await page.locator(".variant-row").first().click();
  await expect(
    page.getByRole("heading", { name: firstPage[0].name, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".variant-row")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Daha fazla varyant" }),
  ).toHaveCount(0);
  expect(calls).toBe(2);
});

test("conflicting updates never show success and keep the form contents", async ({
  page,
}) => {
  const fixture = await interceptAdmin(page);
  fixture.rejectWrite();
  await page.goto(`/products/${initialProduct.id}/edit`);
  await page
    .getByLabel("Ürün adı", { exact: false })
    .fill("Kaydedilemeyen güncelleme");
  await page.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "başka bir kullanıcı tarafından değiştirildi",
  );
  await expect(page.getByLabel("Ürün adı", { exact: false })).toHaveValue(
    "Kaydedilemeyen güncelleme",
  );
  await expect(page.locator(".notice")).toHaveCount(0);
  expect(fixture.products.get(initialProduct.id)?.name).toBe(
    initialProduct.name,
  );
});

test("search/empty/retry states do not invent products and expired session returns to login", async ({
  page,
}) => {
  const fixture = await interceptAdmin(page);
  fixture.listError(503);
  await page.goto("/products");
  await expect(page.getByRole("alert")).toContainText("ERPNext bağlantısı");
  await expect(page.locator(".notice")).toHaveCount(0);
  fixture.listError(0);
  await page.getByRole("button", { name: "Yeniden dene" }).click();
  await expect(
    page
      .getByText(initialProduct.name, { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Ürün ara" }).fill("olmayan-kod");
  await expect(
    page.getByRole("heading", { name: "Aramanıza uygun ürün yok" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Filtreleri temizle" }).click();
  await expect(
    page
      .getByText(initialProduct.name, { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  fixture.expire();
  await page.getByRole("button", { name: "Ürünleri yenile" }).click();
  await expect(
    page.getByRole("heading", { name: "Hesabınıza giriş yapın" }),
  ).toBeVisible();
});
