# Yönetici için uzak test yayını

**Durum: yayın hazırlığı. Bu belge yayın yapıldığı anlamına gelmez.**

17 Eylül 2026 kontrolünde iki repo private, `metafrappe` organizasyonu Free ve iki Pages kaydı da yoktu. GitHub Pages statik dosya barındırır; Express sunucusunu çalıştırmaz. Private repo Pages desteği Team ve üzeri plan gerektirir. Kaynak: [GitHub Pages belgeleri](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

## Hedef adresler

| Uygulama | Hazırlanan adres | İşlev |
|---|---|---|
| Yönetim | `https://admin-test.metaframer.net` | Frappe kullanıcı girişi, ürün CRUD |
| Vitrin | `https://catalog-test.metaframer.net` | Herkese açık demo ürünleri ve varyantları |

Kontrolde iki ad da `23.88.127.57` adresine çözüldü. TLS sertifikası, sunucu kapasitesi, kullanılabilir portlar ve mevcut nginx yapılandırması erişim sağlanınca ayrıca doğrulanmalı.

```text
Yönetici → HTTPS nginx → admin:4300 → erp-test.metaframer.net
Ziyaretçi → HTTPS nginx → storefront:4301 → admin:4300 → Frappe katalog okuyucusu
```

Tarayıcı istekleri kendi origin'inde kalır. İki uygulamanın sunucu süreçleri arasında yalnız katalog yetkisi olan bir servis sırrı kullanılır. Frappe parolası ve API anahtarları frontend derlemesine girmez.

## Yayın paketi

`deploy/compose.yml`, nginx ile **aynı Linux sunucusunda** çalışacak iki container tanımlar. Uygulamalar yalnız `127.0.0.1:4300/4301` dinler. Her container için 512 MiB bellek sınırı, salt okunur dosya sistemi, sınırlı log boyutu ve süreç sağlık kontrolü vardır. Bu sınırlar ölçülmüş kapasite garantisi değildir.

Önerilen kaynak yerleşimi:

```text
/opt/metaframer-headless/releases/<release>/
  metaframer-admin/
  metaframer-storefront/
```

İki repoyu doğrulanmış commit'lerden aktarın; GitHub erişim token'ını kaynak arşivine veya imaja eklemeyin. Önce nginx hostunda CPU/RAM/disk ve `4300/4301` portlarını kontrol edin. Press tarafından üretilen dosyaların üzerine yazmayın.

1. Katalog okuyucusunu mevcut yerel `/setup` veya CLI aracıyla oluşturun. Ürün grubu `Metaframer Demo` olmalı. Development sunucusunu internete açmayın.
2. `deploy/.env.example` dosyasını `deploy/.env.production` olarak kopyalayın, `chmod 600` uygulayın. Release etiketini, iki bağımsız rastgele sırrı ve salt okunur katalog token'ını doldurun. Bu dosya Git'e alınmaz.
3. Admin kök dizininde yapılandırmayı değerleri yazdırmadan doğrulayın, sonra oluşturup başlatın:

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.yml config --quiet
docker compose --env-file deploy/.env.production -f deploy/compose.yml build
docker compose --env-file deploy/.env.production -f deploy/compose.yml up -d --wait
```

4. `deploy/nginx.conf.template` içindeki sertifika yollarını doğrulanmış yollarla değiştirin. Dosyayı mevcut nginx'in dahil ettiği ayrı bir konuma koyun. DNS adlarının başka server block'larıyla çakışmadığını kontrol edin. `nginx -t` başarılıysa mevcut nginx yönetim mekanizmasıyla reload edin.
5. HTTPS üzerinden `/login`, vitrin, `/api/health`, girişsiz admin API'sinin 401 vermesi, katalog servis sırrı olmadan admin katalog API'sinin reddedilmesini doğrulayın. Doğrudan portlar dışarıya açık olmamalı.
6. Yönetici Frappe test hesabıyla giriş yapıp ürün oluşturmalı; ayrı Frappe GET ve vitrin GET ile aynı kaydı doğrulayın. Güncelleme → sayfa yenileme → varyantlar → test kaydını silme akışını tamamlayın. 390/768/1280/1536 genişliklerinde kontrol edin.

`/api/health` yalnız uygulama sürecini kontrol eder. Yeşil sağlık kontrolü canlı Frappe giriş/CRUD doğrulaması değildir. Canlı test tamamlanmadan yöneticiye tamamlandı denmemeli.

## Geri alma

Önceki commit'lerin kaynaklarını ve imaj etiketini saklayın. Önceki release dizinindeki compose paketiyle aynı `metaframer-headless` proje adını kullanarak yeniden başlatın. Frappe/Press container'larını veya bench'lerini durdurmayın. Yeni yayını tamamen kaldırmak gerekirse yalnız bu compose projesini kapatın ve yalnız eklenen nginx dosyasını kaldırıp yapılandırmayı doğrulayarak reload edin. ERPNext ürün kayıtları uygulama container'larında tutulmaz.

## Doğrulama durumu

- İki production Docker imajı yerelde oluşturuldu; salt okunur filesystem ve kısıtlı yetkilerle başlatıldı. Yönetim `/login`, vitrin `/` ve iki `/api/health` 200; girişsiz yönetim ürün API'si 401 verdi. Test container'ları sonrasında kaldırıldı.
- 98 adapter/HTTP/yapılandırma testi ve iki production frontend build geçti. Bunlar canlı Frappe CRUD kanıtı değildir.
- `metaframer` doğrudan SSH bağlantısı kimlik doğrulamasında reddedildi. Chrome yeniden açılınca Press Ansible Console üzerinden proxy sunucusuna erişildi.
- Proxy ilk ölçümü: 75 GiB disk, 68 GiB boş; 3810 MiB RAM, 1058 MiB kullanılabilir. Henüz yeni uygulama kurulmadı; yayın öncesi kaynaklar tekrar ölçülmeli.
- Uzak yayın, TLS ve canlı kullanıcı/ürün akışı henüz tamamlanmadı.
