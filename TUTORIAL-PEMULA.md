# Tutorial: Pasang My Kasir dari Nol (GitHub + Apps Script)

Panduan ini untuk **orang yang belum pernah** memakai Google Apps Script maupun GitHub.
Semua klik dijelaskan satu per satu. Tidak ada istilah teknis yang tidak dijelaskan.

---

## 🧠 Peta Besar: 3 Piece

Bayangkan Anda punya toko. Ada **3 orang** yang bekerja:

| Orang | Tugasnya | receberam |
|---|---|---|
| **Tampak di layar** (GitHub) | Tampilan toko yang dilihat pelanggan & kasir | Di layar pelanggan |
| **Penengah** (Cloudflare) | Pengantar pesan antar orang | Meneruskan pesan |

### Kenapa ada "penengah"?

Ini bagian yang paling sering bikin bingung, jadi saya jelaskan pelan.

Anda akan punya dua alamat web berbeda:
- Tampilan toko → `https://namakamu.github.io/my-kasir/`
- Otak / data → `https://script.google.com/macros/s/xxxx/exec`

Browser punya aturan ketat: **sebuah halaman web tidak boleh meminta data dari alamat web lain yang berbeda**. Ini berlaku demi keamanan (agar situs A tidak bisa diam-diam membaca data situs B).

Karena itu, kalau `fetch` langsung dari GitHub ke Apps Script, browser akan **menolak** dan muncul pesan error "CORS policy".

Apps Script tidak bisa menambah izin lintas-domain tersebut (kebijakan Google), jadi kita butuh **penengah**: Cloudflare Worker.

Penengah ini:
1. Menerima permintaan dari halaman GitHub (hanya dari alamat Anda, yang lain ditolak)
2. Meneruskannya ke Apps Script
3. Menambahkan "izin" supaya browser tidak menolak

**Penengah ini gratis**, dan bonusnya: alamat Apps Script Anda jadi **tidak terlihat** oleh publik — alamat itu disimpan di dalam Cloudflare, bukan di website Anda.

### Alur lengkap satu transaksi

```
Pelanggan klik "Beli"
      ↓
Halaman GitHub (app.js) mencoba kirim data
      ↓
Cloudflare Worker (periksa: dari alamat yang benar?)
      ↓
Google Apps Script (logika bisnis + cek password)
      ↓
Google Sheets (data tersimpan)
      ↓
Balik naik: Sheet → Apps Script → Worker → GitHub → tampilan diperbarui
```

---

# BAGIAN 1 — Yang Perlu Disiapkan

| Yang perlu | Cara mendapatkannya |
|---|---|
| Akun Google | Sudah punya (Gmail) |
| Akun GitHub | <https://github.com> → Sign up (gratis) |
| Akun Cloudflare | <https://dash.cloudflare.com> → Create account (gratis, minta email saja) |
| Browser | Chrome atau Edge (paling aman) |

> Semua **gratis**. Tidak perlu kartu kredit.

---

# BAGIAN 2 — Bikin Bank Data (Google Sheets)

## 2.1 Bikin spreadsheet

1. Buka <https://sheets.google.com>
2. Klik **Blank spreadsheet**
3. Klik nama file di kiri atas ("Sheet1" → "Untitled spreadsheet") → ketik: **`My Kasir Database`**
4. Tekan Enter

## 2.2 Catat ID-nya

Lihat URL di address bar. Contoh:

```
https://docs.google.com/spreadsheets/d/1aBcDeFgHiJkLmNoPqRsT/edit
                                       ^^^^^^^^^^^^^^^^^^^^^^^^^^
                                       ini ID-nya (25 karakter)
```

**Salin ID ini** (tandai/copy). Nanti kita pakai.

> 💡 Tapi tenang — di langkah 4.4 nanti ada cara yang **lebih mudah** dan ID ini jadi tidak wajib.

---

# BAGIAN 3 — Bikin "Otak" (Google Apps Script)

## 3.1 Buka tempat membuat kode

1. Buka <https://script.google.com>
2. Klik tombol **+ New project**
3. Ganti nama project: klik "Untitled project" → ketik **`My Kasir`** → Enter

## 3.2 Tempel kode backend

1. Di editor tengah, hapus semua isi yang ada (Ctrl+A, Delete)
2. Buka file `gas/Code.gs` dari paket Anda di komputer
3. Blok semua (Ctrl+A), copy (Ctrl+C)
4. Kembali ke browser, paste di editor (Ctrl+V)

## 3.3 Bikin 3 file HTML (INI WAJIB!)

Ini bagian yang **paling sering terlewat**, dan penyebab "halaman putih".

> ⚠️ **Aturan Apps Script:** nama file HTML **tidak boleh ada ekstensi `.html`**.

Untuk tiap file di bawah:
- Menu **File → New → HTML file**
- Ketik nama **persis** (tanpa `.html`)
- Hapus isi default, paste isi file dari paket

| Ketik nama ini | Paste isi file ini |
|---|---|
| `Index` | `gas/Index.html` |
| `Css` | `gas/Css.html` |
| `Js` | `gas/Js.html` |

**Cek dulu:** di panel kiri, harus ada 4 file:

```
📁 My Kasir
├── Code.gs
├── Index.html
├── Css.html
└── Js.html
```

> ❗ Kalau `Index.html` tidak ada → aplikasi akan menampilkan pesan error JSON, bukan halaman. Itu persis gejala "halaman putih".

## 3.4 Hubungkan ke spreadsheet

Pilih **salah satu**:

**Opsi A — Lewat spreadsheet (Paling mudah, tapi versi kuno)**
1. Balik ke tab spreadsheet `My Kasir Database`
2. Klik menu **Extensions → Apps Script**
3. Muncul project baru yang menempel ke spreadsheet itu
4. Ulangi langkah 3.2 & 3.3 di project tersebut

**Opsi B — Pakai ID (Lebih modern, disarankan)**
1. Kembali ke <https://script.google.com>
2. Klik ikon **⚙️ Project Settings** (kiri bawah, di bawah daftar file)
3. Scroll ke bagian **Script Properties** → klik **Add script property**
4. Isi:
   - **Key**: `DB_ID`
   - **Value**: ID spreadsheet dari langkah 2.2
5. Klik **Add script property** → **Save script properties**

## 3.5 Jalankan sekali untuk membuat tabel

1. Di toolbar atas, cari dropdown fungsi (kiri atas) → pilih **`setupDatabase`**
2. Klik tombol **▶ Run** (tombol Run besar berwarna hijau)
3. Muncul permintaan izin:
   - Pilih akun Google Anda → **Next**
   - Muncul "Google hasn't verified this app" → klik **Advanced**
   - Klik **Go to My Kasir (unsafe)** → **Allow**
     > ⚠️ **Ini normal.** Semua script buatan sendiri punya peringatan ini. Google cuma belum sempat memverifikasi. Klik **Allow**.
4. Tunggu 10–30 detik (kadang lama karena ini pertama kali)
5. Cek di panel kiri bawah: tab **Executions** — harus ada baris hijau ✅ "Success"

### Hasilnya

Kembali ke spreadsheet `My Kasir Database`. Sekarang ada **6 tab** di bawah:

```
Stock | Catalog | Transactions | Expenses | Settings | OnlineOrders
```

Tabelnya **otomatis dibuat** dengan judul kolom yang benar. Anda tidak perlu mengetik apa-apa.

> Kalau tidak muncul: buka tab **Executions** → klik baris yang gagal → bagian **Details** ada pesan errornya.

---

# BAGIAN 4 — Terbitkan Apps Script (dapat alamat)

## 4.1 Deploy

1. Klik tombol biru **Deploy** (kanan atas) → **New deployment**
2. Klik ikon ⚙️ di sebelah "Select type" → pilih **Web app**
3. Isi form:

| Kolom | Pilih |
|---|---|
| Description | `My Kasir v1` |
| Execute as | **Me (email kamu)** |
| Who has access | **Anyone** |

> ⚠️⚠️ **PENTING: "Who has access" harus "Anyone".**
> Kalau diisi "Only myself", penengah Cloudflare tidak bisa masuk, dan aplikasinya tidak akan bisa mengambil data apa pun.

4. Klik **Deploy** → kalau muncul **Authorize** → **Allow**
5. Muncul **"Deployment completed"** + satu alamat web. Salin!

```
https://script.google.com/macros/s/AKfycbXXXXXXXXXXXXXXXXXXXX/exec
                                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                   INI alamat yang Anda butuhkan
```

6. Simpan di Notepad. Namai: **ALAMAT APPS SCRIPT**

## 4.2 Aturan wajib: setiap ubah kode harus deploy ulang

Kalau Anda nanti mengubah `Code.gs`:

**Deploy → Manage deployments → klik ikon pensil (✏️) → Version: **New version** → Deploy**

> ⚠️ Ini penyebab paling umum "kok perubahan saya tidak muncul". Tanpa "New version", Google masih menjalankan kode LAMA.

---

# BAGIAN 5 — Bikin Penengah (Cloudflare Worker)

## 5.1 Bikin Worker

1. Login <https://dash.cloudflare.com>
2. Menu kiri: **Workers & Pages** → tab **Create**
3. Klik **Get started** (atau **Create Worker**)
4. Ketik nama: **`my-kasir-api`** → klik **Deploy**

## 5.2 Aktifkan alamat internetnya

> ⚠️ Worker yang baru dibuat **tidak bisa dipanggil** sampai diaktifkan. Ini sering terlewat.

1. Klik worker `my-kasir-api`
2. Tab **Settings** di atas
3. Cari bagian **workers.dev** → klik **Activate**
4. Tunggu sampai tulisannya jadi **Active** (beberapa detik)
5. Di bagian yang sama, salin alamatnya:

```
https://my-kasir-api.akarna.workers.dev
```

6. Simpan di Notepad. Namai: **ALAMAT WORKER**

> `akarna` itu ganti dengan milik Anda sendiri.

## 5.3 Ganti kode Worker

1. Di worker, klik tab **Edit code** (atau **Code**) di kiri atas
2. Hapus **seluruh** isi editor
3. Buka file `worker/worker.js` dari paket → copy → paste
4. Klik tombol **Deploy** (biru, kanan atas)

## 5.4 Isi 2 "Kunci" (variabel)

1. Tab **Settings → Variables and Secrets**
2. Klik **Add** → isi:

**Tabel pertama:**

| Kolom | Isi |
|---|---|
| Type | **Secret** 🔒 |
| Name | `GAS_EXEC_URL` |
| Value | ALAMAT APPS SCRIPT dari langkah 4.1 |

**Tabel kedua:**

| Kolom | Isi |
|---|---|
| Type | **Text** (atau Variable) |
| Name | `ORIGIN` |
| Value | `https://namakamu.github.io` |

> **Penting untuk `ORIGIN`:**
> - Tulis **persis** seperti punya Anda, dengan `https://`
> - **Jangan** ada garis miring di akhir
> - **Jangan** ada `/my-kasir` di akhir — cukup sampai `.github.io`
> - Repo GitHub Pages Anda berada di `https://namakamu.github.io/my-kasir/`, tapi ORIGIN tetap `https://namakamu.github.io`

3. Klik **Save and deploy**

## 5.5 Uji cepat (opsional tapi Exec)

Buka browser → **F12** (DevTools) → tab **Console** → paste:

```javascript
fetch('https://my-kasir-api.akarna.workers.dev', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'getPublicCatalogData', args: {} })
}).then(r => r.json()).then(console.log);
```

| Hasil | Artinya |
|---|---|
| `{ ok: true, data: {...} }` | ✅ Berhasil |
| `{ ok: false, error: "Origin not allowed" }` | `ORIGIN` tidak cocok → normal, akan benar saat diuji dari GitHub Pages |
| `{ ok: false, error: "Backend returned non-JSON response" }` | `GAS_EXEC_URL` salah, atau Apps Script belum "Anyone" |

---

# BAGIAN 6 — Bikin GitHub & Upload

## 6.1 Bikin repository

1. Buka <https://github.com>
2. Klik tombol **+** kanan atas → **New repository**
3. Isi:
   - **Repository name**: `my-kasir`
   - Pilih **Public**
   - **Jangan** centang "Add a README" (boleh, tapi tidak wajib)
4. Klik **Create repository**

## 6.2 Upload file

1. Di halaman repo, klik **Add file** → **Upload files**
2. Ekstrak dulu `my-kasir-frontend.zip` (klik kanan → Extract All)
3. Buka folder `my-kasir` yang hasil ekstrak
4. **Seret SEMUA isinya** ke area upload GitHub:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `config.js`
   - `manifest.webmanifest`
   - `sw.js`
   - folder `icons/`

> ⚠️ **Penting:** seret **file-file di dalam** folder, bukan foldernya sendiri.
> Kalau `index.html` masuk ke subfolder, situsnya akan 404.

## 6.3 Isi config.js

1. Di daftar file repo, klik **`config.js`**
2. Klik ikon pensil ✏️ di kanan atas
3. Ganti baris `workerUrl: ''` menjadi:

```javascript
workerUrl: 'https://my-kasir-api.akarna.workers.dev',
```

4. Klik **Commit changes** (kiri atas)

> 🔐 File ini aman dipublikasikan — hanya berisi alamat Worker.
> **Jangan pernah** taruh alamat Apps Script (`script.google.com/macros/...`) di sini.

---

# BAGIAN 7 — Nyalakan GitHub Pages

1. Di repo, klik tab **Settings**
2. Menu kiri bawah → **Pages**
3. Di bagian **Build and deployment**:
   - **Source**: pilih `Deploy from a branch`
   - **Branch**: `main` / **`(root)`**
4. Klik **Save**
5. Tunggu 1–2 menit, lalu muat ulang halaman
6. Akan muncul tulisan hijau:

   ```
   Your site is live at https://namakamu.github.io/my-kasir/
   ```

7. Klik alamat tersebut

---

# BAGIAN 8 — Tes & Perbaiki

## 8.1 Daftar periksa cepat

| # | Yang dicek | Cara | Hasil yang benar |
|---|---|---|---|
| 1 | Halaman terbuka | Buka URL | Hero ungu, katalog produk |
| 2 | Console bersih | F12 → Console | Tidak ada tulisan merah |
| 3 | Request Worker | F12 → Network → ketik `workers.dev` | 1 request, status **200** |
| 4 | Header izin | Network → klik request → Response Headers | Ada `access-control-allow-origin` |
| 5 | Data masuk | Buka spreadsheet | Tab `OnlineOrders` terisi |
| 6 | Login | Klik menu Kasir | Masuk ke dashboard |

## 8.2 Kalau halamannya PUTIH

**Cara diagnosis (penting!):**

1. Tekan **F12** → tab **Console**
2. Lihat error **merah pertama** — itu petunjuknya
3. Klik tab **Network** → filter `workers.dev`

| Yang terlihat di Network | Masalah | Solusi |
|---|---|---|
| Tidak ada request sama sekali | `config.js` tidak terupload / `workerUrl` kosong | Upload ulang `config.js`, isi workerUrl |
| **403 Forbidden** | `ORIGIN` salah | Perbaiki `ORIGIN` di Cloudflare, save & deploy ulang |
| **502** | `GAS_EXEC_URL` salah / Apps Script belum "Anyone" | Periksa lagi langkah 4 & 5.4 |
| **404** | Worker belum ter-deploy | Deploy ulang worker.js |
| Error CORS di Console | `ORIGIN` tidak persis | `https://namakamu.github.io` (tanpa path) |

4. **Cache browser** sering jadi culprits. Perbaiki:
   - F12 → Application → Service Workers → klik **Unregister**
   - Application → Storage → **Clear site data**
   - Tutup & buka lagi browser
5. **Hard reload**: tekan `Ctrl` + `Shift` + `R`

## 8.3 Kalau katalog kosong tapi tidak ada error

- Belum ada produk → login Owner → menu Katalog → Tambah Produk
- Pesanan online dimatikan → Owner → Pengaturan → nyalakan

---

# BAGIAN 9 — WAJIB: Ganti Password Bawaan

Sebelum dipakai sungguhan, **ganti semua ini**:

| Bawaan | Ganti dengan |
|---|---|
| `owner` / `owner123` | username & password kuat |
| `kasir` / `123` | password unik |
| PIN `123456` | 6 digit yang sulit ditebak |

**Cara ganti password:**
1. Login Owner → menu **Pengaturan**
2. Cari bagian **Ganti Password User**
3. Pilih akun → isi password baru → **Update Password**

**Cara ganti PIN:**
1. Login Owner → **Pengaturan** → bagian **Keamanan Owner**
2. Isi 6 digit baru → **Simpan PIN**

> ⚠️ PIN `123456` yang tidak diganti = siapa pun bisa membuka menu kasir dari halaman publik. Ini bukan formalitas, ini lubang keamanan sungguhan.

---

# BAGIAN 10 — Pasang di HP (PWA)

1. Buka URL GitHub Pages di Chrome (HP atau PC)
2. **Android**: menu ⋮ → **Install app** / **Add to Home screen**
   **iPhone**: tombol Bagikan → **Add to Home Screen**
   **PC Chrome**: ada ikon install ⊕ di address bar → klik
3. Aplikasi terbuka **tanpa address bar** — seperti aplikasi biasa
4. Ada shortcut: **Toko**, **Kasir**, **Antrean**

> ⚠️ Ini **bukan** POS yang jalan offline. Data & transaksi tetap butuh internet.
> Kalau internet putus, aplikasinya akan menampilkan pesan, bukan error.

---

# BAGIAN 11 — Ringkasan Urutan Kerja

| # | Layanan | Yang dilakukan | Hasil disimpan |
|---|---|---|---|
| 1 | Google Sheets | Bikin spreadsheet | ID spreadsheet |
| 2 | Google Apps Script | Tempel `Code.gs` + 3 file HTML | Kode terpasang |
| 3 | Google Apps Script | Run `setupDatabase` | 6 sheet otomatis |
| 4 | Google Apps Script | Deploy → Web app → Anyone | **ALAMAT APPS SCRIPT** |
| 5 | Cloudflare | Bikin worker + aktifkan subdomain | **ALAMAT WORKER** |
| 6 | Cloudflare | Tempel `worker.js` + isi 2 variabel | Worker jalan |
| 7 | GitHub | Bikin repo + upload 7 file | File di repo |
| 8 | GitHub | Edit `config.js` (workerUrl) | Frontend tersambung |
| 9 | GitHub | Settings → Pages | **WEBSITE HIDUP** |
| 10 | GitHub | Deploy ulang worker & Worker | Semua terhubung |
| 11 | Aplikasi | Ganti password & PIN | Aman |

---

# 🔄 Kalau Mau Ubah Kode Nanti

**Frontend (GitHub):**
```bash
git clone https://github.com/NAMAKAMU/my-kasir.git
cd my-kasir
# edit file
git add -A
git commit -m "perubahan"
git push
```
Tunggu ±1 menit → GitHub Pages otomatis ter-deploy.

> Naikkan versi cache di `sw.js` kalau perubahan besar:
> ```javascript
> const CACHE = 'my-kasir-shell-v4';   // v3 → v4
> ```

**Backend (Apps Script):**
1. Edit `Code.gs` di browser → paste kode baru
2. **WAJIB**: Deploy → Manage deployments → ✏️ → **New version** → Deploy
3. Tidak perlu upload ulang ke GitHub

---

# 📌 Kalau Tidak Mau Pusing Cloudflare

Ada cara singkat: **taruh frontend-nya langsung di Apps Script** (tanpa GitHub).

1. Taruh `gas/Index.html`, `gas/Css.html`, `gas/Js.html` ke project Apps Script
2. Deploy → Web app → Anyone
3. Buka alamat `/exec` → langsung jalan

**Kekurangannya:**
- ❌ Tidak bisa di-install sebagai PWA (Apps Script jalan di dalam iframe yang menolak service worker)
- ⚠️ Alamat `/exec` jadi publik — bisa diakses siapa pun yang tahu

**Kelebihannya:** cuma 1 layanan, tidak perlu GitHub, tidak perlu Cloudflare.

> Pilih cara ini kalau tujuannya **uji coba dulu** dan butuh cepat.

---

# 📎 Daftar Periksa Akhir

- [ ] Spreadsheet punya 6 sheet (Stock, Catalog, Transactions, Expenses, Settings, OnlineOrders)
- [ ] `setupDatabase` dijalankan, Execution hijau
- [ ] Deployment Apps Script = **Anyone**, ada **New version**
- [ ] Worker `workers.dev` = **Active**
- [ ] `GAS_EXEC_URL` terisi, `ORIGIN` = `https://namakamu.github.io`
- [ ] `config.js` di GitHub punya `workerUrl` terisi
- [ ] `index.html` ada di **root** repo
- [ ] GitHub Pages = `main` / `(root)`, status hijau
- [ ] Console browser bersih (tidak ada error merah)
- [ ] Katalog tampil & bisa create pesanan
- [ ] Sheet `OnlineOrders` & `Transactions` terisi
- [ ] **Password owner/kasir & PIN sudah diganti**
- [ ] PWA bisa di-install
