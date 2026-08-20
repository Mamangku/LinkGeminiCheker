# Gemini Redeem Checker Bot v3.2

v3.2 menambahkan dukungan resmi untuk dua keluarga URL Google:

- `https://g.co/g1referral/...`
- `https://one.google.com/referral/redeem/...`
- `https://serviceactivation.google.com/subscription/new/<user_session_token>`
- `https://serviceactivation.google.com/subscription/entitle/<user_session_token>`

`serviceactivation` adalah Google Managed Signup / Payments Reseller Subscription.
Token diperlakukan sebagai opaque user-session token; bot tidak mencoba mendekode,
mengubah, atau melakukan redeem.

**Penting:** status `Used` untuk serviceactivation hanya diberikan jika respons
Google sendiri mengandung bukti bahwa subscription/session sudah diaktivasi atau
digunakan. Jika Google meminta login sebelum status dapat diketahui, hasilnya
`Error`, bukan `Invalid` atau `Valid` palsu.

# Gemini Redeem Checker Bot v3.0 — Public Evidence Engine

Telegram bot untuk mengecek link Google AI Pro / Google One referral dengan **Vercel + Supabase saja**.

Tidak ada lagi `GOOGLE_CHECKER_COOKIE_HEADER`, akun checker, password, atau session Google.

Output tetap:

```text
✨ Checking Complete: 5 Links

✅ Valid: 1
🛍 Used: 1
😵 Expired: 1
❌ Invalid: 1
💔 Error: 1
```

## Cara kerja v3

Untuk setiap link, bot melakukan beberapa probe:

1. resolve link `g.co/g1referral/...` dengan redirect manual;
2. buka URL canonical `one.google.com/referral/redeem/...` dengan beberapa request publik;
3. buka halaman yang sama dengan Chromium anonim;
4. browser memblokir navigasi login Google agar dapat menangkap response publik yang muncul **sebelum login**;
5. DOM, redirect, HTTP status, dan response Google diklasifikasikan dengan rule berbasis bukti.

Bot **tidak melakukan redeem**, tidak menekan Subscribe/Get Offer, dan tidak login ke Google.

### Rule utama

- `Valid`: ada offer referral aktif + tombol/action redeem + benefit referral yang sesuai.
- `Used`: Google eksplisit mengatakan already redeemed / limit reached.
- Pesan umum `original offer isn't available` **tidak** dianggap Used secara default karena dapat juga muncul akibat eligibility/region/error Google.
- `Expired`: Google eksplisit mengatakan expired/ended, HTTP 410, atau deadline yang tertulis sudah lewat.
- `Invalid`: format kode salah, not found, invalid code, atau HTTP 404.
- `Error`: Google hanya memberi login gate, eligibility akun/region, anti-bot, rate limit, atau bukti tidak cukup.

`Error` sengaja dipakai daripada memberi hasil palsu.

---

## Update dari v1/v2

### 1. Ganti semua file repository dengan isi ZIP v3

Hapus file lama seperti:

```text
api/session-test.js
lib/browser-checker.js
```

v3 memakai:

```text
api/engine-test.js
lib/public-checker.js
```

### 2. Jalankan migration Supabase

Jika tabel lama sudah ada, cukup jalankan:

```sql
alter table public.gemini_checker_items add column if not exists engine text;
alter table public.gemini_checker_items add column if not exists confidence text;
alter table public.gemini_checker_items add column if not exists evidence jsonb;

NOTIFY pgrst, 'reload schema';
```

Project baru: jalankan seluruh `supabase.sql`.

### 3. Hapus Environment Variable cookie lama

Di Vercel, hapus bila ada:

```text
GOOGLE_CHECKER_COOKIE_HEADER
GOOGLE_CHECKER_COOKIES_B64
CHECKER_ACCOUNT_IS_FRESH
```

Variable yang diperlukan:

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
WEBHOOK_SETUP_KEY=
PUBLIC_BASE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

MAX_LINKS_PER_REQUEST=100
CHECK_CONCURRENCY=4
CHECK_TIMEOUT_MS=18000
CHECK_SETTLE_MS=1400
EXPECTED_REFERRAL_MONTHS=4
AMBIGUOUS_UNAVAILABLE_AS_USED=false
SAVE_RAW_LINKS=false
```

Optional:

```text
CHROMIUM_PACK_URL=
```

Kosongkan agar bot mengambil Chromium 149 pack resmi Sparticuz saat cold start.

### 4. Redeploy Vercel

Setelah deploy, cek:

```text
https://DOMAIN-VERCEL/api/health
```

Harus ada:

```json
{
  "ok": true,
  "engine": "3.1-public-evidence",
  "googleCookieRequired": false
}
```

### 5. Tes Chromium

Buka:

```text
https://DOMAIN-VERCEL/api/engine-test?key=WEBHOOK_SETUP_KEY_KAMU
```

Jika berhasil:

```json
{
  "ok": true,
  "engine": "3.1-public-evidence",
  "reason": "Chromium anonim berhasil dijalankan; cookie/login Google tidak diperlukan"
}
```

### 6. Pasang webhook lagi

```text
https://DOMAIN-VERCEL/api/setup-webhook?key=WEBHOOK_SETUP_KEY_KAMU
```

Kemudian Telegram:

```text
/start
/engine
```

---

## Debug link

Kirim:

```text
/debug https://g.co/g1referral/XXXXXXXX
```

Contoh hasil:

```text
1. ERROR XXXXXXXX · high
   Google mengatakan original offer tidak tersedia, tetapi sinyal ini ambigu; bot tidak menebak
   Signals: original_offer_unavailable, generic_fallback_plan
```

`/debug` tidak menampilkan cookie karena v3 memang tidak memakai cookie.

---

## Tentang akurasi

Google tidak menyediakan public API resmi yang terdokumentasi untuk mengembalikan status referral
`valid / used / expired` tanpa konteks akun. Karena itu **tidak mungkin secara jujur menjamin 100% semua link dapat dibedakan tanpa login**.

v3 dibuat agar perilakunya benar:

- tidak lagi menganggap redirect login = Valid;
- tidak menganggap pesan eligibility akun = Used;
- memakai `Used/Expired/Invalid/Valid` hanya bila ada bukti publik;
- bila Google menyembunyikan statusnya, bot mengembalikan `Error` daripada mengarang hasil.

Jika sebuah link yang status aslinya sudah diketahui masih masuk `Error`, gunakan `/debug` dan lihat `Signals`.
Rule bisa diperbarui saat Google mengubah response publiknya tanpa perlu kembali memakai cookie akun.

## Optional: mode agresif Used

Jika Anda memang ingin perilaku lebih mirip checker yang menganggap `original offer isn't available` sebagai link habis, set:

```text
AMBIGUOUS_UNAVAILABLE_AS_USED=true
```

Mode ini dapat menambah jumlah `Used`, tetapi akurasinya lebih rendah karena Google pernah menampilkan pesan yang sama pada pengguna yang sebenarnya masih memenuhi syarat. Untuk hasil yang paling aman, biarkan `false`.


## v3.1 Chromium fix

- Tidak lagi membuat `browser.createBrowserContext()` pada Vercel/serverless.
- Menggunakan `browser.defaultBrowserContext()` untuk menghindari `Target.createTarget: Target closed`.
- Menggunakan `await puppeteer.defaultArgs(...)` sesuai Puppeteer/Chromium 149.
- `CHROMIUM_PACK_URL` tetap opsional; default mengunduh pack resmi Sparticuz.
