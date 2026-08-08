# San Lucas — Yeni Supabase Projesine Taşıma (Bootstrap) Kılavuzu

Bu klasördeki `migrations/00000000000000_bootstrap.sql` dosyası, mevcut canlı
projenin (`gscuotgjxmcemmkbajtd`) veritabanı şemasını (tablolar, fonksiyonlar,
trigger'lar, RLS policy'leri, storage bucket'ları, realtime yayın üyeliği ve
sadece masa/tables seed verisi) SIFIRDAN yeni bir Supabase projesinde yeniden
kurar.

SQL dosyası **yapamadığı** ve elle yapılması gereken adımlar aşağıda sırayla
listelenmiştir.

## 1. Yeni Supabase projesini oluştur

- [supabase.com/dashboard](https://supabase.com/dashboard) üzerinden yeni,
  **boş** bir proje oluştur (region: mevcut projeyle aynı bölge önerilir).
- Proje oluşturulduktan sonra **Project Settings → General** kısmından yeni
  proje ref'ini (ör. `abcxyz123`) not al.

## 2. Bootstrap SQL dosyasını çalıştır

- Yeni projede **SQL Editor**'ü aç.
- `supabase/migrations/00000000000000_bootstrap.sql` dosyasının tüm içeriğini
  yapıştır ve **Run** ile tek seferde çalıştır.
- Hatasız tamamlandığını doğrula (tablo sayısı: 15, fonksiyon: 7, trigger: 3,
  policy: 58 public + 4 storage).
- Dosya idempotent yazıldığı için gerekirse tekrar çalıştırılabilir.

## 3. `staff-admin` Edge Function'ını deploy et

- Bu fonksiyonun kaynak kodu **mevcut (eski) projede** duruyor — Supabase
  Dashboard veya CLI ile kodunu al:
  ```
  supabase functions download staff-admin --project-ref gscuotgjxmcemmkbajtd
  ```
- Yeni projeye deploy et:
  ```
  supabase functions deploy staff-admin --project-ref <YENİ_PROJE_REF>
  ```
- **Ekstra secret/env değişkeni girmene gerek yok** — `SUPABASE_URL` ve
  `SUPABASE_SERVICE_ROLE_KEY` her Edge Function'a Supabase tarafından otomatik
  enjekte edilir.

## 4. İlk admin hesabını oluştur

1. Uygulamayı yeni projenin URL/anon key'i ile çalıştır (bkz. adım 5) ve
   normal kayıt (sign up) akışıyla bir hesap oluştur.
2. Yeni projenin SQL Editor'ünde, oluşturduğun kullanıcının `auth.users.id`
   (uid) değerini bul:
   ```sql
   select id, email from auth.users order by created_at desc limit 5;
   ```
3. O kullanıcıyı admin yap:
   ```sql
   UPDATE profiles SET role = 'admin' WHERE id = '<UID_BURAYA>';
   ```

## 5. `.env` dosyasını güncelle (masaüstü / Electron uygulaması)

Proje kökündeki `.env` dosyasında şu iki değeri yeni projeninkilerle değiştir
(Project Settings → API):

```
VITE_SUPABASE_URL=<yeni_proje_url>
VITE_SUPABASE_ANON_KEY=<yeni_proje_anon_key>
```

## 6. GitHub Actions repo secret'larını güncelle

Repo → **Settings → Secrets and variables → Actions** kısmında, build/deploy
workflow'larının kullandığı iki secret'ı güncelle:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

(Workflow dosyalarına bakarak secret adlarının tam eşleştiğini doğrula.)

## 7. Mobil uygulamanın ortam değişkenlerini güncelle

Mobil (QR menü / müşteri) uygulamasının kendi `.env` veya yapılandırma
dosyasında da aynı yeni `SUPABASE_URL` / `SUPABASE_ANON_KEY` değerlerini gir
ve mobil build'i yeniden yayınla.

## 8. Ürün / kategori görsellerini tekrar yükle (isteğe bağlı)

Bootstrap SQL'i sadece `product-images` ve `category-images` storage
bucket'larını **boş** olarak oluşturur — içindeki dosyalar taşınmaz. İstersen:

- Eski projedeki görselleri Storage panelinden indir.
- Yeni projede aynı bucket'lara tekrar yükle, ya da
- Ürün/Kategori ekranlarından görselleri tek tek yeniden yükle.

## Notlar

- Bootstrap dosyası **kasıtlı olarak** ürün, sipariş, ödeme gibi iş
  (business) verilerini içermez — sadece `tables` (masalar) seed edilir.
  Bunlar test verisidir.
- `auth.users` tablosuna hiçbir satır eklenmez; kullanıcılar adım 4'teki gibi
  normal kayıt akışıyla oluşturulmalıdır.
- Local sql.js (offline) veritabanı şeması bu dosyadan etkilenmez — o ayrı bir
  konudur (`src/lib/localDb.js`).

---

## Ortam dosyaları (çok işletmeli kurulum)

İki işletme aynı kod tabanını, **ayrı Supabase projelerini** kullanır:

| İşletme | Supabase projesi | Ortam dosyası |
|---|---|---|
| San Lucas | `qparpdpwplsfbktbgozm` | `sanlucas.env` |
| Mars Lounge | `bhxqjrocctiqoaxvooho` | `mars.env` |

Bu dosyalar `.gitignore`'dadır (depoya girmez); her makinede yerel olarak bulunur.

**Kullanım — derlemeden önce hedefi seç:**

```
copy mars.env .env        :: Mars Lounge için
copy sanlucas.env .env    :: San Lucas için
```

Aynı düzen mobil depoda da geçerlidir (`EXPO_PUBLIC_` önekli değişkenlerle).

**Dikkat — CI ile üretilen Windows kurulumu bu dosyaları kullanmaz.** Anahtarlar
derleme anında GitHub Actions secret'larından (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`) okunup paketin içine gömülür. Mars Lounge'ın kendi
kurulum dosyası için ayrı bir depo (ya da ayrı secret setine sahip ayrı bir iş
akışı) gerekir. Aynı şekilde Netlify'da ortam değişkenleri site ayarlarından,
EAS'ta ise `eas.json` veya `eas secret` üzerinden verilir.
