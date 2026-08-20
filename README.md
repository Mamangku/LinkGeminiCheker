# Gemini Redeem Checker Bot — Vercel + Supabase

Bot Telegram sederhana untuk menerima:
- satu link,
- banyak link dalam satu pesan,
- file `.txt` berisi link,

lalu membalas ringkasan:

```text
✨ Checking Complete: 1 Links

✅ Valid: 1
🛍 Used: 0
😵 Expired: 0
❌ Invalid: 0
💔 Error: 0
```

## Penting

Checker ini **tidak menekan tombol redeem dan tidak mengklaim offer**.
Ia hanya melakukan HTTP GET, mengikuti redirect yang masih berada pada
host Google yang diizinkan, lalu membaca marker respons.

Karena sebagian status Google baru bisa diketahui setelah login,
`Used` / `Expired` hanya bisa dipastikan bila marker tersebut memang
muncul pada respons yang dapat dibaca server. Versi strict ini **tidak lagi**
menganggap redirect ke login Google sebagai `Valid`. Jika Google meminta login
sebelum mengungkap status offer, hasilnya menjadi `Error` agar tidak menghasilkan
`Valid` palsu.

## 1. Buat Bot Telegram

1. Buka `@BotFather`.
2. Jalankan `/newbot`.
3. Simpan token bot.
4. Jangan kirim token bot ke orang lain.

## 2. Siapkan Supabase

1. Buka project Supabase.
2. Masuk ke **SQL Editor**.
3. Copy seluruh isi `supabase.sql`.
4. Klik **Run**.
5. Ambil:
   - `Project URL`
   - `Secret key` (`sb_secret_...`) **disarankan untuk project baru**, atau legacy `service_role` bila project lama masih menggunakannya.

Masukkan key server tersebut ke variable `SUPABASE_SERVICE_ROLE_KEY`. Nama variable tetap sama agar kode tidak perlu diubah. Jangan taruh key ini di browser/GitHub.

## 3. Upload Project ke GitHub

Upload seluruh isi folder ini ke repository GitHub, lalu Import repository
tersebut di Vercel.

Tidak perlu framework Next.js. Folder `api/` otomatis menjadi Vercel Functions.

## 4. Environment Variables di Vercel

Isi:

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
WEBHOOK_SETUP_KEY=
PUBLIC_BASE_URL=https://NAMA-PROJECT.vercel.app

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

MAX_LINKS_PER_REQUEST=100
CHECK_CONCURRENCY=5
CHECK_TIMEOUT_MS=10000
SAVE_RAW_LINKS=false
ALLOWED_HOST_SUFFIXES=google.com,g.co,goo.gle
```

`TELEGRAM_WEBHOOK_SECRET` dan `WEBHOOK_SETUP_KEY` isi dengan dua teks acak
yang panjang dan berbeda.

Contoh:
```text
TELEGRAM_WEBHOOK_SECRET=GmChk_7fB3_yang_panjang_dan_acak
WEBHOOK_SETUP_KEY=Setup_91Ab_yang_berbeda_dan_acak
```

## 5. Deploy

Setelah env tersimpan, lakukan **Redeploy**.

Cek:
```text
https://NAMA-PROJECT.vercel.app/api/health
```

Harus membalas JSON dengan `"ok": true`.

## 6. Pasang Webhook Telegram

Buka di browser:

```text
https://NAMA-PROJECT.vercel.app/api/setup-webhook?key=ISI_WEBHOOK_SETUP_KEY
```

Jika berhasil:
```json
{
  "ok": true,
  "webhook": "https://NAMA-PROJECT.vercel.app/api/telegram"
}
```

## 7. Tes

Buka bot Telegram dan kirim:

```text
/start
```

Kemudian kirim link atau file `.txt`.

## Database

Tabel yang dibuat memakai prefix `gemini_checker_` supaya tidak bentrok
dengan tabel project lain:

- `gemini_checker_users`
- `gemini_checker_checks`
- `gemini_checker_items`

Default `SAVE_RAW_LINKS=false`, sehingga link asli tidak disimpan di database.
Yang disimpan adalah SHA-256 hash + hasil status. Bila memang ingin menyimpan
link mentah untuk audit, ubah menjadi:

```text
SAVE_RAW_LINKS=true
```

## Batas batch

Default maksimal 100 link per kiriman dengan concurrency 5.
Webhook memberi HTTP 200 ke Telegram segera, lalu proses checker diteruskan
dengan `waitUntil()` Vercel sampai selesai (tetap terikat batas `maxDuration`).

Jika Google mulai rate-limit:
- turunkan `CHECK_CONCURRENCY` ke 2–3;
- naikkan `CHECK_TIMEOUT_MS` bila perlu;
- jangan mengirim batch yang sama berkali-kali dalam waktu singkat.

## Menambah host partner resmi

Demi keamanan, bot menolak host di luar allowlist.
Jika suatu redeem link resmi berasal dari partner lalu redirect ke Google,
tambahkan domain partner tersebut ke:

```text
ALLOWED_HOST_SUFFIXES=google.com,g.co,goo.gle,partner.example
```

Hanya tambahkan domain yang benar-benar dipercaya.

## Kalibrasi status

Bagian marker terdapat di:

```text
lib/checker.js
```

Array:
- `USED_PATTERNS`
- `EXPIRED_PATTERNS`
- `INVALID_PATTERNS`
- `VALID_PATTERNS`

Setelah punya contoh nyata:
- 1 link valid,
- 1 link sudah dipakai,
- 1 link expired,

marker bisa disesuaikan agar hasil checker makin mendekati bot referensi.
