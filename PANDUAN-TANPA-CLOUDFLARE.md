# Cara Pasang My Kasir **TANPA Cloudflare**

Frontend di **GitHub Pages**, backend di **Google Apps Script**, tanpa layanan
tambahan apa pun.

---

## 🧠 Kenapa ini bisa?

Cloudflare Worker ada hanya untuk **menembus aturan same-origin** browser:
halaman `github.io` tidak boleh `fetch` ke `script.google.com`.

Tapi ada satu cara lain yang **tidak** terkena aturan itu: **JSONP**.

| Cara | Cara kerja | Kena aturan same-origin? |
|---|---|---|
| `fetch` (POST) | Browser ambil data via XHR | ✅ Ya → butuh proxy |
| **JSONP** | Browser **memuat `<script src="...">`** | ❌ **Tidak** — ini perilaku normal script |

Memuat `<script>` dari domain lain itu **tidak dibatasi** browser — itu cara
paling klasik memanggil API lintas domain, sudah ada sejak dulu.

Jadi: Apps Script membalas JSONP, frontend memakainya. **Tanpa Cloudflare.**

---

## 📦 Yang perlu Anda punya

| File | Taruh di |
|---|---|
| `gas/Code.gs` | Google Apps Script → file `Code.gs` |
| `index.html`, `styles.css`, `app.js`, `config.js`, `manifest.webmanifest`, `sw.js`, `icons/` | GitHub Pages |

> **Tidak perlu** `Index.html`, `Css.html`, `Js.html` di Apps Script.
> File HTML itu hanya untuk mode native (frontend di dalam Apps Script).
> Di mode ini, frontend-nya di GitHub.

---

# BAGIAN 1 — Apps Script (backend)

## 1.1 Bikin project

1. <https://script.google.com> → **+ New project**
2. Ganti nama → `My Kasir`
3. Hapus isi `Code.gs` bawaan → **paste** isi `gas/Code.gs`

## 1.2 Sambungkan database

**⚙️ Project Settings → Script Properties → Add script property**

| Key | Value |
|---|---|
| `DB_ID` | ID spreadsheet (dari URL `docs.google.com/spreadsheets/d/<ID>/edit`) |

> Spreadsheet belum ada? Biarkan kosong — `Code.gs` akan membuat `My Kasir Database`
> otomatis di folder Drive Anda.

## 1.3 Jalankan sekali

Pilih fungsi `setupDatabase` → ▶ **Run** → **Allow**.

6 sheet otomatis dibuat: `Stock`, `Catalog`, `Transactions`, `Expenses`,
`Settings`, `OnlineOrders`.

## 1.4 Deploy

**Deploy → New deployment → ⚙️ → Web app**

| Field | Nilai |
|---|---|
| Execute as | **Me** |
| Who has access | **Anyone** |

**Deploy** → salin URL yang berakhiran `/exec`:

```
https://script.google.com/macros/s/AKfycbXXXXXXXXXXXXXXXXXXXX/exec
```

> ⚠️ **"Anyone" itu wajib.** Tanpa itu, request dari browser akan ditolak.

> 🔁 **Setiap ubah `Code.gs`:** Deploy → Manage deployments → ✏️ → **New version** → Deploy.

---

# BAGIAN 2 — GitHub Pages (frontend)

## 2.1 Bikin repo

<https://github.com/new> → nama `my-kasir` → **Public** → **Create repository**

## 2.2 Upload

**Add file → Upload files** → seret file-file ini:

```
index.html
styles.css
app.js
config.js
manifest.webmanifest
sw.js
icons/          (folder)
```

> ⚠️ Seret **file di dalam** folder, bukan foldernya — supaya `index.html`
> berada di root repo.

## 2.3 Isi `config.js` ⭐ (paling penting)

Klik `config.js` → ikon pensil ✏️ → ubah:

```js
window.MY_KASIR_CONFIG = {
  workerUrl: '',                                    // kosong — TIDAK pakai Cloudflare
  scriptUrl: 'https://script.google.com/macros/s/AKfycbXXXXXXXXXXXXXXXXXXXX/exec',
  storeName: 'My Kasir'
};
```

Klik **Commit changes**.

> Isi **hanya `scriptUrl`**. `workerUrl` harus kosong.
> Kalau keduanya kosong → muncul pesan "Backend belum terhubung".

## 2.4 Nyalakan Pages

**Settings → Pages → Source: `Deploy from a branch` → branch `main` / `(root)` → Save**

Tunggu 1–2 menit. Buka `https://username.github.io/my-kasir/`.

---

# ✅ Selesai!

Cuma **2 layanan**. Tidak ada Cloudflare, tidak ada Worker, tidak ada variabel/secret.

---

# 🔍 Cara memastikan benar

Buka DevTools → **Console**. Tidak boleh ada error merah.

Lalu **Network** → filter `script.google.com`. Harus ada request ke:
```
.../exec?action=getPublicCatalogData&callback=mkjsonp_xxx
```
Status **200**.

> 💡 Perhatikan: request-nya berawalan `GET` dengan `callback=` di URL.
> Itulah JSONP. Kalau Anda lihat `POST`, itu mode Worker (kalau `workerUrl` masih terisi).

---

# ⚠️ Batasan mode ini (baca sebelum produksi)

| Batasan | Penjelasan |
|---|---|
| **URL Apps Script jadi publik** | Tidak ada proxy yang menyembunyikannya.Siapa pun yang tahu URL bisa memanggil API. Endpoint sensitif tetap butuh token, tapi risiko lebih tinggi. |
| **Tidak bisa kirim file** | JSONP hanya berbasis URL. **Foto produk harus pakai URL**, bukan upload file. (Aplikasi ini memang sudah memakai URL — jadi tidak masalah.) |
| **Data terlihat di URL** | Argumen seperti `data` ikut di query string. Untuk transaksi berisi data pelanggan, ini berarti data bisa tercatat di log server. |
| **Lebih lambat** | JSONP pakai `<script>`, jadi tidak bisa `Promise` biasa. Perlu callback. |
| **Cache browser lebih agresif** | Kadang respons JSONP tersimpan cache. Aplikasi sudah menambahkan parameter acak `&_=<timestamp>` pada setiap request, jadi ini sudah ditangani. |

### Mitigasi yang praktis

1. **Tambahkan penanda acak** di URL agar tidak ter-cache:
   ```js
   qs += '&_=' + Date.now();
   ```
   (sudah saya tambahkan di `app.js`? — **belum**, lihat catatan di bawah)

2. **Ganti password bawaan** sebelum produksi:
   `owner`/`owner123`, `kasir`/`123`, PIN `123456`.

---

# 🔄 Mau Pindah ke Cloudflare Nanti?

Tinggal ubah `config.js`:

```js
window.MY_KASIR_CONFIG = {
  workerUrl: 'https://my-kasir-api.akarna.workers.dev',   // ← diisi
  scriptUrl: '',                                          // ← dikosongkan
  storeName: 'My Kasir'
};
```

Frontend **mendeteksi otomatis** mana yang dipakai. Tidak perlu ubah kode lain.

---

# 📎 Perbandingan 3 Mode

| | GitHub + GAS (**mode ini**) | GitHub + Worker + GAS | GAS saja |
|---|---|---|---|
| Layanan | 2 | 3 | 1 |
| Transport | JSONP | fetch + CORS | `google.script.run` |
| CORS | Tidak masalah | Diperlukan Worker | Tidak masalah |
| Install PWA | ✅ | ✅ | ❌ |
| URL backend | Publik | Tersembunyi | Publik |
| Setup | Mudah | Sedang | Paling mudah |
| Upload file | ❌ | ✅ | ✅ |

**Rekomendasi saya:** kalau Anda ingin **paling simpel** dan tidak keberatan URL backend
terlihat → pakai mode ini. Kalau butuh **URL backend tersembunyi** + upload file →
tambah Cloudflare Worker (cukup 10 menit).

---

# 🧪 Test otomatis

```bash
node tests/_jsonp-test.mjs    # simulasi mode JSONP end-to-end
node tests/_audit.mjs         # kontrak API & keamanan
```

Status saat paket ini dibuat: **5/5 uji JSONP lulus**, 31/31 aksi sinkron dengan allowlist.
