# 🛠️ Fatih Arıza Takip

Okullar için arıza bildirim ve takip uygulaması. Öğretmenler arıza bildirir, sorumlu (yönetici) tüm arızaları görüp durumlandırır ve işlem raporu alır.

**Stack:** Cloudflare Workers + D1 (SQLite) + tek dosyalık PWA frontend (`public/index.html`).

## Özellikler

- 🏫 **Okul oluşturma:** Sorumlu okul adıyla kayıt açar, 2 kod üretilir:
  - Öğretmen katılım kodu (öğretmenlere dağıtılır)
  - Yönetici kodu (sorumluda kalır, kimseyle paylaşılmaz)
- 👩‍🏫 **Öğretmen paneli:** Kod + Ad Soyad ile giriş, arıza bildir (derslik/konum, kategori, açıklama), sadece kendi arızalarını görür.
- 🧑‍💼 **Sorumlu paneli:** Tüm arızaları görür, durum etiketler (`bekliyor` / `inceleniyor` / `çözüldü`), istatistik kartları, çözülen kaydı silebilir.
- 📊 **İşlem raporu:** Tarih aralıklı log raporu (oluşturma, durum değişikliği, silme), yazdırma ve CSV indirme desteği.
- 📱 **PWA:** `manifest.webmanifest` + `sw.js` ile telefona kurulabilir, tam ekran desteği, 5 sn'de bir otomatik yenileme.

## Proje Yapısı

```
├── src/index.ts        # Worker: API + statik dosya sunumu
├── public/
│   ├── index.html      # Tüm arayüz (tek sayfa uygulama)
│   ├── manifest.webmanifest
│   ├── sw.js
│   └── icons/
├── schema.sql          # D1 şeması (schools, faults, logs)
└── wrangler.toml       # Worker + D1 bağlantı ayarı
```

## API

| Metot | Endpoint | Açıklama |
|---|---|---|
| POST | `/api/schools` | Okul oluştur `{name}` → öğretmen + yönetici kodu döner |
| POST | `/api/join` | Kodla okula bağlan `{code}` → rol + okul bilgisi |
| GET | `/api/faults?schoolId=&code=&teacherToken=&teacherName=` | Arızaları listele (öğretmen: sadece kendininki) |
| POST | `/api/faults` | Arıza bildir (öğretmen) |
| PATCH | `/api/faults/:id` | Durum değiştir (sadece sorumlu) |
| DELETE | `/api/faults/:id?schoolId=&code=` | Arıza sil (sadece sorumlu) |
| GET | `/api/report?schoolId=&code=&from=YYYY-MM-DD&to=YYYY-MM-DD` | İşlem raporu (sadece sorumlu) |

## Kurulum

Gereksinim: Node.js 18+ ve `wrangler` (devDependency olarak kurulu).

```bash
npm install
```

### Veritabanı (D1)

Sıfırdan kurulumda:

```bash
npm run db:create   # wrangler d1 create fatih-ariza-db
npm run db:migrate  # wrangler d1 execute fatih-ariza-db --file=./schema.sql
```

Çıkan `database_id` değerini `wrangler.toml` içindeki `[[d1_databases]]` bölümüne yazın.

### Geliştirme

```bash
npm run dev
```

### Yayınlama

```bash
npm run deploy
```

## Kullanım Akışı

1. Sorumlu → **Okul Oluştur** → öğretmen kodunu öğretmenlere verir.
2. Öğretmen → **Öğretmen Girişi** (kod + Ad Soyad) → **Arıza Bildir**.
3. Sorumlu → **Sorumlu Girişi** (yönetici kodu) → **Arıza Paneli** → durumu günceller.
4. Sorumlu → **İşlem Raporları** → tarih aralığı seç → yazdır / CSV indir.

## Notlar

- Kodlar 6 karakterdir (karışık okunabilir harf/rakam: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).
- Öğretmen gizliliği: öğretmenler birbirinin arızasını göremez; eşleştirme `teacher_token` + `teacher_name` ile yapılır.
- Rapor aralığı en fazla 1 yıl olabilir.
- Oturum `localStorage` anahtarı: `fatih_ariza_session`.
