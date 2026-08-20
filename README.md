# Gemini Checker v4.3 — Userbot Bridge

Versi ini **tidak mengecek Google sendiri**.

Alurnya:

1. User mengirim link / file TXT ke bot Anda.
2. Bot menyimpan job ke Supabase.
3. Vercel worker login memakai **akun Telegram biasa khusus checker** melalui MTProto.
4. Akun checker mengirim link/TXT ke `@GoChecker_Bot`.
5. Worker menunggu balasan `Checking Complete`.
6. Hasil Valid / Used / Expired / Invalid / Error dikirim kembali ke user.

## Penting

- Gunakan **akun Telegram khusus checker**, bukan akun utama.
- `TELEGRAM_USER_SESSION` adalah kredensial login penuh. Jangan commit ke GitHub, jangan kirim ke orang lain.
- Akun Telegram biasa yang diotomasi dapat terkena rate limit atau pembatasan Telegram jika dipakai agresif. Gunakan volume wajar dan jangan untuk spam.
- Pastikan penggunaan otomatis terhadap bot checker tujuan diizinkan oleh pemilik/ketentuannya.

---

## 1. Jalankan SQL Supabase

Buka:

**Supabase → SQL Editor → New query**

Copy seluruh isi:

`supabase.sql`

lalu **Run**.

SQL membuat:
- `gemini_checker_users`
- `gemini_checker_jobs`
- `gemini_checker_login_sessions`
- RPC `claim_gemini_checker_job`

Antrean dibuat serial agar balasan GoChecker untuk user berbeda tidak tertukar.

---

## 2. Buat API ID dan API HASH Telegram

Gunakan **akun Telegram biasa khusus checker**.

Buka:

`https://my.telegram.org`

Login dengan nomor akun checker → pilih:

**API development tools**

Buat application.

Anda akan mendapat:
- `api_id`
- `api_hash`

Masukkan ke Vercel:

```text
TELEGRAM_API_ID=...
TELEGRAM_API_HASH=...
```

Jangan membagikan API hash.

---

## 3. Environment Variables Vercel

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
WEBHOOK_SETUP_KEY=
PUBLIC_BASE_URL=https://domain-anda.vercel.app

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

TELEGRAM_API_ID=
TELEGRAM_API_HASH=
TELEGRAM_USER_SESSION=

GOCHECKER_USERNAME=GoChecker_Bot

BRIDGE_WORKER_SECRET=

GOCHECKER_TIMEOUT_MS=120000
GOCHECKER_POLL_MS=1800
MAX_LINKS_PER_REQUEST=100
MAX_TXT_BYTES=1048576
SAVE_BRIDGE_SOURCE_REPLY=false
```

`TELEGRAM_WEBHOOK_SECRET`, `WEBHOOK_SETUP_KEY`, dan
`BRIDGE_WORKER_SECRET` dibuat sendiri dan harus berbeda.

Contoh aman (jangan pakai contoh ini persis):

```text
TELEGRAM_WEBHOOK_SECRET=webhook_xxxxx_2026
WEBHOOK_SETUP_KEY=setup_xxxxx_2026
BRIDGE_WORKER_SECRET=worker_xxxxx_2026
```

---

## 4. Deploy pertama

Upload semua file ke GitHub → Import / Deploy di Vercel.

Setelah deploy, cek:

```text
https://DOMAIN/api/health
```

Sebelum membuat user session:

```json
{
  "ok": true,
  "engine": "4.0-userbot-bridge",
  "userbotSessionConfigured": false
}
```

---

## 5. Buat TELEGRAM_USER_SESSION tanpa PowerShell

Setelah `TELEGRAM_API_ID` dan `TELEGRAM_API_HASH` ada di Vercel,
buka:

```text
https://DOMAIN/setup-userbot.html
```

Isi:
- `WEBHOOK_SETUP_KEY`
- nomor Telegram checker dalam format `+62...`

Klik **Kirim kode Telegram**.

Masukkan kode Telegram.

Jika akun memakai Two-Step Verification, halaman akan meminta password 2FA.

Setelah sukses akan muncul `TELEGRAM_USER_SESSION`.

Copy nilainya ke:

**Vercel → Settings → Environment Variables**

```text
TELEGRAM_USER_SESSION=...
```

Save → **Redeploy**.

Session string jangan pernah dimasukkan ke GitHub.

---

## 6. Tes akun checker

Buka:

```text
https://DOMAIN/api/userbot-test?key=WEBHOOK_SETUP_KEY_ANDA
```

Target:

```json
{
  "ok": true,
  "engine": "4.0-userbot-bridge",
  "target": {
    "username": "@GoChecker_Bot",
    "resolved": true
  }
}
```

---

## 7. Tes GoChecker

Buka:

```text
https://DOMAIN/api/gochecker-test?key=WEBHOOK_SETUP_KEY_ANDA
```

Endpoint ini akan mengirim `/start` dari akun Telegram checker ke
`@GoChecker_Bot` dan menunggu balasan.

Target:

```json
{
  "ok": true,
  "target": "@GoChecker_Bot"
}
```

Jika ini gagal, jangan tes link dulu.

---

## 8. Pasang webhook bot Anda

Buka:

```text
https://DOMAIN/api/setup-webhook?key=WEBHOOK_SETUP_KEY_ANDA
```

Target:

```json
{
  "ok": true,
  "webhook": "https://DOMAIN/api/telegram"
}
```

---

## 9. Tes di Telegram

Kirim ke bot Anda:

```text
/start
```

Lalu satu link.

Bot akan menampilkan:

```text
🔎 Checking 1 Links...
Permintaan dimasukkan ke antrean checker.
```

Akun checker akan mengirim link ke GoChecker.

Setelah GoChecker membalas, user menerima:

```text
✨ Checking Complete: 1 Links

✅ Valid: 0
🛍 Used: 1
😵 Expired: 0
❌ Invalid: 0
💔 Error: 0
```

Untuk melihat balasan sumber GoChecker pada pengujian, kirim:

```text
/debug LINK
```

Debug hanya dikirim ke user yang meminta. Secara default source reply tidak
disimpan di database.

---

## 10. TXT / banyak link

Bot mengekstrak link dari TXT.

- Input yang berasal dari file `.txt` tetap dikirim ke GoChecker sebagai document `.txt`.
- Input teks pendek dikirim sebagai pesan biasa.
- Input teks yang terlalu panjang otomatis dibuat menjadi `.txt` oleh Vercel.

Setelah job selesai, `input_payload` di Supabase dihapus (`NULL`) agar token
redeem tidak disimpan lebih lama dari yang diperlukan.

---

## Jika job tertahan di queue

Buka:

```text
https://DOMAIN/api/kick-worker?key=WEBHOOK_SETUP_KEY_ANDA
```

Worker akan mencoba mengambil job berikutnya.

Sistem sengaja menjalankan hanya **1 job GoChecker pada satu waktu** agar hasil
user A dan user B tidak tertukar.

## Catatan worker Vercel

`/api/bridge-worker` memberi HTTP 202 segera lalu menjalankan pekerjaan dengan
`waitUntil()`. Claim job di Supabase memakai advisory lock dan hanya mengizinkan
satu job `processing` dalam satu waktu. Ini sengaja untuk mencegah balasan
GoChecker milik dua user tertukar.


## Jika setup-userbot menampilkan "A server error occurred"

v4.1 memperbaiki error handler halaman login. Sebelum login, buka:

```text
https://DOMAIN/api/config-test?key=WEBHOOK_SETUP_KEY_ANDA
```

Semua check harus `true`.

Contoh:

```json
{
  "ok": true,
  "checks": {
    "TELEGRAM_API_ID": true,
    "TELEGRAM_API_HASH": true,
    "SUPABASE_URL": true,
    "SUPABASE_SERVICE_ROLE_KEY": true,
    "PUBLIC_BASE_URL": true,
    "BRIDGE_WORKER_SECRET": true
  },
  "missingOrInvalid": []
}
```

Setelah mengubah Environment Variables Vercel, selalu lakukan Redeploy karena
deployment yang sudah berjalan tidak otomatis memperoleh nilai environment baru.


## Diagnostik v4.2

v4.2 memuat `teleproto` secara lazy/dinamis agar kegagalan import di Vercel
tidak lagi berubah menjadi `FUNCTION_INVOCATION_FAILED` tanpa penjelasan.

Urutan tes:

```text
/api/config-test?key=WEBHOOK_SETUP_KEY
/api/runtime-test?key=WEBHOOK_SETUP_KEY
/setup-userbot.html
```

`runtime-test` harus memberikan:

```json
{
  "ok": true,
  "teleprotoImport": true,
  "exports": {
    "TelegramClient": true,
    "Api": true,
    "StringSession": true
  }
}
```

Jika gagal, JSON akan menampilkan error runtime MTProto yang sebenarnya.


## Runtime v4.3

v4.3 menyamakan runtime project dengan Vercel:

```json
"engines": {
  "node": "24.x"
}
```

Jika Vercel Project Settings juga memakai Node.js 24.x, warning bahwa
`package.json` mengoverride Node 24.x dengan Node 22.x tidak akan muncul lagi.

Jika sebelumnya ada Environment Variable:

```text
AWS_LAMBDA_JS_RUNTIME=nodejs22.x
```

hapus variable tersebut agar tidak menimbulkan konfigurasi runtime yang
membingungkan. Vercel Functions akan menggunakan Node 24.x dari project/package.
