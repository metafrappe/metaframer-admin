# API sözleşmesi — v1

Başarılı yanıtlar `data` alanında, hatalar `application/problem+json` biçimindedir. Kaynak `meta.source=frappe`; mock fallback yoktur.

## Yönetim (aynı origin)

- `POST /api/v1/auth/login` body `{username,password}` → `{data:{user,csrfToken}}` ve şifreli HttpOnly oturum çerezi.
- `GET /api/v1/auth/session` → `{data:{user,csrfToken}}`; yok/bitmiş oturum 401.
- `POST /api/v1/auth/logout` → 204.
- `GET /api/v1/products?q=&group=&status=active|disabled|all&page=1&pageSize=20&sort=name|-modified|code` → ProductList.
- `GET /api/v1/products/:id` → ProductDetail (ürün + varyantlar).
- `POST /api/v1/products` ProductInput → 201 `{data:Product}`.
- `PATCH /api/v1/products/:id` ProductInput alanlarının kısmi hali, zorunlu `modified` → `{data:Product}`. Kod değiştirilemez; çakışma 409.
- `DELETE /api/v1/products/:id` → 204; bağlı kayıt varsa 409/422.
- `GET /api/v1/product-options` → `{data:{itemGroups:string[],uoms:string[],publicGroup:string}}`.
- `GET /api/v1/apps` → mevcut 21 uygulamanın modül bağlantıları ve uygulama durumu; ürünler dışındakiler yerel Frappe ekranına yönlendirir.

Yazma istekleri aynı-origin `Origin` ve oturumun `X-CSRF-Token` başlığını gerektirir (girişte yalnızca Origin). İzinleri Frappe denetler. Sayfa boyutu 1–50. Query uzunluğu 100.

## Sunucular arası katalog

- `GET /api/v1/catalog/products` aynı liste sözleşmesi (yalnızca etkin, satışa açık ve yapılandırılan grupta ürünler).
- `GET /api/v1/catalog/products/:id` aynı detay sözleşmesi ve görünürlük filtresi.
- `Authorization: Bearer <CATALOG_SHARED_SECRET>` zorunludur; yalnızca storefront sunucusu gönderir.
- Vitrin tarayıcısı kendi origin'inde `GET /api/v1/products` ve `GET /api/v1/products/:id` çağırır; storefront sunucusu yukarıdaki katalog yollarına aktarır. Yalnızca bu iki GET yolu açıktır.

Türler `shared/contracts.ts` içindedir. HTTP 401: oturum yok, 403: yetki yok, 404: ürün yok, 409: çakışma, 422: doğrulama, 429: istek sınırı, 502/504: Frappe servis/ağ sorunu, 503: sunucu yapılandırması eksik.

## Varyant sayfalaması

Detay yanıtı ilk 50 varyantı ve `meta.variants={page,pageSize,hasMore}` bilgisini taşır. Devamı `GET /api/v1/products/:id/variants?page=2&pageSize=50` ile alınır; ProductList döner. Sunucular arası eşdeğeri `/api/v1/catalog/products/:id/variants` yoludur. Varyant satırlarının özellikleri ayrı ürün detayından okunabilir. Detay başına varyant belgesi sayısı kadar ağ isteği yapılmaz.
