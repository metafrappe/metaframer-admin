# Doğrulama kaydı

17 Eylül 2026

## Geçen kontroller

- TypeScript kontrolü ve production frontend build: başarılı.
- Frappe adapter ve HTTP katmanı: yönetimde 62, vitrinde 24 kontrollü test geçti (86 toplam).
- Arayüz: yönetimde 11, vitrinde 10 kontrollü tarayıcı testi (21 toplam); 390 / 768 / 1280 / 1536 px ekranlar, giriş, liste, form, hata durumları, silme onayı, varyant sayfalaması.
- Yetkisiz istek, Origin/CSRF, şifreli HttpOnly çerez, izin hatası, güncelleme çakışması, şablon silme koruması ve bozuk başarılı upstream yanıtını reddetme.
- Canlı site ping: HTTP 200 `pong`; kimliksiz Item ve oturum uçları HTTP 403. Bu sonuç CRUD başarısı anlamına gelmez.

## Canlı doğrulama

**Henüz geçerli Frappe kullanıcı girişi sağlanmadı.** Dolayısıyla katalog hesabı ve demo kayıtları henüz oluşturulmadı; canlı oluştur/güncelle/sil ve iki repo üzerinden kalıcılık doğrulaması henüz çalıştırılmadı.

`/setup` ekranı ve CLI araçları hazırdır. Kontroller gerçek siteye karşı tamamlandığında tarih, test ürün kodu ve sonuçlar bu dosyada ayrıca kaydedilmelidir. Test doubles ile geçen sonuçlar canlı test gibi raporlanmamalıdır.
