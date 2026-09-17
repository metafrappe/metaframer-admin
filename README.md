# Metaframer Admin

ERPNext v16 ürün yönetimi ve iki headless uygulamanın ortak API katmanı. Veri kaynağı `https://erp-test.metaframer.net`; uygulama ayrı ürün veritabanı tutmaz.

## Kapsam

- Frappe kullanıcı adı/parolasıyla gerçek giriş; yerelde şifreli HttpOnly oturum, GitHub Pages yayınında kısa ömürlü şifreli bearer oturumu.
- Ürün listesi, arama, grup/durum filtreleri, sayfalama.
- Ürün oluşturma, güncelleme, silme; Frappe yetkileri ve `modified` çakışma kontrolü.
- Ürün detayı ve sayfalı varyantlar. Varyant şablonları bu arayüzden silinmez.
- Kurulu 21 uygulamanın yerel Frappe ekranlarına bağlantılar. Diğer uygulamaların işlevleri henüz yeni headless ekranlara taşınmadı.
- Mobil kartlar, masaüstü tablo; mobil/tablet/laptop/masaüstü uyumu.
- API sorunu olduğunda hata gösterilir; otomatik mock veri veya sahte başarı yanıtı yoktur.

## İki repo nasıl bağlı?

```text
GitHub Pages yönetim → HTTPS API → giriş yapan kişinin Frappe oturumu → ERPNext Item
GitHub Pages vitrin → HTTPS API /public/products → salt okunur katalog hesabı → ERPNext Item
```

- Yönetim: https://metafrappe.github.io/metaframer-admin/
- Vitrin: https://metafrappe.github.io/metaframer-storefront/
- API: https://headless-api.metaframer.net/api/v1

Pages yalnız arayüz dosyalarını sunar. API ayrı çalışır; Frappe API anahtarları frontend'e girmez. Yönetim oturum token'ı sekmenin `sessionStorage` alanında tutulur; Frappe parolası kaydedilmez. Public repo kaynak kodunun açık olması anlamına gelir, yönetim CRUD uçları giriş gerektirir.


Vitrin: [metafrappe/metaframer-storefront](https://github.com/metafrappe/metaframer-storefront).
API sözleşmesinin asıl kaynağı [docs/openapi.json](docs/openapi.json); TS DTO'ları [shared/contracts.ts](shared/contracts.ts). Vitrindeki kopya aynı API sürümünü kullanır.

## Yerel çalıştırma

Node.js 24 gerekir.

```sh
npm ci
cp .env.example .env
# .env dosyasına SESSION_SECRET ve CATALOG_SHARED_SECRET için
# birbirinden farklı, rastgele en az 32 karakterli değerler koyun.
# CATALOG_SHARED_SECRET vitrindeki değerle aynı olmalı.
npm run dev
```

Yönetim: <http://localhost:4300/login>. `APP_ORIGIN` açtığınız adresle aynı olmalıdır; `localhost` ve `127.0.0.1` farklı origin'lerdir. Giriş ekranı ERP test kullanıcısını Frappe'de doğrular. API anahtarları veya parola `VITE_` değişkenlerine konulmamalıdır. `.env` Git'e alınmaz.

### Test sitesine ilk bağlantı

Mevcut Frappe yönetici hesabının şifresini değiştirmeyin. Tarayıcıdaki giriş ekranında System Manager yetkili bir ERP test hesabıyla giriş yapın.

1. Yerel `.env` içinde `ENABLE_LOCAL_SETUP=1` yapın ve sunucuyu yeniden başlatın.
2. <http://localhost:4300/setup> açın.
3. **Katalog bağlantısını kur:** `Metaframer Catalog Reader` rolü, `catalog-headless@metaframer.net` salt okunur hesabı ve `Metaframer Demo` ürün grubu oluşturulur. Mevcut Item yetkileri korunur; gruba özel kullanıcı kısıtlaması eklenir. Yeni API anahtarı yalnızca `.env` içine, `600` dosya izniyle kaydedilir; HTTP yanıtında görünmez.
4. **Demo ürünleri oluştur:** 6 normal ürün, 1 varyant şablonu, 2 varyant ERPNext'e kaydedilir. Kodlar `DEMO-MF-` ile başlar. Manzara fotoğrafları örnek görsellerdir. Aynı araç mevcut sahipli demo kayıtlarını tekrar oluşturmaz.
5. Vitrini `http://localhost:4301` adresinde başlatın.
6. **Canlı CRUD testini çalıştır:** yönetim HTTP API'sinden geçici ürün oluşturur/günceller/siler; bağımsız Frappe GET ve vitrin GET ile kalıcılığı doğrular. `MF-SMOKE-` kaydı sonunda kaldırılır.
7. Kurulum bitince `ENABLE_LOCAL_SETUP=0` yapın.

Bu araç yalnız `erp-test.metaframer.net` hedefinde ve geliştirme modunda çalışır; production'da endpointler açılmaz. Tekrar çalıştırma mevcut anahtarı döndürmez. Gerçek sitedeki adımlar **geçerli kullanıcıyla çalıştırılmadan tamamlandı sayılmaz**.

İsteğe bağlı CLI eşdeğerleri: `npx tsx scripts/provision-catalog.ts`, `npx tsx scripts/seed-demo.ts`, `npx tsx scripts/live-smoke.ts`. Kimlik bilgileri yalnız süreç ortamından alınır; eksikse hata ile durur. CLI smoke adaptörü doğrular; `/setup` testi yönetim HTTP katmanını da kapsar.

## Güvenlik ve davranış

- `Origin` kontrolü + uygulamaya özgü CSRF token'ı; Frappe'ye ayrı upstream CSRF.
- Salt okunur katalog anahtarı admin yazmaları için kullanılmaz.
- Halka açık katalog yalnız `CATALOG_ITEM_GROUP` grubundaki etkin satış ürünlerini gösterir.
- İzin, zorunlu alan ve bağlı kayıt kuralları Frappe tarafından uygulanır.
- Başarısız/sonucu belirsiz yazma otomatik tekrar edilmez. Yeniden kaydetmeden önce listeyi kontrol edin.
- 2FA/parola yenileme gerektiren giriş bu ilk sürümde desteklenmez; tamamlanmamış giriş oturum kabul edilmez.
- Görseller HTTPS veya Frappe'nin herkese açık `/files/` yolundan olmalıdır. Gizli `/private/files/` görseller yayımlanmaz.
- Dağıtık production kurulumunda rate limit katmanını ortak proxy/Redis üzerinde uygulayın; mevcut limit süreç bazlıdır.

## Testler

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

`tests/*.test.ts` gerçek localhost HTTP sunucularında kontrollü upstream yanıtları kullanır. `tests/ui.spec.ts` arayüz sözleşmesini test eder; canlı Frappe testi değildir. Gerçek CRUD kanıtı ayrıca `/setup` veya canlı smoke çalıştırılarak üretilir. [Doğrulama durumu](docs/VERIFICATION.md).

## Production / GitHub Pages

`.github/workflows/pages.yml` test ve build sonrasında `dist/client` klasörünü GitHub Pages'a yayımlar. Proje alt dizini ve hash tabanlı yönlendirme desteklenir. API için `deploy/api.compose.yml` kullanılır; `AUTH_MODE=bearer`, `API_ONLY=1` ve kesin `ALLOWED_ORIGINS` ayarlanır. Kurulum adımları [yayın belgesindedir](docs/DEPLOYMENT.md).

[Plan](docs/PLAN.md) · [API açıklaması](docs/API.md) · [Kurulu uygulamalar](docs/APPS.md) · [Uzak test yayını](docs/DEPLOYMENT.md)
