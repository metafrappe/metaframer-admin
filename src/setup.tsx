import { useState } from "react";
import { api, errorMessage } from "./api";
import { ErrorPanel, PageHeader } from "./ui";
export function LocalSetupPage() {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  async function run(action: string) {
    setBusy(action);
    setError("");
    setSteps([]);
    try {
      const result = await api<{ data: { steps: string[] } }>(
        `/local-setup/${action}`,
        { method: "POST", body: "{}" },
      );
      setSteps(result.data.steps);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="YEREL GELİŞTİRME"
        title="Bağlantıyı doğrula"
        description="Bu araç yalnızca yerel geliştirmede açıktır. İşlemler ERP test sitesindeki mevcut yetkilerinizle çalışır."
      />
      <section className="form-panel" style={{ padding: 24, maxWidth: 840 }}>
        <h2>1. Katalog erişimi</h2>
        <p>
          Metaframer Demo ürün grubu ve yalnızca okuma yetkili katalog hesabı
          oluşturulur. Mevcut işletme kullanıcılarının anahtarları
          değiştirilmez.
        </p>
        <button
          className="button primary"
          disabled={!!busy}
          onClick={() => run("catalog")}
        >
          {busy === "catalog"
            ? "Bağlantı kuruluyor…"
            : "Katalog bağlantısını kur"}
        </button>
        <h2 style={{ marginTop: 32 }}>2. Örnek ürünler</h2>
        <p>
          Demo grubuna açıkça adlandırılmış örnek ürünler ve iki varyant
          eklenir. Manzara fotoğrafları örnek görsellerdir; mevcut ürünler
          değiştirilmez.
        </p>
        <button
          className="button secondary"
          disabled={!!busy}
          onClick={() => run("seed")}
        >
          {busy === "seed" ? "Örnekler hazırlanıyor…" : "Demo ürünleri oluştur"}
        </button>
        <h2 style={{ marginTop: 32 }}>3. Gerçek CRUD kontrolü</h2>
        <p>
          Tek bir geçici ürün oluşturulur; Frappe’den ve vitrinden okunur,
          güncellenir ve silinir. Diğer ürünlere dokunulmaz.
        </p>
        <button
          className="button secondary"
          disabled={!!busy}
          onClick={() => run("verify")}
        >
          {busy === "verify"
            ? "Canlı kontrol sürüyor…"
            : "Canlı CRUD testini çalıştır"}
        </button>
        {error && <ErrorPanel message={error} />}{" "}
        {!!steps.length && (
          <div role="status" style={{ marginTop: 24 }}>
            <h3>Doğrulanan sonuçlar</h3>
            <ol>
              {steps.map((step, index) => (
                <li key={index} style={{ marginBottom: 12 }}>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
    </>
  );
}
