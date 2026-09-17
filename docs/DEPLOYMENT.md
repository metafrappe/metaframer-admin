# GitHub Pages + Frappe API yayını

## Adresler

| Bileşen | Adres | İşlev |
|---|---|---|
| Yönetim | https://metafrappe.github.io/metaframer-admin/ | Giriş ve ürün CRUD |
| Vitrin | https://metafrappe.github.io/metaframer-storefront/ | Herkese açık demo ürünleri ve varyantları |
| API | https://headless-api.metaframer.net/api/v1 | Frappe oturumu ve ürün adaptörü |
| Frappe | https://erp-test.metaframer.net | Veri ve yetki kaynağı |

Kaynak repolar test yayını için public. `.github/workflows/pages.yml` arayüzü GitHub Pages'a yayımlar; Pages sunucu kodunu çalıştırmaz. API-only Express container mevcut proxy sunucusunda çalışır. Sunucu `.env` dosyaları ve API anahtarları repoya veya Pages artifact'ine alınmaz.

## Arayüz yayını

Her repoda Settings → Pages → Source: GitHub Actions. `main` push'u test, build, artifact ve Pages deploy adımlarını çalıştırır. HashRouter doğrudan ürün bağlantılarının statik barındırmada açılmasını sağlar.

Build ayarları: `VITE_BASE_PATH` ilgili repo alt dizini, `VITE_ROUTER_MODE=hash`, `VITE_API_BASE_URL=https://headless-api.metaframer.net`. Bu değişkenler herkese açıktır; sır içermez.

## API yayını

1. Salt okunur katalog hesabı yalnız `Metaframer Demo` Item grubuna erişmelidir. Yönetim yazmaları giriş yapan kişinin Frappe yetkilerini kullanır. Mevcut kullanıcı şifrelerini değiştirmeyin.
2. Kaynakları doğrulanmış commit'ten `/opt/metaframer-headless-api/releases/<commit>/` altına alın.
3. `deploy/.env.example` dosyasından `deploy/.env.production` oluşturun, izinleri `600` yapın. İki bağımsız rastgele sır ve katalog token'ını sunucu üzerinde doldurun.
4. API container'ını oluşturup başlatın:

```sh
docker compose --env-file deploy/.env.production -f deploy/api.compose.yml config --quiet
docker compose --env-file deploy/.env.production -f deploy/api.compose.yml build
docker compose --env-file deploy/.env.production -f deploy/api.compose.yml up -d --wait
```

Container host ağında yalnız `127.0.0.1:4300` dinler; salt okunur dosya sistemi, 512 MiB bellek sınırı ve sınırlı log boyutu kullanır.

5. `deploy/api-nginx.conf.template` sertifika yollarını doğrulanmış wildcard sertifikasına göre doldurun; mevcut nginx include dizinine ayrı dosya ekleyin. Press'in ürettiği config'e yazmayın. `nginx -t` geçerse reload edin.

`AUTH_MODE=bearer` ile API kısa ömürlü şifreli oturum verir; tarayıcı sekmenin sessionStorage alanında tutar. İsteklerde Frappe oturumu tekrar doğrulanır. Mutasyonlar kesin Origin ve CSRF doğrulamasından geçer. İzin verilen origin `https://metafrappe.github.io`; wildcard CORS yoktur. Production setup uçları kapalıdır.

## Canlı doğrulama

Pages HTML ve asset'leri, HTTPS API sağlık kontrolü, CORS preflight ve girişsiz admin 401 yanıtını kontrol edin. Ardından sınırlı test hesabıyla gerçek giriş, ürün oluşturma, bağımsız Frappe ve vitrin GET, güncelleme, yeniden okuma, çakışma kontrolü, varyantlar ve test kaydını silme akışını çalıştırın. Mobil/tablet/masaüstü ekranları ayrıca kontrol edin.

Sağlık kontrolü ve fixture testleri canlı CRUD kanıtı değildir. Son test sonuçları doğrulama belgesinde tutulur.

## Geri alma

Önceki API release'i aynı `metaframer-headless-api` compose proje adıyla başlatın. Yalnız bu projeyi ve eklenen nginx dosyasını değiştirin; Press/Frappe bench'lerine dokunmayın. Ürün kayıtları ERPNext'te kalır. Pages için önceki doğrulanmış commit'i yeniden yayımlayın.
