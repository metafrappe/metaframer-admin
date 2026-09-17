# API sözleşmesi — v1

ERPNext veri kaynağıdır. Başarılı yanıtlar `data`, liste ve detay kaynağı `meta.source="frappe"`; hatalar `application/problem+json` biçimindedir. Servis hatasında mock veriye geçilmez.

## GitHub Pages ve API bağlantısı

| Bileşen | Adres | Görev |
|---|---|---|
| Yönetim arayüzü | `https://metafrappe.github.io/metaframer-admin/` | Giriş, ürün listesi ve CRUD |
| Vitrin | `https://metafrappe.github.io/metaframer-storefront/` | Herkese açık ürün ve varyant görüntüleme |
| API | `https://headless-api.metaframer.net` | Frappe oturumu, izin denetimi ve katalog filtresi |
| Frappe | `https://erp-test.metaframer.net` | Ürün kayıtları, kullanıcılar ve kaynak izinleri |

Pages yalnızca statik arayüzleri sunar. `API_ONLY=1` ile API sunucusu HTML/SPA sunmaz; API dışındaki yollar 404 döner. Frappe API anahtarı, katalog sırrı ve oturum şifreleme anahtarı Pages derlemesine veya tarayıcıya verilmez. Bu dosya ile `openapi.json` aynı API'yi tanımlar; storefront deposundaki OpenAPI dosyası bu sözleşmenin kopyasıdır.

### CORS

- İzin verilen kaynaklar `APP_ORIGIN` ve virgülle ayrılmış `ALLOWED_ORIGINS` değerlerinin tam eşleşmesidir. Pages kaynağı `https://metafrappe.github.io` şeklindedir; repo yolu origin'in parçası değildir.
- Wildcard, alt alan adı eşlemesi ve `Origin: null` desteklenmez. İzin verilmeyen bir Origin içeren API isteği 403 döner.
- Ön kontrol: `OPTIONS /api/...`, izin verilen `Origin`, `Access-Control-Request-Method` ve isteğe bağlı `Access-Control-Request-Headers`. Yöntemler `GET, POST, PATCH, DELETE, OPTIONS`; başlıklar `Content-Type, Authorization, X-CSRF-Token` ile sınırlıdır. Geçerli ön kontrol 204; geçersiz yöntem/başlık 403 döner.
- Yanıt izin verilen kaynağı `Access-Control-Allow-Origin` olarak yansıtır, `Vary: Origin` ve `Access-Control-Expose-Headers: X-Request-ID` kullanır. Bearer modunda `Access-Control-Allow-Credentials` gönderilmez. Cookie modunda `true` gönderilir.
- Tarayıcı Origin başlığını kendisi ekler. Sunucular arası okumalar Origin olmadan yapılabilir; yönetim yazmaları ve giriş için izin verilen Origin zorunludur. CORS kimlik doğrulamanın yerine geçmez.

## Yönetim oturumu

Üretimde Pages bağlantısı `AUTH_MODE=bearer` kullanır; üçüncü taraf cookie gerektirmez. `AUTH_MODE` verilmezse yerel/aynı origin kullanım için `cookie` modu etkin olur. Bir dağıtım seçilen modu kabul eder; bearer modunda cookie fallback yoktur.

| İstek | Başarılı yanıt |
|---|---|
| `POST /api/v1/auth/login` — `{username,password}` | Bearer: `{data:{user,csrfToken,accessToken}}`; cookie: `{data:{user,csrfToken}}` ve `HttpOnly; SameSite=Lax` şifreli cookie (`Secure` üretimde) |
| `GET /api/v1/auth/session` | `{data:{user,csrfToken}}`; mevcut oturumu doğrular, yeni token üretmez |
| `POST /api/v1/auth/logout` | Frappe oturumu başarıyla kapandığında 204 |

Bearer `accessToken` imzalı/şifreli opaque oturumdur; JWT değildir. Frappe `sid` ve upstream CSRF bilgilerini açık olarak içermez. En fazla 8 saat geçerlidir; Frappe oturumu daha önce bitebilir. Her korumalı istekte Frappe kullanıcı kimliği yeniden doğrulanır.

- Bearer çağrıları: `Authorization: Bearer <accessToken>` ve `credentials: "omit"`. Token yalnızca bu başlıktan alınır; query string kabul edilmez. Arayüz tokenı sekmeye ait `sessionStorage` içinde saklar.
- Giriş: izin verilen Origin zorunlu; henüz yerel CSRF gerekmez.
- Diğer yönetim yazmaları: izin verilen Origin **ve** giriş/oturum yanıtındaki `X-CSRF-Token` zorunlu. Bu değer Frappe'ın upstream CSRF değeri değildir.
- Kayıt yetkisi Frappe kullanıcısına aittir. Katalog servis hesabı yönetim yetkilerini genişletmek için kullanılmaz.
- Çıkışın 204 yanıtı upstream oturumun kapandığını belirtir. Ağ/servis hatasında bu garanti verilmez: yerel tokenı silmek, kopyası bulunan stateless tokenı tek başına iptal etmez. Arayüz tokenı 401 yanıtında ve yerel çıkışta temizler.

## Ürün yönetimi

Aşağıdaki yollar yönetim oturumu gerektirir. Ürün ID'si URL bileşeni olarak kodlanmalıdır.

| Yöntem ve yol | Yanıt / davranış |
|---|---|
| `GET /api/v1/products` | `ProductList`; kullanıcının Frappe izinleri uygulanır |
| `GET /api/v1/products/:id` | `ProductDetail`: ürün, ilk varyant sayfası ve sayfalama bilgisi |
| `GET /api/v1/products/:id/variants` | `ProductList`: istenen varyant sayfası; şablon görünürlüğü kontrol edilir |
| `POST /api/v1/products` | `ProductInput` → 201 `{data:Product}`, `Location` başlığı |
| `PATCH /api/v1/products/:id` | Kısmi `ProductInput` + zorunlu son okunan `modified` → `{data:Product}`; eski sürüm 409 |
| `DELETE /api/v1/products/:id` | Başarı 204; varyant şablonu silinemez; bağlı kayıt engeli 409/422 |
| `GET /api/v1/product-options` | `{data:{itemGroups:string[],uoms:string[],publicGroup:string}}`; yaprak gruplar ve etkin UOM'lar |
| `GET /api/v1/apps` | `{data:[{id,name,url,mode:"native"}]}`; yapılandırılmış 21 uygulama bağlantısı |

`/apps` çalışma durumu veya kurulum sağlık kontrolü yapmaz. Ürün dışındaki uygulamalar bu aşamada kendi Frappe ekranına yönlendirilir.

`ProductInput`: `code`, `name`, `group`, `uom` zorunlu; `description`, `image`, `disabled`, `isStockItem` isteğe bağlıdır. Oluşturmada bu dört alanın varsayılanları sırasıyla `""`, `null`, `false`, `true` olur. PATCH'te gönderilmeyen alanların mevcut değerleri korunur. Güncelleme Item kodunu yeniden adlandıramaz. İzin aşan alanlar (`ignore_permissions` gibi) ve bilinmeyen gövde alanları reddedilir.

Liste/varyant sorguları:

| Parametre | Sınır / varsayılan |
|---|---|
| `q` | En fazla 100 karakter; boş |
| `group` | En fazla 140 karakter; boş |
| `status` | `all`, `active`, `disabled`; yönetimde `all` |
| `page` | 1–10000; 1 |
| `pageSize` | 1–50; 20 |
| `sort` | `name`, `-modified`, `code`; `-modified` |

Bilinmeyen sorgu alanları ve sınırı aşan sayfalama 422 döner. Detay yanıtında ilk **50** varyant ve `meta.variants={page:1,pageSize:50,hasMore}` bulunur. Devamı `/variants?page=2&pageSize=50` ile okunur. Liste/varyant satırlarında `attributes` boş olabilir; özellikler ilgili ürün detayından okunur. Her varyant için ayrı belge isteği yapılmaz.

## Herkese açık Pages kataloğu

Bu GET yollarında tarayıcı kimlik bilgisi, cookie veya paylaşılan sır göndermez:

- `GET /api/v1/public/products` → `ProductList`.
- `GET /api/v1/public/products/:id` → `ProductDetail`.
- `GET /api/v1/public/products/:id/variants` → `ProductList`.

API, sunucuda saklanan katalog tokenını kullanır. Yalnızca `CATALOG_ITEM_GROUP` grubunda, etkin (`disabled=0`) ve satışa açık (`is_sales_item=1`) ürünler görünür; görünmeyen ürün/şablon detayı 404 döner. Tarayıcı grup filtresi bu kapsamı genişletemez. Liste için farklı bir `group` değeri boş sonuç döndürür.

Liste/varyant sorguları yukarıdaki sınırları kullanır; burada `status` yalnızca `active` olabilir ve varsayılandır. `all` veya `disabled` 422 döner. Public POST/PATCH/DELETE yolları yoktur. Katalog tokenı/grubu yoksa 503 döner; örnek veri uydurulmaz.

## İsteğe bağlı sunucular arası katalog

Yerel storefront sunucusu için mevcut proxy sözleşmesi korunur:

- `GET /api/v1/catalog/products`, `/:id`, `/:id/variants` aynı ürün yanıtlarını ve sabit katalog görünürlüğünü kullanır.
- `Authorization: Bearer <CATALOG_SHARED_SECRET>` zorunludur. Bu değer yönetim oturum tokenından farklıdır ve tarayıcıya verilmez.
- Bu uçların sorgu şeması yönetimle aynı `status` değerlerini kabul etse de katalog görünürlüğü her zaman yalnızca etkin, satışa açık ve yapılandırılan gruptaki ürünlere zorlanır.
- Yerel storefront tarayıcısı kendi sunucusunda `GET /api/v1/products`, `/:id`, `/:id/variants` çağırır. Proxy bunları yukarıdaki katalog yollarına aktarır. Pages dağıtımı ise doğrudan public API yollarını kullanır.

## Hatalar ve operasyonel sınırlar

`GET /api/health` kimlik doğrulama gerektirmez ve `{status:"ok",service:"metaframer-admin",catalogConfigured:boolean}` döner. Bu, anlık Frappe erişimini veya canlı CRUD testini doğrulamaz.

| HTTP | Anlam |
|---|---|
| 400 | Geçersiz JSON |
| 401 | Oturum/token yok, geçersiz veya süresi bitmiş |
| 403 | Origin, CSRF veya Frappe izni reddedildi |
| 404 | Yol/ürün yok veya katalogda görünmüyor |
| 409 | Kayıt/sürüm çakışması veya bağlı kayıt |
| 422 | Girdi/sorgu doğrulaması |
| 429 | İstek sınırı |
| 500 | Beklenmeyen sunucu hatası |
| 502 / 504 | Frappe yanıtı/ağ sorunu veya timeout |
| 503 | Gerekli sunucu yapılandırması eksik |

Yanıtlar `Cache-Control: no-store` ve `X-Request-ID` taşır. Ortak limit dakikada 180 API isteği; giriş limiti 15 dakikada 15 denemedir (istemci IP'sine göre, yalnızca açıkça güvenilen proxy üzerinden). Üretimde yerel setup/seed/verify yolları kapalıdır. Genel Frappe resource/method proxy'si yoktur.

Türler `shared/contracts.ts`, makine tarafından okunabilen sözleşme [openapi.json](./openapi.json) içindedir.
