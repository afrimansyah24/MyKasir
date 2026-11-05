/* ==========================================================================
   My Kasir — konfigurasi frontend
   --------------------------------------------------------------------------
   Isi SALAH SATU dari dua opsi di bawah. Frontend otomatis memilih
   transport yang sesuai:

   • workerUrl  → Cloudflare Worker (proxy CORS).  ← DISARANKAN
   • scriptUrl  → URL /exec Apps Script (mode JSONP, tanpa Cloudflare)

   PENTING:
   - JANGAN pernah menaruh password, PIN, atau kredensial di sini.
     File ini publik (termuat di GitHub Pages).
   - Kalau aplikasi dijalankan langsung di Google Apps Script, keduanya
     boleh kosong — frontend otomatis memakai google.script.run.
   ========================================================================== */

window.MY_KASIR_CONFIG = {
  // ---- Opsi A: Cloudflare Worker (disarankan untuk produksi) ----
  // Contoh: 'https://my-kasir-api.akarna.workers.dev'
  workerUrl: '',

  // ---- Opsi B: Apps Script langsung, TANPA Cloudflare ----
  // Contoh: 'https://script.google.com/macros/s/AKfycbXXXX/exec'
  // ⚠️ Pakai ini kalau Anda tidak ingin memakai layanan tambahan.
  //    Backend dipanggil lewat JSONP (bukan POST), jadi:
  //    - tidak bisa kirim file binary (foto produk tetap pakai URL)
  //    - URL Apps Script jadi terlihat publik
  scriptUrl: '',

  // Nama toko yang tampil sebelum data dari server termuat (opsional).
  storeName: 'My Kasir'
};
