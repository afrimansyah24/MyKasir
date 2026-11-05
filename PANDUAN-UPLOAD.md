# My Kasir — Frontend untuk GitHub Pages

Isi paket ini **hanya frontend**. Backend (Google Apps Script) & Worker
deploy terpisah — bukan bagian dari repo ini.

## Isi

```
index.html              ← halaman utama
styles.css              ← design system + semua gaya
app.js                  ← seluruh logika aplikasi
config.js               ← WAJIB Diedit: isi workerUrl di sini
manifest.webmanifest    ← manifest PWA (install ke HP/PC)
sw.js                   ← service worker (cache shell, tidak cache API)
icons/                  ← ikon PWA (192, 512, maskable, apple-touch)
```

> `gas/`, `worker/`, `tests/` sengaja **tidak** disertakan — tidak dibutuhkan
> di GitHub Pages. Kalau butuh, ambil dari folder `my-kasir-github/`.

---

## Langkah 1 — Edit `config.js` (WAJIB, SEBELUM UPLOAD)

Buka `config.js`, isi **URL Worker** Anda:

```js
window.MY_KASIR_CONFIG = {
  workerUrl: 'https://my-kasir-api.<subdomain>.workers.dev',
  storeName: 'My Kasir'
};
```

> ⚠️ **Jangan** taruh URL Apps Script (`script.google.com/macros/...`) di sini.
> URL itu hanya boleh ada di Cloudflare Worker (secret `GAS_EXEC_URL`).

---

## Langkah 2 — Upload ke GitHub

1. Buat repository (mis. `my-kasir`).
2. **Add file → Upload files** → drag **seluruh isi folder ini** (bukan foldernya
   sendiri, tapi file-file di dalamnya + folder `icons/`).
3. Commit.

Struktur di repo harus persis seperti ini — `index.html` di **root**:

```
my-kasir/
├── index.html
├── styles.css
├── app.js
├── config.js
├── manifest.webmanifest
├── sw.js
└── icons/
    ├── apple-touch-icon.png
    ├── icon-192.png
    ├── icon-512.png
    └── icon-maskable-512.png
```

---

## Langkah 3 — Aktifkan GitHub Pages

**Settings → Pages → Source: Deploy from a branch → branch `main` / `(root)` → Save**

Tunggu 1–2 menit. URL: `https://username.github.io/my-kasir/`

---

## Troubleshooting cepat

| Gejala | Penyebab & Solusi |
|---|---|
| Halaman putih | `config.js` tidak ter-upload, atau `workerUrl` kosong |
| "Katalog tidak dapat dimuat" | `workerUrl` salah / Worker belum di-deploy |
| 403 Forbidden | `ORIGIN` di Cloudflare ≠ origin GitHub Pages Anda |
| 502 dari Worker | `GAS_EXEC_URL` salah, atau deployment Apps Script belum "Anyone" |
| Perubahan tidak muncul | Hard reload `Ctrl+Shift+R`; DevTools → Application → Service Workers → Unregister → Clear site data |
| PWA tidak bisa install | Site harus HTTPS; `manifest.webmanifest` & `icons/` harus ikut ter-upload |

---

## Ringkasan arsitektur

```
Browser (PWA)
   │ fetch POST {action, args}
   ▼
Cloudflare Worker  ← URL ada di config.js (publik)
   │ POST server-to-server
   ▼
Google Apps Script ← URL hanya di Cloudflare Secret (tidak publik)
   │
   ▼
Google Sheets (database) + Google Drive (foto)
```

Panduan deploy lengkap: `DEPLOY-GUIDE.md`
Penjelasan arsitektur: `ARSITEKTUR-GITHUB-GAS.md`
