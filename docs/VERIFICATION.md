# Doğrulama kaydı

Tarih: **17 Eylül 2026**. Bu kayıt, aşağıdaki sürümleri ve o tarihteki canlı test sonuçlarını kapsar.

## Test edilen dağıtım

| Bileşen | Adres | Sürüm / yayın kanıtı |
|---|---|---|
| Yönetim arayüzü | [GitHub Pages yönetim](https://metafrappe.github.io/metaframer-admin/) | `86ea668` — [başarılı Pages yayını](https://github.com/metafrappe/metaframer-admin/actions/runs/35250688927) |
| Vitrin | [GitHub Pages vitrin](https://metafrappe.github.io/metaframer-storefront/) | `8e9376f` — [başarılı Pages yayını](https://github.com/metafrappe/metaframer-storefront/actions/runs/35250709740) |
| API | [API sağlık kontrolü](https://headless-api.metaframer.net/api/health) | Yönetim deposu `86ea668`, `API_ONLY=1`, bearer oturumu |
| Kaynak ERPNext | [ERP test sitesi](https://erp-test.metaframer.net/) | Ürünler ve kullanıcı izinleri burada saklanır |

GitHub Pages statik arayüzleri sunar. API, gerçek ERPNext kayıtlarını okur ve kullanıcının izinleriyle değiştirir. `Metaframer Demo` grubunda **6 normal ürün, 1 varyant şablonu ve 2 varyant olmak üzere 9 demo kayıt** vardır; bunlar ERPNext'e kaydedilmiş örnek ürünlerdir, tarayıcının uydurduğu API yanıtları değildir.

## Otomatik kontroller

| Kontrol | Yönetim | Vitrin |
|---|---|---|
| TypeScript ve production build | Başarılı | Başarılı |
| Birim / HTTP / adapter testleri | **84/84** | **30/30** |
| Kontrollü Playwright arayüz testleri | **13/13** | **12/12** |
| CI kaydı | [Yönetim Checks](https://github.com/metafrappe/metaframer-admin/actions/runs/35250688885) | [Vitrin Checks](https://github.com/metafrappe/metaframer-storefront/actions/runs/35250709805) |

Kontrollü testler, test doubles / yakalanmış API yanıtlarıyla hata durumlarını ve arayüz davranışlarını sınar. Bu sonuçlar aşağıdaki gerçek Frappe testlerinden ayrıdır. Arayüz testleri 390, 768, 1280 ve 1536 px genişliklerini; giriş, liste, form, boş/hata durumları, varyant sayfalaması, silme onayı ve URL durumunu kapsar. Güvenlik kontrolleri Origin/CSRF, bearer ve cookie modlarının ayrımı, yetki hataları, oturum iptali ve güvenilen proxy sınırlarını kapsar.

İki depodaki OpenAPI 3.1 sözleşmesi eşittir ve şema doğrulamasından geçmiştir. PATCH için gönderilmeyen açıklama, görsel ve iki ürün bayrağının yanlışlıkla sıfırlanması önce testle üretildi; düzeltmeden sonra korunduğu doğrulandı. Oluşturma varsayılanları ayrıca test edildi.

## Canlı HTTP ve gerçek Frappe doğrulaması

API üzerinden çalışan canlı test **10 kontrol grubunu başarıyla tamamladı**. Geçici ürün kodu `MF-SMOKE-HTTP-<zaman>` biçimindeydi; test sonunda silindi. Frappe'a bağımsız `GET /api/resource/Item/:id` çağrıları, değişikliklerin yalnızca API yanıtında kalmadığını doğruladı.

| Kontrol | Gerçek sonuç |
|---|---|
| `GET /api/health` | HTTP 200; servis sağlıklı, katalog yapılandırılmış |
| `GET /api/v1/public/products` | HTTP 200; 9 demo kayıt döndü |
| Kimliksiz `GET /api/v1/products` | HTTP 401; yönetim verisi anonim açılmadı |
| Pages Origin ile CORS ön kontrolü | HTTP 204; izin verilen yöntem ve başlıklar kabul edildi |
| İzin verilmeyen yabancı Origin | HTTP 403; reddedildi |
| Gerçek kullanıcı girişi ve oturum sorgusu | Frappe girişi başarılı; API bearer tokenı ve ayrı CSRF değeriyle kullanıcı doğrulandı |
| Form seçenekleri | `Metaframer Demo` ürün grubu ve kullanılabilir UOM değerleri döndü |
| Ürün oluşturma | HTTP 201; bağımsız Frappe GET ile ad ve açıklama doğrulandı |
| Vitrine yansıma | Yeni ürün public katalog detayında aynı adla göründü |
| Kısmi ürün güncelleme | Yalnızca ad ve `modified` gönderildi; açıklama, görsel, `disabled` ve `isStockItem` korundu; yeni ad bağımsız Frappe GET ile doğrulandı |
| Eski `modified` ile ikinci güncelleme | HTTP 409; eski sürümle yazma reddedildi |
| `DEMO-MF-TRAIL-SHIRT` varyantları | Public varyant uç noktası 2 varyant döndürdü |
| Ürün silme | HTTP 204; bağımsız Frappe GET ve public detay HTTP 404 döndü |
| Çıkış ve eski tokenla tekrar sorgu | Çıkış HTTP 204; önceki tokenla oturum sorgusu HTTP 401; Frappe oturumu iptal edildi |

Sağlık uç noktasının HTTP 200 dönmesi tek başına CRUD başarısı sayılmadı; yukarıdaki oluşturma, güncelleme ve silme işlemleri ayrıca gerçek kayıtlarla denendi.

## Canlı GitHub Pages tarayıcı testi

**Başarılı.** Test, yayınlanan iki Pages adresinde gerçek API ve gerçek Frappe oturumuyla çalıştırıldı; istek yakalama, fixture veya sahte API yanıtı kullanılmadı. Koşu kimliği: `20260917171559078-458cc72b`.

| Tarayıcı akışı | Sonuç |
|---|---|
| Herkese açık katalog | 9 gerçek demo kayıt listelendi |
| Varyant şablonu detayı | 2 varyant gösterildi ve şablon ilişkisi doğrulandı |
| Yönetim girişi | Gerçek kullanıcıyla bearer oturumu açıldı |
| Formdan ürün oluşturma | `MF-SMOKE-PAGES-20260917171559078-458cc72b` oluşturuldu; bağımsız okumayla kayıt doğrulandı |
| Yeni ürünün vitrinde görünmesi | Aynı kayıt ikinci deponun Pages arayüzünde gösterildi |
| Formdan güncelleme ve sayfayı yenileme | Değişiklik yenilemeden sonra korundu ve vitrinde aynı kayıt güncellendi |
| Silme onayı ve kayıt yokluğu | Onay iletişim kutusuyla silindi; yönetim ve public API detayları 404 döndü |
| Çıkış | Tarayıcı tokenı temizlendi; önceki tokenla oturum sorgusu 401 döndü |
| Ürün görselleri | 9 Unsplash görseli gerçek ağdan yüklendi; her birinde `naturalWidth=1200`, başarısız görsel yok |
| Canlı responsive görünüm | 390 px mobil ve 1280 px masaüstü görünümü doğrulandı |

Geçici test ürünü silindi ve yokluğu bağımsız sorguyla doğrulandı. 768 ve 1536 px kontrolleri yukarıdaki kontrollü CI testlerinde geçti; bu iki genişlik için canlı CRUD tarayıcı testi yapıldığı iddia edilmez.

Yerel kanıt özeti: `/tmp/metaframer-pages-live-evidence/summary-20260917171559078-458cc72b.json`. Aynı dizinde katalog, oluşturulan ürün, güncellenen ürün ve görsellerin yüklenmesi beklendikten sonraki ekran görüntüleri bulunur. Bu geçici yerel kanıtlar Git deposuna eklenmemiştir.

## Test hesabı ve kapsam

- Sınırlı test hesabı: `headless-test@metaframer.net`.
- Hesap demo ürün grubundaki ürün CRUD işlemleri ve gerekli grup/UOM okumaları içindir; yönetici yetkisi verilmez. Sunucudaki salt okunur izin sorguları, katalog hesabının demo ürünlerini yalnızca okuyabildiğini ve test kullanıcısının demo grubunda CRUD yetkisi olduğunu doğruladı. `Products`, `Consumable` ve `Raw Material` grupları için bu kullanıcının CRUD izinleri kapalıdır.
- Şifre, API anahtarı ve tokenlar bu depoya veya Pages dosyalarına eklenmemiştir. Kullanıcıya teslim edilen yerel giriş dosyası: `/Users/ahmet/Downloads/metaframer-test-giris-bilgileri.txt`.
- Bu doğrulama ürün listesi, detay, varyant ve ürün CRUD akışını kapsar. Menüdeki 21 uygulama bağlantısı, o uygulamaların tüm işlevlerinin headless arayüzde geliştirildiği veya canlı uçtan uca test edildiği anlamına gelmez.
- Bu çalışma yük/kapasite testi veya bütün tarayıcı ve cihazlarda kapsamlı uyumluluk testi değildir.
