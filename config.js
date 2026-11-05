/* ==========================================================================
   My Kasir — konfigurasi frontend
   --------------------------------------------------------------------------
   File ini dipakai frontend. Salin `config.example.js` ke `config.js`,
   lalu isi workerUrl dengan URL Worker Cloudflare Anda.

   PENTING:
   - JANGAN pernah menaruh URL Apps Script, password, atau PIN di sini.
     File ini publik (termuat di GitHub Pages).
   - Kalau aplikasi dijalankan langsung di Google Apps Script (mode native),
     workerUrl boleh dikosongkan — frontend otomatis memakai google.script.run.
   ========================================================================== */

window.MY_KASIR_CONFIG = {
  // Ganti dengan URL Worker Anda, contoh:
  //   workerUrl: 'https://my-kasir-api.akarna.workers.dev'
  workerUrl: '',
   scriptUrl: 'https://script.google.com/macros/s/AKfycbxGGOG-qsWzG1Wl2fDUuKCjFv5evCORQmty7fN3qLImmJjiqP4H6XWqDHib7aIyq0iu7w/exec',
  // Nama toko yang tampil sebelum data dari server termuat (opsional).
  storeName: 'My Kasir'
};
