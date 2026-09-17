/**
 * Explicit LIVE adapter verification. Creates and removes one uniquely named
 * temporary Item on erp-test.metaframer.net. Never use production credentials.
 *
 * npm exec tsx scripts/live-smoke.ts
 * Required: FRAPPE_TEST_USER + FRAPPE_TEST_PASSWORD, or
 * FRAPPE_TEST_API_KEY + FRAPPE_TEST_API_SECRET for token-only adapter validation.
 * This script never prints credentials or claims that HTTP UI routes were tested.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError, Frappe, type Credentials } from "../server/frappe.ts";

const base = process.env.FRAPPE_URL || "https://erp-test.metaframer.net";
const groupPreference =
  process.env.CATALOG_ITEM_GROUP ||
  process.env.PUBLIC_CATALOG_GROUP ||
  "Metaframer Demo";

function log(step: string) {
  console.log(`[LIVE Frappe adapter] ${step}`);
}
function describeError(error: unknown) {
  if (error instanceof ApiError)
    return `${error.status} ${error.code}: ${error.message}`;
  // Deliberately omit stack traces and arbitrary transport/response content.
  if (error instanceof assert.AssertionError)
    return "Doğrulama başarısız: Frappe yanıtı beklenen kayıtla eşleşmedi.";
  return error instanceof Error
    ? error.message
    : "Bilinmeyen doğrulama hatası.";
}

async function main() {
  const target = new URL(base);
  if (
    target.origin !== "https://erp-test.metaframer.net" ||
    target.username ||
    target.password
  ) {
    throw new Error(
      "Bu test yalnızca https://erp-test.metaframer.net üzerinde çalışır. FRAPPE_URL değerini kontrol edin.",
    );
  }
  const username = process.env.FRAPPE_TEST_USER;
  const password = process.env.FRAPPE_TEST_PASSWORD;
  const apiKey = process.env.FRAPPE_TEST_API_KEY;
  const apiSecret = process.env.FRAPPE_TEST_API_SECRET;
  if (!((username && password) || (apiKey && apiSecret))) {
    throw new Error(
      "Canlı test çalışmadı: FRAPPE_TEST_USER ve FRAPPE_TEST_PASSWORD veya FRAPPE_TEST_API_KEY ve FRAPPE_TEST_API_SECRET gerekli. Hiçbir kayıt oluşturulmadı.",
    );
  }

  const api = new Frappe(base);
  let credentials: Credentials | undefined;
  let loggedIn = false;
  let creationAttempted = false;
  let removed = false;
  let recordId: string | undefined;
  let cleanupFailure: unknown;
  const code = `MF-SMOKE-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const marker = `Owned by live-smoke ${randomUUID()}`;
  const description = `Geçici API doğrulama kaydı. ${marker}`;

  async function expectAbsent(id: string) {
    try {
      await api.doc(id, credentials!);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return;
      throw error;
    }
    throw new Error(
      "Silinen/geçici kayıt hâlâ mevcut; canlı test başarılı sayılamaz.",
    );
  }

  try {
    if (username && password) {
      const session = await api.login(username, password);
      credentials = { sid: session.sid, csrf: session.csrf };
      loggedIn = true;
      log("Parola girişi, oturum ve CSRF doğrulandı.");
    } else {
      credentials = { token: `${apiKey}:${apiSecret}` };
      await api.user(credentials);
      log(
        "API token kimliği doğrulandı. Parola giriş ekranı bu çalıştırmada test edilmedi.",
      );
    }

    const { data: options } = await api.options(credentials, groupPreference);
    const group = options.itemGroups.includes(groupPreference)
      ? groupPreference
      : options.itemGroups[0];
    const uom = options.uoms[0];
    if (!group || !uom)
      throw new Error(
        "Kullanıcının erişebildiği yaprak Item Group veya aktif UOM bulunamadı. Kayıt oluşturulmadı.",
      );

    await expectAbsent(code);
    creationAttempted = true;
    const created = await api.save(
      {
        code,
        name: code,
        description,
        group,
        uom,
        image: null,
        disabled: false,
        isStockItem: false,
      },
      credentials,
    );
    recordId = created.data.id;
    assert.equal(created.data.code, code);
    assert.equal(created.data.group, group);
    log(`CREATE doğrulandı: ${code}`);

    const firstRead = await api.doc(recordId, credentials);
    assert.equal(firstRead.item_code, code);
    assert.equal(firstRead.description, description);
    assert.ok(firstRead.modified);
    log("Bağımsız GET ile kalıcı kayıt doğrulandı.");

    const updatedName = `${code} updated`;
    await api.save(
      {
        name: updatedName,
        description: `${description} Güncellendi.`,
        modified: String(firstRead.modified),
      },
      credentials,
      recordId,
    );
    const secondRead = await api.doc(recordId, credentials);
    assert.equal(secondRead.item_name, updatedName);
    assert.equal(secondRead.description, `${description} Güncellendi.`);
    assert.notEqual(secondRead.modified, firstRead.modified);
    log(
      "UPDATE ve ardından bağımsız GET ile değişikliğin kaydedildiği doğrulandı.",
    );

    await assert.rejects(
      api.save(
        { name: "Rejected stale write", modified: String(firstRead.modified) },
        credentials,
        recordId,
      ),
      (error) => error instanceof ApiError && error.status === 409,
    );
    const afterConflict = await api.doc(recordId, credentials);
    assert.equal(afterConflict.item_name, updatedName);
    log("Eski modified ile üzerine yazma 409 ile reddedildi; kayıt korundu.");

    await api.remove(recordId, credentials);
    removed = true;
    await expectAbsent(recordId);
    log("DELETE ve ardından GET 404 doğrulandı. Geçici ürün kaldırıldı.");
  } finally {
    if (credentials && creationAttempted && !removed) {
      try {
        const id = recordId || code;
        let owned: Record<string, any> | undefined;
        try {
          owned = await api.doc(id, credentials);
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 404)) throw error;
        }
        if (owned) {
          if (
            !String(owned.description || "").includes(marker) ||
            owned.has_variants
          )
            throw new Error(
              "Temizlik yapılmadı: kayıt sahipliği doğrulanamadı. Başka kayıtlar silinmedi.",
            );
          await api.remove(id, credentials);
          await expectAbsent(id);
          log("Hata sonrası yalnız bu testin oluşturduğu ürün temizlendi.");
        }
      } catch (error) {
        cleanupFailure = error;
        console.error(
          `[LIVE Frappe adapter] Temizlik tamamlanamadı: ${recordId || code}. ${describeError(error)}`,
        );
      }
    }
    if (credentials && loggedIn) {
      try {
        await api.request("/api/method/logout", credentials, {
          method: "POST",
        });
      } catch (error) {
        cleanupFailure ||= error;
        console.error(
          "[LIVE Frappe adapter] Test oturumunun kapandığı doğrulanamadı.",
        );
      }
    }
    if (cleanupFailure)
      throw new Error(
        "Canlı doğrulama temizliği eksik; yukarıdaki geçici kayıt/oturum bilgilerini kontrol edin.",
      );
  }
  log(
    "BAŞARILI: canlı adapter create/read/update/conflict/delete zinciri tamamlandı. Arayüz E2E sonucu değildir.",
  );
}

main().catch((error) => {
  console.error(`[LIVE Frappe adapter] BAŞARISIZ: ${describeError(error)}`);
  process.exitCode = 1;
});
