/* ==========================================================================
 * My Kasir — client application (static PWA on GitHub Pages)
 * --------------------------------------------------------------------------
 * Semua panggilan backend lewat Worker bridge:
 *     POST { workerUrl }  { action, args: { ...args, token } }
 *     Response            { ok, data, error }
 * Backend (gas/Code.gs) membuka allowlist action -> nama argumen.
 * --------------------------------------------------------------------------
 * Modul:
 *   rpc        : jembatan ke backend
 *   ui         : toast, modal, view switching, helper DOM
 *   session    : login/logout, token, peran
 *   store      : portal customer (publik)
 *   pos        : terminal kasir
 *   erp        : portal owner
 *   tv         : layar antrean
 * ========================================================================== */
(function () {
  'use strict';

  var CFG = window.MY_KASIR_CONFIG || {};
  var TOKEN_KEY = 'mk-token';
  var USER_KEY = 'mk-user';
  var ROLE_KEY = 'mk-role';
  var TV_TOKEN_KEY = 'mk-tv-token';

  /* ------------------------------------------------------------------
   * 0. Utilitas
   * ---------------------------------------------------------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(id) { return document.getElementById(id); }

  /** Escape string sebelum masuk ke innerHTML (data dari server tidak pernah dipercaya). */
  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /** Escape untuk dipakai sebagai nilai atribut. */
  function escAttr(v) { return esc(v); }

  function money(n) { return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID'); }
  function num(n) { return (Number(n) || 0).toLocaleString('id-ID'); }

  function safeParse(raw, fallback) {
    if (raw === null || raw === undefined || raw === '') return fallback;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  function uid() { return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function dateKey(v) {
    if (!v) return '';
    var d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d.getTime())) return String(v).substring(0, 10);
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function todayKey() { return dateKey(new Date()); }
  function fmtDateTime(v) {
    var d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d.getTime())) return String(v || '');
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fmtTime(v) {
    var d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d.getTime())) return String(v || '');
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fmtDay(v) {
    var d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d.getTime())) return String(v || '');
    var days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return days[d.getDay()] + ', ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  var PLACEHOLDER_IMG = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320">' +
    '<rect width="320" height="320" fill="#e2e7ff"/>' +
    '<text x="160" y="172" font-size="16" text-anchor="middle" fill="#777587" ' +
    'font-family="sans-serif">Tanpa foto</text></svg>');

  /* ------------------------------------------------------------------
   * 1. RPC — jembatan ke backend
   * ---------------------------------------------------------------- */
  /**
   * Urutan argumen posisi untuk mode GAS native (google.script.run).
   * Kunci HARUS sama dengan nama parameter fungsi backend di Code.gs.
   */
  var GAS_ARG_ORDER = {
    login: ['user', 'pass', 'expectedRole'],
    logout: ['token'],
    getPublicCatalogData: [],
    calculateOngkir: ['lat', 'lng'],
    createOnlineOrder: ['data'],
    getOnlineOrderStatus: ['kode'],
    recoverPassword: ['username'],
    verifyPortalPin: ['pin'],
    verifyPin: ['token', 'pin'],
    getTTS: ['txt'],
    getDashboardData: ['token'],
    getActiveQueues: ['token'],
    getOnlineOrders: ['token'],
    saveTransaction: ['token', 'data'],
    saveStock: ['token', 'data'],
    updateStockQty: ['token', 'id', 'newQty'],
    saveCatalog: ['token', 'data'],
    updateCatalogStatusAndStock: ['token', 'id', 'status', 'stok'],
    saveExpenseAndStock: ['token', 'desc', 'amount', 'stockItems', 'newStockItems'],
    deleteExpense: ['token', 'id'],
    saveAllSettings: ['token', 'settingsObj'],
    deleteTransaction: ['token', 'password', 'trxId'],
    updateQueueStatus: ['token', 'id', 'status', 'qNum'],
    callQueueAgain: ['token', 'qNum'],
    resetQueueCounter: ['token'],
    confirmOnlinePayment: ['token', 'id', 'kasirUsername'],
    updateOnlineOrderStatus: ['token', 'id', 'status', 'kasirUsername'],
    getUsers: ['token'],
    saveUser: ['token', 'data'],
    changePassword: ['token', 'oldPass', 'newPass'],
    setPasswordForUser: ['token', 'username', 'newPass']
  };

  var rpcInFlight = 0;

  /**
   * Transport RPC.
   *
   * Mode A — Google Apps Script native (file ini ditempel sebagai HTML di Apps Script):
   *   memakai google.script.run. Perlu fungsi GAS dengan nama yang sama.
   *
   * Mode B — GitHub Pages (statis): fetch ke Cloudflare Worker (CORS proxy).
   *   Pemilih mode dilakukan otomatis: bila google.script.run tersedia -> Mode A.
   *
   * Kontrak payload (Mode B) : { action, args }
   * Kontrak respons (Mode B)  : { ok, data, error }
   */
  function inGas() {
    return typeof google !== 'undefined' && google.script && google.script.run;
  }

  function hasWorker() {
    return !!(CFG.workerUrl && !/YOUR-WORKER|your-worker/i.test(CFG.workerUrl));
  }

  /** Panggil backend lewat google.script.run (Mode A). */
  function rpcViaGas(action, payloadArgs) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var runner = google.script.run
        .withSuccessHandler(function (res) {
          if (settled) return;
          settled = true;
          // Bentuk respons seragam: { ok, data, error }
          if (res && typeof res === 'object' && 'ok' in res) {
            if (res.ok === false) reject(new Error(res.error || 'Permintaan gagal.'));
            else resolve(res.data);
          } else if (res && res.success === false) {
            reject(new Error(res.message || 'Permintaan gagal.'));
          } else {
            resolve(res);
          }
        })
        .withFailureHandler(function (err) {
          if (settled) return;
          settled = true;
          reject(new Error((err && err.message) || 'Gagal menghubungi server.'));
        });
      try {
        if (typeof runner[action] !== 'function') {
          throw new Error('Fungsi backend "' + action + '" tidak ada.');
        }
        // Posisi argumen harus sesuai urutan parameter fungsi GAS.
        var order = GAS_ARG_ORDER[action];
        if (!order) {
          throw new Error('Urutan argumen untuk "' + action + '" belum didefinisikan di app.js.');
        }
        var posArgs = order.map(function (k) { return payloadArgs[k]; });
        runner[action].apply(runner, posArgs);
      } catch (e) {
        if (settled) return;
        settled = true;
        reject(new Error(e.message || 'Gagal menghubungi server.'));
      }
    });
  }

  /** Panggil backend lewat Worker (Mode B). */
  function rpcViaWorker(action, payloadArgs) {
    return fetch(CFG.workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, args: payloadArgs })
    }).then(function (res) {
      return res.text().then(function (txt) {
        var body;
        try { body = JSON.parse(txt); }
        catch (e) { throw new Error('Respons Worker bukan JSON valid. Periksa URL Worker & deploy.'); }
        if (!res.ok || body.ok === false) {
          throw new Error(body.error || ('Permintaan gagal (HTTP ' + res.status + ').'));
        }
        return body.data;
      });
    }).catch(function (err) {
      if (err instanceof TypeError) {
        throw new Error('Tidak bisa menghubungi Worker. Periksa koneksi internet dan URL Worker.');
      }
      throw err;
    });
  }

  function rpc(action, args) {
    args = args || {};
    var payloadArgs = {};
    Object.keys(args).forEach(function (k) { payloadArgs[k] = args[k]; });
    // Token sesi dipakai sebagai default; caller boleh menimpanya (mis. token layar TV).
    if (payloadArgs.token === undefined) payloadArgs.token = session.token || '';

    var useGas = inGas();
    if (!useGas && !hasWorker()) {
      return Promise.reject(new Error(
        'Backend belum terhubung. Salin config.example.js ke config.js lalu isi URL Worker, ' +
        'atau jalankan file ini langsung di Google Apps Script.'
      ));
    }

    rpcInFlight++;
    document.body.setAttribute('data-busy', '1');

    var p = useGas ? rpcViaGas(action, payloadArgs) : rpcViaWorker(action, payloadArgs);
    return p.finally(function () {
      rpcInFlight--;
      if (rpcInFlight <= 0) { rpcInFlight = 0; document.body.removeAttribute('data-busy'); }
    });
  }

  /* ------------------------------------------------------------------
   * 2. UI — toast, modal, view
   * ---------------------------------------------------------------- */
  var ui = {
    toast: function (msg, type, ttl) {
      var host = el('toast-host');
      if (!host) return;
      type = type || 'info';
      var icons = { success: '#i-check', error: '#i-alert', warning: '#i-alert', info: '#i-info' };
      var node = document.createElement('div');
      node.className = 'toast t-' + type;
      node.setAttribute('role', type === 'error' ? 'alert' : 'status');
      node.innerHTML =
        '<span class="toast-ic"><svg class="ic" aria-hidden="true"><use href="' + icons[type] + '"/></svg></span>' +
        '<span class="toast-msg">' + esc(msg) + '</span>' +
        '<button type="button" class="toast-close" aria-label="Tutup notifikasi"><svg class="ic" aria-hidden="true"><use href="#i-close"/></svg></button>';
      host.appendChild(node);

      var close = function () {
        node.classList.add('is-out');
        setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 200);
      };
      var closeBtn = node.querySelector ? node.querySelector('.toast-close') : null;
      if (closeBtn) closeBtn.addEventListener('click', close);
      setTimeout(close, ttl || (type === 'error' ? 7000 : 4200));
    },

    /* ---- modal berbasis <dialog> ---- */
    modal: function (title, bodyHtml, footHtml) {
      var dlg = el('app-modal');
      if (!dlg) return null;
      el('app-modal-title').textContent = title || '';
      el('app-modal-body').innerHTML = bodyHtml || '';
      el('app-modal-foot').innerHTML = footHtml || '';
      if (typeof dlg.showModal === 'function') {
        if (!dlg.open) dlg.showModal();
      } else {
        dlg.setAttribute('open', '');
      }
      return dlg;
    },
    closeModal: function () {
      var dlg = el('app-modal');
      if (!dlg) return;
      if (typeof dlg.close === 'function' && dlg.open) dlg.close();
      else dlg.removeAttribute('open');
    },
    confirm: function (title, message, onOk, okLabel) {
      ui.modal(
        title,
        '<p>' + esc(message) + '</p>',
        '<button type="button" class="btn btn-ghost" data-act="cancel">Batal</button>' +
        '<button type="button" class="btn btn-danger" data-act="ok">' + esc(okLabel || 'Hapus') + '</button>'
      );
      var foot = el('app-modal-foot');
      foot.querySelector('[data-act="cancel"]').addEventListener('click', ui.closeModal);
      foot.querySelector('[data-act="ok"]').addEventListener('click', function () {
        ui.closeModal();
        if (typeof onOk === 'function') onOk();
      });
    },

    /* ---- view switching ---- */
    showView: function (name) {
      ['store', 'kasir', 'owner', 'tv'].forEach(function (v) {
        var node = el('view-' + v);
        if (node) node.hidden = (v !== name);
      });
      $$('#topnav .nav-btn').forEach(function (b) {
        if (b.dataset.view === name) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
      });
      window.scrollTo({ top: 0, behavior: 'auto' });

      // Reveal berurutan pada panel utama view yang baru dibuka.
      var view = el('view-' + name);
      if (view && typeof view.querySelectorAll === 'function') {
        var panels = Array.prototype.slice.call(view.querySelectorAll('.panel'));
        // Batasi hanya panel yang langsung di dalam view (bukan panel di dalam panel).
        panels = panels.filter(function (p) {
          var parent = p.parentNode;
          while (parent && parent !== view) {
            if (parent.classList && parent.classList.contains('panel')) return false;
            parent = parent.parentNode;
          }
          return true;
        });
        panels.slice(0, 8).forEach(function (p, i) {
          p.classList.remove('anim-rise');
          void p.offsetWidth;               // reflow agar animasi bisa diputar ulang
          p.classList.add('anim-rise');
          p.style.animationDelay = (i * 0.06) + 's';
        });
      }
    }
  };

  /* ------------------------------------------------------------------
   * 3. Session
   * ---------------------------------------------------------------- */
  var session = {
    get token() { return sessionStorage.getItem(TOKEN_KEY) || ''; },
    get user() { return sessionStorage.getItem(USER_KEY) || ''; },
    get role() { return sessionStorage.getItem(ROLE_KEY) || ''; },
    isAuthed: function () { return !!session.token; },
    set: function (token, user, role) {
      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(USER_KEY, user || '');
      sessionStorage.setItem(ROLE_KEY, role || '');
    },
    clear: function () {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(ROLE_KEY);
    },
    paint: function () {
      var badge = el('session-badge');
      var btn = el('btn-logout');
      if (session.isAuthed()) {
        badge.hidden = false;
        badge.textContent = session.role + ' · ' + session.user;
        btn.hidden = false;
      } else {
        badge.hidden = true;
        btn.hidden = true;
      }
    }
  };

  /* ==================================================================
   * 4. MODUL: STORE (portal customer, publik)
   * ================================================================== */
  var store = {
    catalog: [],
    settings: {},
    cart: [],
    category: 'Semua',
    orderType: 'Pickup',
    method: 'Cash',
    loc: { lat: null, lng: null, ongkir: 0, jarak: 0 },
    orderResult: null,
    pollTimer: null,
    trackTimer: null,

    init: function () {
      store.loadCatalog();
    },

    loadCatalog: function () {
      return rpc('getPublicCatalogData').then(function (d) {
        store.catalog = (d && (d.catalog || d.items)) || [];
        store.settings = (d && d.settings) || {};
        store.paintBrand();
        store.renderCategories();
        store.renderProducts();
        store.renderCart();
      }).catch(function (e) {
        ui.toast(e.message, 'error');
        var grid = el('store-products');
        if (grid) grid.innerHTML = '<div class="callout callout-danger">Katalog tidak dapat dimuat: ' + esc(e.message) + '</div>';
      });
    },

    paintBrand: function () {
      var name = store.settings.StoreName || 'My Kasir';
      var n = el('store-name');
      if (n) n.textContent = name;
      var ph = el('store-phone');
      if (ph) ph.textContent = store.settings.StorePhone ? ('Telp ' + store.settings.StorePhone) : '';
      var open = el('store-open-text');
      if (open) {
        open.textContent = String(store.settings.OnlineOrderEnabled) === 'true'
          ? 'Pesanan online dibuka'
          : 'Pesanan online sedang ditutup';
      }
      var title = document.title;
      if (title.indexOf('My Kasir') === 0) document.title = name + ' · My Kasir';
    },

    categories: function () {
      var out = ['Semua'];
      store.catalog.forEach(function (c) {
        var k = String(c.Kategori || 'Lainnya').trim();
        if (out.indexOf(k) === -1) out.push(k);
      });
      return out;
    },

    renderCategories: function () {
      var box = el('store-categories');
      if (!box) return;
      box.innerHTML = store.categories().map(function (k) {
        return '<button type="button" class="cat-chip' + (store.category === k ? ' active' : '') +
          '" data-cat="' + escAttr(k) + '">' + esc(k) + '</button>';
      }).join('');
    },

    visibleItems: function () {
      var q = String((el('store-search') || {}).value || '').trim().toLowerCase();
      return store.catalog.filter(function (c) {
        var cat = String(c.Kategori || 'Lainnya').trim();
        if (store.category !== 'Semua' && cat !== store.category) return false;
        if (!q) return true;
        var hay = (String(c.NamaMenu || '') + ' ' + String(c.Kategori || '') + ' ' + String(c.KodeMenu || '')).toLowerCase();
        return hay.indexOf(q) !== -1;
      });
    },

    renderProducts: function () {
      var grid = el('store-products');
      if (!grid) return;
      var items = store.visibleItems();
      if (!items.length) {
        grid.innerHTML = '<div class="callout callout-info">Menu tidak tersedia untuk filter ini.</div>';
        return;
      }
      grid.innerHTML = items.map(function (c, i) {
        var out = String(c.Status) === 'Habis';
        var track = String(c.TrackStok) === 'true';
        var noStock = track && (Number(c.StokProduk) || 0) <= 0;
        var disabled = out || noStock;
        var img = c.FotoURL ? '<img src="' + escAttr(c.FotoURL) + '" alt="' + escAttr(c.NamaMenu) + '" loading="lazy">' : '<span class="ph">☕</span>';
        var flag = disabled
          ? '<span class="product-flag out">Habis</span>'
          : (track ? '<span class="product-flag in">Sisa ' + num(c.StokProduk) + '</span>' : '');
        return '<article class="product-card anim-rise" style="animation-delay:' + (Math.min(i, 11) * 0.035) + 's">' +
          '<div class="product-media">' + img + flag + '</div>' +
          '<div class="product-body">' +
            '<div class="product-cat">' + esc(c.Kategori || 'Lainnya') + '</div>' +
            '<div class="product-name">' + esc(c.NamaMenu) + '</div>' +
            '<div class="product-meta">' +
              '<span class="product-price">' + money(c.Harga) + '</span>' +
              '<button type="button" class="add-btn" data-add="' + escAttr(c.ID) + '"' +
                (disabled ? ' disabled aria-disabled="true"' : '') +
                ' aria-label="Tambah ' + escAttr(c.NamaMenu) + ' ke keranjang">' +
                '<svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg></button>' +
            '</div>' +
          '</div>' +
        '</article>';
      }).join('');
    },

    addToCart: function (id) {
      var item = store.catalog.find(function (c) { return String(c.ID) === String(id); });
      if (!item) return;
      if (String(item.Status) === 'Habis' || (String(item.TrackStok) === 'true' && (Number(item.StokProduk) || 0) <= 0)) {
        ui.toast(item.NamaMenu + ' sedang habis.', 'warning');
        return;
      }
      var groups = variants.parse(item.OptionsJSON);
      if (groups.length) {
        variants.open({
          title: 'Pilih opsi',
          itemName: item.NamaMenu,
          basePrice: Number(item.Harga) || 0,
          groups: groups,
          onConfirm: function (sel) { store.pushToCart(item, sel); }
        });
      } else {
        store.pushToCart(item, []);
      }
    },

    pushToCart: function (item, selected) {
      var extra = (selected || []).reduce(function (s, o) { return s + (Number(o.price) || 0); }, 0);
      var sig = (selected || []).map(function (o) { return o.group + ':' + o.name; }).join('|');
      var key = String(item.ID) + '||' + sig;
      var found = store.cart.find(function (c) { return c.key === key; });
      if (found) found.qty += 1;
      else {
        store.cart.push({
          uid: uid(), key: key, id: String(item.ID),
          name: String(item.NamaMenu || ''),
          price: (Number(item.Harga) || 0) + extra,
          qty: 1,
          options: selected || [],
          optionsText: (selected || []).map(function (o) { return o.name; }).join(', ')
        });
      }
      store.renderCart();
    },

    changeQty: function (key, delta) {
      store.cart = store.cart.map(function (c) {
        if (c.key !== key) return c;
        c.qty += delta;
        return c;
      }).filter(function (c) { return c.qty > 0; });
      store.renderCart();
    },

    removeItem: function (key) {
      store.cart = store.cart.filter(function (c) { return c.key !== key; });
      store.renderCart();
    },

    cartTotal: function () {
      return store.cart.reduce(function (s, c) { return s + c.price * c.qty; }, 0);
    },
    cartCount: function () {
      return store.cart.reduce(function (s, c) { return s + c.qty; }, 0);
    },

    renderCart: function () {
      var box = el('store-cart-items');
      if (box) {
        if (!store.cart.length) {
          box.innerHTML = '<p class="muted">Keranjang masih kosong.</p>';
        } else {
          box.innerHTML = store.cart.map(function (c) {
            return '<div class="cart-row">' +
              '<div class="cart-row-main">' +
                '<div class="cart-row-name">' + esc(c.name) + '</div>' +
                (c.optionsText ? '<div class="cart-row-opt">' + esc(c.optionsText) + '</div>' : '') +
              '</div>' +
              '<div class="stepper">' +
                '<button type="button" data-qty="-1" data-key="' + escAttr(c.key) + '" aria-label="Kurangi jumlah"><svg class="ic" aria-hidden="true"><use href="#i-minus"/></svg></button>' +
                '<span>' + c.qty + '</span>' +
                '<button type="button" data-qty="1" data-key="' + escAttr(c.key) + '" aria-label="Tambah jumlah"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg></button>' +
              '</div>' +
              '<span class="cart-row-price">' + money(c.price * c.qty) + '</span>' +
              '<button type="button" class="icon-btn" data-del="' + escAttr(c.key) + '" aria-label="Hapus ' + escAttr(c.name) + '"><svg class="ic" aria-hidden="true"><use href="#i-close"/></svg></button>' +
            '</div>';
          }).join('');
        }
      }
      var count = el('store-cart-count');
      if (count) count.textContent = String(store.cartCount());
      var total = el('store-cart-total');
      if (total) total.textContent = money(store.cartTotal());
      store.paintOrderTotal();
    },

    paintOrderTotal: function () {
      var t = el('store-order-total');
      if (!t) return;
      var ongkir = store.orderType === 'Delivery' ? (Number(store.loc.ongkir) || 0) : 0;
      t.textContent = money(store.cartTotal() + ongkir);
    },

    setCategory: function (k) {
      store.category = k;
      store.renderCategories();
      store.renderProducts();
    },

    setOrderType: function (v) {
      store.orderType = v === 'Delivery' ? 'Delivery' : 'Pickup';
      var f = el('store-address-field');
      if (f) f.hidden = store.orderType !== 'Delivery';
      store.paintOrderTotal();
    },

    /* ---- ongkir ---- */
    calcOngkir: function () {
      var lat = parseFloat((el('store-lat') || {}).value);
      var lng = parseFloat((el('store-lng') || {}).value);
      var box = el('store-ongkir-box');
      if (isNaN(lat) || isNaN(lng)) {
        if (box) {
          box.hidden = false;
          box.className = 'callout callout-warn';
          box.textContent = 'Isi latitude dan longitude terlebih dahulu, atau gunakan tombol "Pakai lokasi saya".';
        }
        return;
      }
      store.loc.lat = lat; store.loc.lng = lng;
      if (box) { box.hidden = true; }
      return rpc('calculateOngkir', { lat: lat, lng: lng }).then(function (r) {
        if (!r || !r.success) {
          if (box) {
            box.hidden = false;
            box.className = 'callout callout-danger';
            box.textContent = (r && r.message) || 'Ongkir tidak dapat dihitung.';
          }
          store.loc.ongkir = 0;
          store.paintOrderTotal();
          return;
        }
        store.loc.ongkir = Number(r.ongkir) || 0;
        store.loc.jarak = Number(r.distanceKm) || 0;
        if (box) {
          box.hidden = false;
          box.className = 'callout callout-ok';
          box.textContent = 'Ongkir ' + money(store.loc.ongkir) + ' untuk jarak ' + store.loc.jarak +
            ' km dari toko. Angka final dihitung ulang oleh server saat checkout.';
        }
        store.paintOrderTotal();
      }).catch(function (e) {
        if (box) {
          box.hidden = false;
          box.className = 'callout callout-danger';
          box.textContent = e.message;
        }
      });
    },

    useMyLocation: function () {
      if (!navigator.geolocation) {
        ui.toast('Perangkat tidak mendukung geolokasi. Isi koordinat manual.', 'warning');
        return;
      }
      ui.toast('Meminta izin lokasi…', 'info');
      navigator.geolocation.getCurrentPosition(function (pos) {
        var lat = pos.coords.latitude, lng = pos.coords.longitude;
        var li = el('store-lat'), gi = el('store-lng');
        if (li) li.value = lat.toFixed(6);
        if (gi) gi.value = lng.toFixed(6);
        store.calcOngkir();
      }, function (err) {
        ui.toast('Gagal mengambil lokasi (' + (err && err.message ? err.message : 'izin ditolak') + '). Isi koordinat manual.', 'warning');
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    },

    /* ---- checkout ---- */
    submitOrder: function (ev) {
      if (ev) ev.preventDefault();
      var name = String((el('store-cust-name') || {}).value || '').trim();
      var email = String((el('store-cust-email') || {}).value || '').trim();
      var phone = String((el('store-cust-phone') || {}).value || '').trim();
      var address = String((el('store-cust-address') || {}).value || '').trim();

      if (!store.cart.length) { ui.toast('Keranjang masih kosong.', 'warning'); return; }
      if (!name) { ui.toast('Nama pemesan wajib diisi.', 'warning'); return; }
      if (!email || email.indexOf('@') === -1) { ui.toast('Email valid wajib diisi untuk notifikasi pesanan.', 'warning'); return; }
      var latIn = parseFloat((el('store-lat') || {}).value);
      var lngIn = parseFloat((el('store-lng') || {}).value);
      if (store.orderType === 'Delivery') {
        if (!phone) { ui.toast('No. HP wajib diisi untuk delivery.', 'warning'); return; }
        if (!address) { ui.toast('Alamat wajib diisi untuk delivery.', 'warning'); return; }
        if (isNaN(latIn) || isNaN(lngIn)) {
          ui.toast('Tentukan koordinat lokasi di panel ongkir terlebih dahulu.', 'warning');
          return;
        }
        store.loc.lat = latIn;
        store.loc.lng = lngIn;
      }

      var items = store.cart.map(function (c) {
        return { id: c.id, name: c.name + (c.optionsText ? ' (' + c.optionsText + ')' : ''), qty: c.qty, price: c.price };
      });
      var payload = {
        nama: name, email: email, hp: phone, alamat: address,
        jenis: store.orderType, metode: store.method,
        lat: store.loc.lat, lng: store.loc.lng,
        items: items
      };

      var btn = el('store-order-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Mengirim…'; }

      rpc('createOnlineOrder', { data: payload }).then(function (r) {
        if (!r || !r.success) {
          ui.toast((r && r.message) || 'Pesanan gagal dibuat.', 'error');
          return;
        }
        store.orderResult = r;
        store.cart = [];
        store.loc.ongkir = 0; store.loc.jarak = 0;
        store.renderCart();
        store.renderProducts();
        store.showOrderResult(r);
      }).catch(function (e) {
        ui.toast(e.message, 'error');
      }).finally(function () {
        if (btn) { btn.disabled = false; btn.textContent = 'Kirim pesanan'; }
      });
    },

    showOrderResult: function (r) {
      var body =
        '<div class="callout callout-ok"><strong>Kode pesanan: ' + esc(r.kode) + '</strong></div>' +
        '<div class="total-row"><span>Subtotal</span><strong>' + money(r.subtotal) + '</strong></div>' +
        (r.jenis === 'Delivery' ? '<div class="total-row"><span>Ongkir (' + num(r.distanceKm) + ' km)</span><strong>' + money(r.ongkir) + '</strong></div>' : '') +
        '<div class="total-row total-row-strong"><span>Total</span><strong>' + money(r.total) + '</strong></div>' +
        '<p class="muted" style="margin-top:12px">Metode: ' + esc(r.metode) + ' · ' + esc(r.jenis) + '</p>';

      if (r.metode === 'QRIS') {
        body +=
          '<hr class="rule">' +
          '<div class="callout callout-warn">Pesanan menunggu pembayaran QRIS. Status &quot;Lunas&quot; hanya disetel setelah <strong>kasir mengonfirmasi pembayaran secara manual</strong> — sistem ini tidak terhubung ke payment gateway dan tidak dapat membaca mutasi rekening.</div>' +
          '<div style="text-align:center;margin:14px 0">' +
            '<img src="' + escAttr(r.qrisImage || store.settings.QrisImage || PLACEHOLDER_IMG) + '" alt="Kode QRIS" ' +
              'style="width:min(260px,70%);aspect-ratio:1;object-fit:contain;border:1px solid var(--c-border);border-radius:12px;background:#fff">' +
          '</div>' +
          '<div class="total-row"><span>Total dibayar</span><strong>' + money(r.total) + '</strong></div>' +
          '<p class="muted" style="text-align:center;margin-top:6px">Berlaku 10 menit. <span id="store-qris-timer"></span></p>' +
          '<div id="store-qris-steps" style="margin-top:12px"></div>';
      } else {
        body += '<div class="callout callout-info" style="margin-top:12px">Pesanan dibuat. Pembayaran dilakukan di kasir (' + esc(r.jenis) + ').</div>';
      }

      ui.modal('Pesanan diterima', body,
        '<button type="button" class="btn btn-ghost" data-act="track">Lacak pesanan</button>' +
        '<button type="button" class="btn btn-primary" data-act="close">Selesai</button>');

      var foot = el('app-modal-foot');
      foot.querySelector('[data-act="close"]').addEventListener('click', ui.closeModal);
      foot.querySelector('[data-act="track"]').addEventListener('click', function () {
        ui.closeModal();
        var code = el('store-track-code');
        if (code) code.value = r.kode;
        store.trackOrder();
        el('store-track-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });

      if (r.metode === 'QRIS') {
        store.startQrisWatch(r);
      }
    },

    startQrisWatch: function (r) {
      store.stopQrisWatch();
      var deadline = r.qrisExpiry ? new Date(r.qrisExpiry).getTime() : (Date.now() + 10 * 60000);
      var tick = function () {
        var t = el('store-qris-timer');
        if (!t) return;
        var left = Math.max(0, deadline - Date.now());
        var m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
        t.textContent = (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
        if (left <= 0) {
          store.stopQrisWatch();
          t.textContent = 'kedaluwarsa';
          var steps = el('store-qris-steps');
          if (steps) steps.innerHTML = '<div class="callout callout-danger">Waktu pembayaran habis. Pesanan otomatis dibatalkan oleh server.</div>';
          return;
        }
        store.pollOrderStatus(r.kode, function (status) {
          var box = el('store-qris-steps');
          if (!box) return;
          if (status.statusBayar === 'Lunas') {
            store.stopQrisWatch();
            box.innerHTML = '<div class="callout callout-ok">Pembayaran dikonfirmasi kasir. Pesanan Anda sedang diproses.</div>';
          } else if (status.statusBayar === 'Kadaluarsa') {
            store.stopQrisWatch();
            box.innerHTML = '<div class="callout callout-danger">Pesanan kedaluwarsa.</div>';
          } else {
            box.innerHTML = '<div class="callout callout-info">Status pembayaran: ' + esc(status.statusBayar || '-') + '. Menunggu konfirmasi kasir.</div>';
          }
        });
      };
      tick();
      store.pollTimer = setInterval(tick, 5000);
    },

    stopQrisWatch: function () {
      if (store.pollTimer) { clearInterval(store.pollTimer); store.pollTimer = null; }
    },

    pollOrderStatus: function (kode, cb) {
      rpc('getOnlineOrderStatus', { kode: kode }).then(function (r) {
        if (r && r.success && typeof cb === 'function') cb(r);
      }).catch(function () { });
    },

    /* ---- tracking ---- */
    trackOrder: function () {
      var code = String((el('store-track-code') || {}).value || '').trim().toUpperCase();
      var box = el('store-track-result');
      if (!code) { ui.toast('Masukkan kode pesanan.', 'warning'); return; }
      if (box) { box.hidden = false; box.innerHTML = '<p class="muted">Mencari…</p>'; }
      rpc('getOnlineOrderStatus', { kode: code }).then(function (r) {
        if (!r || !r.success) {
          if (box) box.innerHTML = '<div class="callout callout-danger">' + esc((r && r.message) || 'Pesanan tidak ditemukan.') + '</div>';
          return;
        }
        var steps = store.trackSteps(r);
        var html =
          '<div class="row-actions" style="margin-bottom:8px">' +
            '<span class="badge badge-info">Kode ' + esc(r.kode) + '</span>' +
            '<span class="badge ' + (r.statusBayar === 'Lunas' ? 'badge-ok' : 'badge-warn') + '">' + esc(r.statusBayar || '-') + '</span>' +
            '<span class="badge badge-sky">' + esc(r.jenis || '-') + '</span>' +
          '</div>' +
          '<div class="total-row"><span>Total</span><strong>' + money(r.total) + '</strong></div>' +
          '<div class="track-steps">' + steps.map(function (s, i) {
            var cls = s.done ? (s.current ? 'track-step done current' : 'track-step done') : 'track-step';
            return '<div class="' + cls + '">' +
              '<span class="track-dot" aria-hidden="true"></span>' +
              '<div class="track-body"><div class="track-label">' + esc(s.label) + '</div>' +
              (s.hint ? '<div class="track-meta">' + esc(s.hint) + '</div>' : '') + '</div>' +
            '</div>';
          }).join('') + '</div>';
        if (box) box.innerHTML = html;
      }).catch(function (e) {
        if (box) box.innerHTML = '<div class="callout callout-danger">' + esc(e.message) + '</div>';
      });
    },

    trackSteps: function (r) {
      var delivery = r.jenis === 'Delivery';
      var list = delivery
        ? ['Pesanan diterima', 'Sedang disiapkan', 'Dalam pengiriman', 'Sudah diantar']
        : ['Pesanan diterima', 'Sedang disiapkan', 'Siap diambil', 'Sudah diambil'];
      var map = {
        'Diproses': 0, 'Sedang Disiapkan': 1, 'Selesai & Bisa Diambil': 2,
        'On Delivery': 2, 'Sudah Diambil': 3, 'Sudah Diantar': 3
      };
      var idx = map[r.statusOrder];
      if (idx === undefined) idx = -1;
      var cancelled = r.statusOrder === 'Dibatalkan' || r.statusBayar === 'Kadaluarsa';
      var out = list.map(function (label, i) {
        return { label: label, done: idx >= i && idx !== -1, current: idx === i, hint: '' };
      });
      if (cancelled) {
        out.push({ label: 'Pesanan dibatalkan', done: true, current: true, hint: 'Kadaluwarsa atau dibatalkan kasir.' });
      }
      return out;
    }
  };

  /* ==================================================================
   * 5. MODUL: VARIANTS (opsi produk)
   * ================================================================== */
  var variants = {
    ctx: null,

    parse: function (raw) {
      var data = safeParse(raw, []);
      if (!Array.isArray(data)) return [];
      return data.map(function (g) {
        var opts = g.options || g.items || g.values || [];
        if (!Array.isArray(opts)) opts = [];
        return {
          name: String(g.name || g.label || 'Opsi'),
          type: (g.type === 'multi' || g.type === 'multiple') ? 'multi' : 'single',
          required: g.required !== false,
          options: opts.map(function (o) {
            if (typeof o === 'string') return { name: o, price: 0 };
            return { name: String(o.name || o.label || ''), price: Number(o.price) || 0 };
          }).filter(function (o) { return o.name; })
        };
      }).filter(function (g) { return g.options.length; });
    },

    open: function (ctx) {
      variants.ctx = ctx;
      var groups = ctx.groups || [];
      var body =
        (ctx.itemName
          ? '<div style="font-weight:700;font-size:15px">' + esc(ctx.itemName) + '</div>' +
            '<div class="muted">Harga dasar: ' + money(ctx.basePrice || 0) + '</div><hr class="rule">'
          : '');

      if (!groups.length) {
        body += '<p class="muted">Produk ini tidak punya varian.</p>';
      } else {
        groups.forEach(function (g, gi) {
          body += '<fieldset class="variant-group">' +
            '<legend class="field-label">' + esc(g.name) +
              (g.required ? ' <span class="req">*</span>' : '') +
              ' <span class="muted">(' + (g.type === 'multi' ? 'boleh pilih beberapa' : 'pilih satu') + ')</span></legend>' +
            g.options.map(function (o, oi) {
              var inputType = g.type === 'multi' ? 'checkbox' : 'radio';
              return '<label class="check-line">' +
                '<input type="' + inputType + '" name="v_grp_' + gi + '" data-gi="' + gi + '" data-oi="' + oi + '">' +
                '<span style="flex:1">' + esc(o.name) + '</span>' +
                '<span style="font-weight:700;color:var(--c-primary)">' + (o.price ? '+' + money(o.price) : 'gratis') + '</span>' +
              '</label>';
            }).join('') +
          '</fieldset>';
        });
      }

      ui.modal(ctx.title || 'Pilih opsi', body,
        '<button type="button" class="btn btn-ghost" data-act="cancel">Batal</button>' +
        '<button type="button" class="btn btn-primary" data-act="ok">Simpan pilihan</button>');

      var foot = el('app-modal-foot');
      foot.querySelector('[data-act="cancel"]').addEventListener('click', function () {
        variants.ctx = null; ui.closeModal();
      });
      foot.querySelector('[data-act="ok"]').addEventListener('click', variants.confirm);
    },

    confirm: function () {
      if (!variants.ctx) { ui.closeModal(); return; }
      var body = el('app-modal-body');
      var selected = [];
      $$('input[data-gi]', body).forEach(function (input) {
        if (!input.checked) return;
        var g = variants.ctx.groups[Number(input.getAttribute('data-gi'))];
        var o = g.options[Number(input.getAttribute('data-oi'))];
        selected.push({ group: g.name, name: o.name, price: o.price });
      });
      var missing = (variants.ctx.groups || []).filter(function (g) {
        return g.required && !selected.some(function (s) { return s.group === g.name; });
      });
      if (missing.length) {
        ui.toast('Pilih dulu: ' + missing.map(function (g) { return g.name; }).join(', '), 'warning');
        return;
      }
      var cb = variants.ctx.onConfirm;
      variants.ctx = null;
      ui.closeModal();
      if (typeof cb === 'function') cb(selected);
    }
  };

  /* ==================================================================
   * 6. MODUL: POS (terminal kasir)
   * ================================================================== */
  var pos = {
    cart: [],
    category: 'Semua',
    orderType: '',
    orderTypeExplicit: false,
    method: 'Cash',
    lastReceipt: null,
    onlineOrders: [],
    queueRows: [],
    users: [],

    /* ---------- init ---------- */
    init: function () {
      pos.renderCategories();
      pos.renderProducts();
      pos.renderCart();
      pos.applySettings();
      pos.loadOnlineOrders();
    },

    loadOnlineOrders: function () {
      return rpc('getOnlineOrders').then(function (rows) {
        pos.onlineOrders = Array.isArray(rows) ? rows : [];
      }).catch(function () { pos.onlineOrders = []; });
    },

    applySettings: function () {
      var s = erp.settings || {};
      var on = function (k) { return String(s[k]) === 'true'; };
      var nameLabel = el('kasir-customer-label');
      var tableLabel = el('kasir-table-label');
      if (nameLabel) nameLabel.textContent = on('RequireCustomerName') ? 'Nama pelanggan *' : 'Nama pelanggan';
      if (tableLabel) tableLabel.textContent = on('RequireTableNumber') ? 'Nomor meja *' : 'Nomor meja';
    },

    /* ---------- katalog ---------- */
    renderCategories: function () {
      var box = el('kasir-categories');
      if (!box) return;
      var cats = ['Semua'];
      (erp.catalog || []).forEach(function (c) {
        var k = String(c.Kategori || 'Lainnya').trim();
        if (cats.indexOf(k) === -1) cats.push(k);
      });
      box.innerHTML = cats.map(function (k) {
        return '<button type="button" class="cat-chip' + (pos.category === k ? ' active' : '') +
          '" data-cat="' + escAttr(k) + '">' + esc(k) + '</button>';
      }).join('');
    },

    renderProducts: function () {
      var grid = el('kasir-products');
      if (!grid) return;
      var q = String((el('kasir-search') || {}).value || '').trim().toLowerCase();
      var items = (erp.catalog || []).filter(function (c) {
        var cat = String(c.Kategori || 'Lainnya').trim();
        if (pos.category !== 'Semua' && cat !== pos.category) return false;
        if (!q) return true;
        return (String(c.NamaMenu || '') + ' ' + String(c.KodeMenu || '')).toLowerCase().indexOf(q) !== -1;
      });
      if (!items.length) {
        grid.innerHTML = '<div class="callout callout-info">Tidak ada menu untuk filter ini.</div>';
        return;
      }
      grid.innerHTML = items.map(function (c, i) {
        var out = String(c.Status) === 'Habis';
        var track = String(c.TrackStok) === 'true';
        var noStock = track && (Number(c.StokProduk) || 0) <= 0;
        var disabled = out || noStock;
        var img = c.FotoURL ? '<img src="' + escAttr(c.FotoURL) + '" alt="' + escAttr(c.NamaMenu) + '" loading="lazy">' : '<span class="ph">☕</span>';
        var flag = disabled ? '<span class="product-flag out">Habis</span>'
          : (track ? '<span class="product-flag in">Sisa ' + num(c.StokProduk) + '</span>' : '');
        return '<article class="product-card anim-rise" style="animation-delay:' + (Math.min(i, 11) * 0.035) + 's">' +
          '<div class="product-media">' + img + flag + '</div>' +
          '<div class="product-body">' +
            '<div class="product-cat">' + esc(c.Kategori || 'Lainnya') + '</div>' +
            '<div class="product-name">' + esc(c.NamaMenu) + '</div>' +
            '<div class="product-meta">' +
              '<span class="product-price">' + money(c.Harga) + '</span>' +
              '<button type="button" class="add-btn" data-add="' + escAttr(c.ID) + '"' +
                (disabled ? ' disabled aria-disabled="true"' : '') +
                ' aria-label="Tambah ' + escAttr(c.NamaMenu) + '"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg></button>' +
            '</div>' +
          '</div>' +
        '</article>';
      }).join('');
    },

    setCategory: function (k) {
      pos.category = k;
      pos.renderCategories();
      pos.renderProducts();
    },

    setOrderType: function (t) {
      pos.orderType = t;
      pos.orderTypeExplicit = true;
      $$('.seg-btn[data-order-type]').forEach(function (b) {
        b.classList.toggle('active', b.dataset.orderType === t);
      });
    },

    addToCart: function (id) {
      var item = (erp.catalog || []).find(function (c) { return String(c.ID) === String(id); });
      if (!item) return;
      if (String(item.Status) === 'Habis' || (String(item.TrackStok) === 'true' && (Number(item.StokProduk) || 0) <= 0)) {
        ui.toast(item.NamaMenu + ' sedang habis.', 'warning');
        return;
      }
      var groups = variants.parse(item.OptionsJSON);
      if (groups.length) {
        variants.open({
          title: 'Pilih opsi', itemName: item.NamaMenu, basePrice: Number(item.Harga) || 0,
          groups: groups,
          onConfirm: function (sel) { pos.pushToCart(item, sel); }
        });
      } else {
        pos.pushToCart(item, []);
      }
    },

    pushToCart: function (item, selected) {
      var extra = (selected || []).reduce(function (s, o) { return s + (Number(o.price) || 0); }, 0);
      var sig = (selected || []).map(function (o) { return o.group + ':' + o.name; }).join('|');
      var key = String(item.ID) + '||' + sig + '||' + pos.orderType;
      var found = pos.cart.find(function (c) { return c.key === key; });
      if (found) found.qty += 1;
      else {
        pos.cart.push({
          uid: uid(), key: key, id: String(item.ID),
          name: String(item.NamaMenu || ''),
          price: (Number(item.Harga) || 0) + extra,
          qty: 1, orderType: pos.orderType,
          options: selected || [],
          optionsText: (selected || []).map(function (o) { return o.name; }).join(', ')
        });
      }
      pos.renderCart();
    },

    changeQty: function (key, delta) {
      pos.cart = pos.cart.map(function (c) {
        if (c.key !== key) return c;
        c.qty += delta;
        return c;
      }).filter(function (c) { return c.qty > 0; });
      pos.renderCart();
    },

    removeItem: function (key) {
      pos.cart = pos.cart.filter(function (c) { return c.key !== key; });
      pos.renderCart();
    },

    cartTotal: function () {
      return pos.cart.reduce(function (s, c) { return s + c.price * c.qty; }, 0);
    },
    cartCount: function () {
      return pos.cart.reduce(function (s, c) { return s + c.qty; }, 0);
    },

    renderCart: function () {
      var box = el('kasir-cart-items');
      if (box) {
        if (!pos.cart.length) {
          box.innerHTML = '<p class="muted">Keranjang kosong. Pilih menu di sebelah kiri.</p>';
        } else {
          box.innerHTML = pos.cart.map(function (c) {
            return '<div class="cart-row">' +
              '<div class="cart-row-main">' +
                '<div class="cart-row-name">' + esc(c.name) + '</div>' +
                '<div class="cart-row-opt">' + esc(c.orderType) + (c.optionsText ? ' · ' + esc(c.optionsText) : '') + '</div>' +
              '</div>' +
              '<div class="stepper">' +
                '<button type="button" data-qty="-1" data-key="' + escAttr(c.key) + '" aria-label="Kurangi"><svg class="ic" aria-hidden="true"><use href="#i-minus"/></svg></button>' +
                '<span>' + c.qty + '</span>' +
                '<button type="button" data-qty="1" data-key="' + escAttr(c.key) + '" aria-label="Tambah"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg></button>' +
              '</div>' +
              '<span class="cart-row-price">' + money(c.price * c.qty) + '</span>' +
              '<button type="button" class="icon-btn" data-del="' + escAttr(c.key) + '" aria-label="Hapus"><svg class="ic" aria-hidden="true"><use href="#i-close"/></svg></button>' +
            '</div>';
          }).join('');
        }
      }
      var count = el('kasir-cart-count');
      if (count) count.textContent = String(pos.cartCount());
      var total = el('kasir-cart-total');
      if (total) total.textContent = money(pos.cartTotal());
    },

    /* ---------- pembayaran ---------- */
    openPayment: function () {
      if (!pos.cart.length) { ui.toast('Keranjang kosong.', 'warning'); return; }
      var s = erp.settings || {};
      var needName = String(s.RequireCustomerName) === 'true';
      var needTable = String(s.RequireTableNumber) === 'true';
      var customer = String((el('kasir-customer') || {}).value || '').trim();
      var table = String((el('kasir-table') || {}).value || '').trim();

      if (needName && !customer) { ui.toast('Nama pelanggan wajib diisi.', 'warning'); el('kasir-customer').focus(); return; }
      if (needTable && !table) { ui.toast('Nomor meja wajib diisi.', 'warning'); el('kasir-table').focus(); return; }
      if (String(s.RequireOrderType) === 'true' && !pos.orderTypeExplicit) {
        ui.toast('Pilih jenis pesanan (Dine In / Takeaway) terlebih dahulu.', 'warning'); return;
      }
      // Bila aturan tidak mewajibkan, tetap ada nilai default yang dikirim ke server.
      if (!pos.orderType) { pos.orderType = 'Dine In'; pos.orderTypeExplicit = true; }

      var total = pos.cartTotal();
      var body =
        '<div class="total-row total-row-strong"><span>Total tagihan</span><strong>' + money(total) + '</strong></div>' +
        '<div class="pay-grid" style="margin-top:14px">' +
          '<label class="pay-card"><input type="radio" name="pos-pay" value="Cash" checked><span class="pay-ic"><svg class="ic" aria-hidden="true"><use href="#i-cash"/></svg></span><span class="pay-label">Tunai</span></label>' +
          '<label class="pay-card"><input type="radio" name="pos-pay" value="Transfer"><span class="pay-ic pay-ic-sky"><svg class="ic" aria-hidden="true"><use href="#i-card"/></svg></span><span class="pay-label">Transfer</span></label>' +
          '<label class="pay-card"><input type="radio" name="pos-pay" value="QRIS"><span class="pay-ic pay-ic-purple"><svg class="ic" aria-hidden="true"><use href="#i-qr"/></svg></span><span class="pay-label">QRIS</span></label>' +
        '</div>' +
        '<div id="pos-cash-box" style="margin-top:18px">' +
          '<label class="field"><span class="field-label">Uang diterima (Rp)</span>' +
            '<input type="number" id="pos-cash-received" min="0" step="100" inputmode="numeric" placeholder="0"></label>' +
          '<div class="row-actions" style="margin-bottom:10px" id="pos-quick-cash"></div>' +
          '<div class="callout callout-ok" id="pos-change-box" hidden></div>' +
        '</div>' +
        '<div id="pos-transfer-box" style="margin-top:18px" hidden>' +
          '<div class="callout callout-info">Pembayaran transfer dicatat manual. Setelah pelanggan transfer, konfirmasi di bawah lalu simpan transaksi. Sistem tidak memeriksa rekening secara otomatis.</div>' +
          '<label class="field" style="margin-top:12px"><span class="field-label">Nomor referensi transfer (opsional)</span>' +
            '<input type="text" id="pos-transfer-ref" placeholder="mis. TRX-0001"></label>' +
        '</div>' +
        '<div id="pos-qris-box" style="margin-top:18px" hidden>' +
          '<div style="text-align:center">' +
            '<img id="pos-qris-img" src="' + escAttr((erp.settings || {}).QrisImage || PLACEHOLDER_IMG) + '" alt="Kode QRIS" style="width:min(240px,64%);aspect-ratio:1;object-fit:contain;border:1px solid var(--c-border);border-radius:12px;background:#fff">' +
          '</div>' +
          '<div class="callout callout-warn" style="margin-top:12px">QRIS tidak diproses otomatis. Kasir wajib memeriksa mutasi rekening secara manual sebelum menekan Simpan.</div>' +
          '<label class="check-line" style="margin-top:10px">' +
            '<input type="checkbox" id="pos-qris-verified">' +
            '<span>Saya sudah memeriksa mutasi QRIS secara manual</span>' +
          '</label>' +
        '</div>';

      ui.modal('Pembayaran', body,
        '<button type="button" class="btn btn-ghost" data-act="cancel">Batal</button>' +
        '<button type="button" class="btn btn-primary" data-act="save">Simpan transaksi</button>');

      pos.method = 'Cash';
      pos.syncPayMethod();

      var foot = el('app-modal-foot');
      foot.querySelector('[data-act="cancel"]').addEventListener('click', ui.closeModal);
      foot.querySelector('[data-act="save"]').addEventListener('click', function () { pos.commit(); });

      var received = el('pos-cash-received');
      if (received) {
        received.addEventListener('input', pos.calcChange);
        pos.renderQuickCash();
      }
      $$('input[name="pos-pay"]', el('app-modal-body')).forEach(function (r) {
        r.addEventListener('change', function () {
          pos.method = r.value;
          pos.syncPayMethod();
        });
      });
    },

    syncPayMethod: function () {
      var cash = el('pos-cash-box'), tr = el('pos-transfer-box'), qr = el('pos-qris-box');
      if (cash) cash.hidden = pos.method !== 'Cash';
      if (tr) tr.hidden = pos.method !== 'Transfer';
      if (qr) qr.hidden = pos.method !== 'QRIS';
      $$('input[name="pos-pay"]', el('app-modal-body')).forEach(function (r) {
        r.checked = (r.value === pos.method);
      });
      if (pos.method === 'Cash') pos.calcChange();
    },

    renderQuickCash: function () {
      var box = el('pos-quick-cash');
      if (!box) return;
      var total = pos.cartTotal();
      var presets = [total, Math.ceil(total / 10000) * 10000, Math.ceil(total / 50000) * 50000, Math.ceil(total / 100000) * 100000];
      var uniq = [];
      presets.forEach(function (v) {
        if (v > 0 && uniq.indexOf(v) === -1) uniq.push(v);
      });
      box.innerHTML = uniq.slice(0, 4).map(function (v) {
        return '<button type="button" class="chip-btn" data-quick="' + v + '">' + money(v) + '</button>';
      }).join('');
    },

    calcChange: function () {
      var input = el('pos-cash-received');
      var box = el('pos-change-box');
      if (!input || !box) return;
      var received = Number(input.value) || 0;
      var total = pos.cartTotal();
      var change = received - total;
      if (received <= 0) {
        box.hidden = true;
        return;
      }
      box.hidden = false;
      box.className = change >= 0 ? 'callout callout-ok' : 'callout callout-danger';
      box.textContent = change >= 0
        ? 'Kembalian: ' + money(change)
        : 'Uang diterima kurang dari tagihan (' + money(total - received) + ').';
    },

    commit: function () {
      var total = pos.cartTotal();
      var cashRec = 0;
      var ref = '';
      if (pos.method === 'Cash') {
        cashRec = Number((el('pos-cash-received') || {}).value) || 0;
        if (cashRec < total) {
          ui.toast('Uang diterima kurang dari total tagihan.', 'warning');
          return;
        }
      } else if (pos.method === 'Transfer') {
        ref = String((el('pos-transfer-ref') || {}).value || '').trim();
      } else {
        var verified = el('pos-qris-verified');
        if (!verified || !verified.checked) {
          ui.toast('Centang dulu bahwa mutasi QRIS sudah Anda periksa secara manual.', 'warning');
          return;
        }
      }
      pos.saveTransaction(total, cashRec, ref);
    },

    saveTransaction: function (total, cashRec, ref) {
      var customer = String((el('kasir-customer') || {}).value || '').trim();
      var table = String((el('kasir-table') || {}).value || '').trim();
      var items = pos.cart.map(function (c) {
        var label = c.name + (c.optionsText ? ' (' + c.optionsText + ')' : '');
        return { id: c.id, name: label, qty: c.qty, price: c.price, orderType: c.orderType || '-' };
      });
      var payload = {
        kasir: session.user || '-',
        namaKaryawan: session.user || '-',
        total: total,
        metode: pos.method,
        items: items,
        pelanggan: customer || '-',
        meja: table || '-',
        cashRec: cashRec || 0
      };
      var foot = el('app-modal-foot');
      if (foot) {
        var btn = foot.querySelector('[data-act="save"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan…'; }
      }

      rpc('saveTransaction', { data: payload }).then(function (r) {
        if (!r || !r.success) {
          ui.toast((r && r.message) || 'Gagal menyimpan transaksi.', 'error');
          return;
        }
        pos.lastReceipt = {
          id: r.id || '-',
          queue: r.queueNumber || '',
          tanggal: new Date(),
          kasir: session.user || '-',
          metode: pos.method,
          pelanggan: customer || '-',
          meja: table || '-',
          items: items,
          total: total,
          cashRec: cashRec || 0,
          change: Math.max(0, (cashRec || 0) - total),
          ref: ref
        };
        pos.cart = [];
        pos.renderCart();
        pos.renderProducts();
        ui.closeModal();
        ui.toast('Transaksi tersimpan' + (r.queueNumber ? ' · antrean ' + r.queueNumber : '') + '.', 'success');
        pos.showReceipt(pos.lastReceipt);
        erp.refresh();
      }).catch(function (e) {
        ui.toast(e.message, 'error');
      }).finally(function () {
        if (foot) {
          var b2 = foot.querySelector('[data-act="save"]');
          if (b2) { b2.disabled = false; b2.textContent = 'Simpan transaksi'; }
        }
      });
    },

    /* ---------- struk ---------- */
    showReceipt: function (rc) {
      var s = erp.settings || {};
      var head = s.ReceiptHeader || ((s.StoreName || 'My Kasir') + '\n' + (s.StoreAddress || '') + (s.StorePhone ? '\nTelp ' + s.StorePhone : ''));
      var rows = (rc.items || []).map(function (it) {
        return '<tr><td>' + esc(it.name) + '</td><td class="rc-right">' + (Number(it.qty) || 0) + '</td>' +
          '<td class="rc-right">' + money((Number(it.price) || 0) * (Number(it.qty) || 0)) + '</td></tr>';
      }).join('');
      var body =
        '<div class="print-area" style="display:block">' +
          '<div class="rc-head">' + esc(head) + '</div>' +
          '<table><tbody>' +
            '<tr><td>Ref</td><td class="rc-right">' + esc(rc.id) + '</td></tr>' +
            '<tr><td>Waktu</td><td class="rc-right">' + esc(fmtDateTime(rc.tanggal)) + '</td></tr>' +
            '<tr><td>Kasir</td><td class="rc-right">' + esc(rc.kasir) + '</td></tr>' +
            (rc.pelanggan && rc.pelanggan !== '-' ? '<tr><td>Pelanggan</td><td class="rc-right">' + esc(rc.pelanggan) + '</td></tr>' : '') +
            (rc.meja && rc.meja !== '-' ? '<tr><td>Meja</td><td class="rc-right">' + esc(rc.meja) + '</td></tr>' : '') +
            (rc.queue ? '<tr><td>Antrean</td><td class="rc-right">' + esc(rc.queue) + '</td></tr>' : '') +
            (rc.ref ? '<tr><td>Ref transfer</td><td class="rc-right">' + esc(rc.ref) + '</td></tr>' : '') +
          '</tbody></table>' +
          '<table><tbody>' + rows + '</tbody></table>' +
          '<div class="rc-total">TOTAL ' + money(rc.total) + '</div>' +
          (rc.cashRec > 0 ? '<table><tbody><tr><td>Tunai</td><td class="rc-right">' + money(rc.cashRec) + '</td></tr>' +
            '<tr><td>Kembalian</td><td class="rc-right">' + money(rc.change) + '</td></tr></tbody></table>' : '') +
          '<div class="rc-foot">' + esc(s.ReceiptFooter || 'Terima kasih atas kunjungan Anda!') + '</div>' +
        '</div>';

      ui.modal('Struk transaksi', body,
        '<button type="button" class="btn btn-ghost" data-act="close">Tutup</button>' +
        '<button type="button" class="btn btn-primary" data-act="print"><svg class="ic" aria-hidden="true"><use href="#i-print"/></svg> Cetak</button>');
      var foot = el('app-modal-foot');
      foot.querySelector('[data-act="close"]').addEventListener('click', ui.closeModal);
      foot.querySelector('[data-act="print"]').addEventListener('click', pos.printReceipt);
    },

    printReceipt: function () {
      var area = el('print-area');
      var modalBody = el('app-modal-body');
      if (!area) return;
      area.innerHTML = modalBody ? modalBody.innerHTML : '';
      window.print();
    },

    /* ---------- aturan transaksi ---------- */
    openRules: function () {
      var s = erp.settings || {};
      var on = function (k) { return String(s[k]) === 'true'; };
      var isOwner = session.role === 'Owner';
      var body =
        '<p class="muted">Aturan yang sedang berlaku. Kasir hanya boleh mengubah aturan di bawah ini; Owner dapat mengatur semuanya dari menu Owner → Pengaturan.</p>' +
        '<label class="check-line"><input type="checkbox" id="pr-cname"' + (on('RequireCustomerName') ? ' checked' : '') + '> Nama pelanggan wajib diisi</label>' +
        '<label class="check-line"><input type="checkbox" id="pr-cmeja"' + (on('RequireTableNumber') ? ' checked' : '') + '> Nomor meja wajib diisi</label>' +
        '<label class="check-line"><input type="checkbox" id="pr-ordertype"' + (on('RequireOrderType') ? ' checked' : '') + '> Kasir wajib memilih Dine In / Takeaway</label>' +
        '<label class="check-line"><input type="checkbox" id="pr-queue"' + (on('RequireQueue') ? ' checked' : '') + '> Beri nomor antrean pada transaksi</label>' +
        '<label class="check-line"><input type="checkbox" id="pr-online"' + (on('OnlineOrderEnabled') ? ' checked' : '') + '> Buka pesanan online (toko publik)</label>';

      ui.modal('Aturan transaksi', body,
        '<button type="button" class="btn btn-ghost" data-act="cancel">Batal</button>' +
        '<button type="button" class="btn btn-primary" data-act="ok">Simpan</button>');

      var foot = el('app-modal-foot');
      foot.querySelector('[data-act="cancel"]').addEventListener('click', ui.closeModal);
      foot.querySelector('[data-act="ok"]').addEventListener('click', function () {
        var chk = function (id) { var e = el(id); return String(!!(e && e.checked)); };
        var payload = {
          RequireCustomerName: chk('pr-cname'),
          RequireTableNumber: chk('pr-cmeja'),
          RequireOrderType: chk('pr-ordertype'),
          RequireQueue: chk('pr-queue'),
          OnlineOrderEnabled: chk('pr-online')
        };
        rpc('saveAllSettings', { settingsObj: payload }).then(function (r) {
          if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal menyimpan aturan.', 'error'); return; }
          ui.closeModal();
          ui.toast('Aturan tersimpan.', 'success');
          erp.refresh();
        }).catch(function (e) { ui.toast(e.message, 'error'); });
      });
    },

    /* ---------- pesanan online ---------- */
    openOnlineOrders: function () {
      ui.modal('Pesanan online', '<p class="muted">Memuat…</p>',
        '<button type="button" class="btn btn-ghost" data-act="close">Tutup</button>');
      var foot = el('app-modal-foot');
      foot.querySelector('[data-act="close"]').addEventListener('click', ui.closeModal);

      pos.loadOnlineOrders().then(function () {
        var body = el('app-modal-body');
        if (!pos.onlineOrders.length) {
          body.innerHTML = '<p class="muted">Belum ada pesanan online.</p>';
          return;
        }
        body.innerHTML = pos.onlineOrders.slice().reverse().map(function (o) {
          var statusBayar = String(o.StatusBayar || '');
          var statusOrder = String(o.StatusOrder || '');
          var cls = statusBayar === 'Lunas' ? 'badge-ok' : (statusBayar === 'Kadaluarsa' ? 'badge-danger' : 'badge-warn');
          var nextStatuses = o.JenisOrder === 'Delivery'
            ? ['Sedang Disiapkan', 'On Delivery', 'Sudah Diantar', 'Dibatalkan']
            : ['Sedang Disiapkan', 'Selesai & Bisa Diambil', 'Sudah Diambil', 'Dibatalkan'];
          return '<div class="panel" style="margin-bottom:12px">' +
            '<div class="panel-head">' +
              '<div><strong>' + esc(o.KodeOrder) + '</strong><div class="muted">' + esc(o.NamaCustomer || '-') + ' · ' + esc(o.JenisOrder || '-') + ' · ' + esc(o.Metode || '-') + '</div></div>' +
              '<span class="badge ' + cls + '">' + esc(statusBayar) + '</span>' +
            '</div>' +
            '<div class="muted">Status pesanan: ' + esc(statusOrder) + ' · Total ' + money(o.Total) +
              (o.JarakKm ? ' · jarak ' + num(o.JarakKm) + ' km' : '') + '</div>' +
            '<div class="row-actions" style="margin-top:12px">' +
              (statusBayar !== 'Lunas' && statusBayar !== 'Kadaluarsa'
                ? '<button type="button" class="btn btn-soft btn-sm" data-confirm-pay="' + escAttr(o.ID) + '">Pembayaran diterima</button>'
                : '') +
              nextStatuses.map(function (s) {
                return '<button type="button" class="btn btn-ghost btn-sm" data-set-status="' + escAttr(o.ID) + '" data-status="' + escAttr(s) + '">' + esc(s) + '</button>';
              }).join('') +
            '</div>' +
          '</div>';
        }).join('');
      });
    },

    confirmOnlinePayment: function (id) {
      rpc('confirmOnlinePayment', { id: id, kasirUsername: session.user || '-' }).then(function (r) {
        if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal mengonfirmasi.', 'error'); return; }
        ui.toast('Pembayaran dikonfirmasi manual oleh ' + (session.user || 'kasir') + '.', 'success');
        pos.openOnlineOrders();
        erp.refresh();
      }).catch(function (e) { ui.toast(e.message, 'error'); });
    },

    setOnlineStatus: function (id, status) {
      rpc('updateOnlineOrderStatus', { id: id, status: status, kasirUsername: session.user || '-' }).then(function (r) {
        if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal mengubah status.', 'error'); return; }
        ui.toast('Status pesanan: ' + status + '.', 'success');
        pos.openOnlineOrders();
        erp.refresh();
      }).catch(function (e) { ui.toast(e.message, 'error'); });
    },

    /* ---------- antrean ---------- */
    openQueue: function () {
      ui.modal('Antrean hari ini', '<p class="muted">Memuat…</p>',
        '<button type="button" class="btn btn-ghost" data-act="close">Tutup</button>');
      var foot = el('app-modal-foot');
      foot.querySelector('[data-act="close"]').addEventListener('click', ui.closeModal);

      rpc('getActiveQueues').then(function (r) {
        var rows = (r && r.data) || [];
        pos.queueRows = rows;
        var body = el('app-modal-body');
        if (!rows.length) {
          body.innerHTML = '<p class="muted">Tidak ada antrean aktif. Aktifkan "RequireQueue" di pengaturan kasir untuk memberi nomor antrean.</p>';
          return;
        }
        body.innerHTML = rows.map(function (q) {
          var ready = String(q.status) === 'Selesai';
          return '<div class="cart-row" style="margin-bottom:8px">' +
            '<div class="cart-row-main">' +
              '<div class="cart-row-name">' + esc(q.qNum) + '</div>' +
              '<div class="cart-row-opt">' + esc(q.customer || '-') + ' · ' +
                esc((q.items || []).map(function (i) { return i.name + ' ×' + (Number(i.qty) || 1); }).join(', ')) + '</div>' +
            '</div>' +
            '<span class="badge ' + (ready ? 'badge-ok' : 'badge-warn') + '">' + esc(q.status || '-') + '</span>' +
            '<button type="button" class="btn btn-soft btn-sm" data-queue-ready="' + escAttr(q.id) + '" data-qnum="' + escAttr(q.qNum) + '">Selesai</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-queue-call="' + escAttr(q.qNum) + '">Panggil</button>' +
          '</div>';
        }).join('') +
          '<button type="button" class="btn btn-outline-danger btn-sm" data-queue-reset>Reset nomor antrean hari ini</button>';
      }).catch(function (e) {
        el('app-modal-body').innerHTML = '<div class="callout callout-danger">' + esc(e.message) + '</div>';
      });
    },

    setQueueReady: function (id, qNum) {
      rpc('updateQueueStatus', { id: id, status: 'Selesai', qNum: qNum }).then(function (r) {
        if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal mengubah status antrean.', 'error'); return; }
        ui.toast('Antrean ' + qNum + ' ditandai siap diambil.', 'success');
        pos.openQueue();
      }).catch(function (e) { ui.toast(e.message, 'error'); });
    },

    resetQueue: function () {
      ui.confirm('Reset antrean',
        'Nomor antrean hari ini akan direset dan seluruh antrean hari ini ditandai dihapus. Lanjutkan?',
        function () {
          rpc('resetQueueCounter').then(function (r) {
            if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal reset antrean.', 'error'); return; }
            ui.toast('Nomor antrean direset.', 'success');
            pos.openQueue();
          }).catch(function (e) { ui.toast(e.message, 'error'); });
        }, 'Reset');
    },

    callQueueAgain: function (qNum) {
      rpc('callQueueAgain', { qNum: qNum }).then(function (r) {
        if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal memanggil ulang.', 'error'); return; }
        ui.toast('Antrean ' + qNum + ' dipanggil ulang.', 'success');
      }).catch(function (e) { ui.toast(e.message, 'error'); });
    }
  };

  /* ==================================================================
   * 7. MODUL: ERP (portal owner)
   * ================================================================== */
  var erp = {
    state: { catalog: [], stock: [], transactions: [], expenses: [], onlineOrders: [], settings: {} },
    catalog: [],
    stock: [],
    transactions: [],
    expenses: [],
    onlineOrders: [],
    settings: {},
    users: [],
    tab: 'dashboard',
    catalogCat: 'Semua',
    newStockRows: [],
    editing: { stockId: null, catalogId: null, userName: null },

    init: function () {
      erp.tab = 'dashboard';
      erp.switchTab('dashboard');
    },

    switchTab: function (tab) {
      erp.tab = tab;
      ['dashboard', 'stock', 'catalog', 'expense', 'users', 'settings'].forEach(function (t) {
        var p = el('erp-' + t);
        if (p) p.hidden = (t !== tab);
      });
      $$('#erp-nav .erp-nav-btn').forEach(function (b) {
        b.classList.toggle('active', b.dataset.tab === tab);
      });
      if (tab === 'dashboard') erp.renderDashboard();
      if (tab === 'stock') erp.renderStock();
      if (tab === 'catalog') erp.renderCatalog();
      if (tab === 'expense') { erp.renderExpenseStockPicker(); erp.renderExpenseHistory(); erp.renderExpenseTotal(); }
      if (tab === 'users') erp.renderUsers();
      if (tab === 'settings') erp.renderSettings();
    },

    /* ---------- muat data ---------- */
    refresh: function () {
      return rpc('getDashboardData').then(function (d) {
        if (!d) throw new Error('Data dashboard kosong.');
        if (d.error) throw new Error(d.error);
        erp.catalog = d.catalog || [];
        erp.stock = d.stock || [];
        erp.transactions = d.transactions || [];
        erp.expenses = d.expenses || [];
        erp.onlineOrders = d.onlineOrders || [];
        erp.settings = d.settings || {};
        erp.state = d;
        pos.applySettings();
        pos.renderCategories();
        pos.renderProducts();
        if (erp.tab === 'dashboard') erp.renderDashboard();
        if (erp.tab === 'stock') erp.renderStock();
        if (erp.tab === 'catalog') erp.renderCatalog();
        if (erp.tab === 'expense') { erp.renderExpenseStockPicker(); erp.renderExpenseHistory(); erp.renderExpenseTotal(); }
        if (erp.tab === 'settings') erp.renderSettings();
        var sync = el('erp-sync-label');
        if (sync) sync.textContent = 'Terakhir dimuat ' + fmtTime(new Date());
      }).catch(function (e) {
        var sync = el('erp-sync-label');
        if (sync) sync.textContent = 'Gagal sinkron';
        ui.toast(e.message, 'error');
        if (/Sesi|token|login/i.test(e.message)) { session.clear(); session.paint(); }
      });
    },

    serverToday: function () {
      return String(erp.settings.ServerToday || todayKey());
    },

    /* ---------- dashboard ---------- */
    renderDashboard: function () {
      var dateInput = el('erp-date');
      var date = (dateInput && dateInput.value) || erp.serverToday();
      if (dateInput && !dateInput.value) dateInput.value = date;

      var trx = erp.transactions.filter(function (t) { return dateKey(t.Tanggal) === date; });
      var exp = erp.expenses.filter(function (e) { return dateKey(e.Tanggal) === date; });
      var income = trx.reduce(function (a, t) { return a + (Number(t.Total) || 0); }, 0);
      var expense = exp.reduce(function (a, e) { return a + (Number(e.Total) || 0); }, 0);
      var ids = {};
      trx.forEach(function (t) { ids[t.ID] = 1; });
      var count = Object.keys(ids).length;

      var byMethod = {};
      trx.forEach(function (t) {
        var m = String(t.Metode || 'Lainnya');
        byMethod[m] = (byMethod[m] || 0) + (Number(t.Total) || 0);
      });
      var cash = byMethod.Cash || 0, qr = byMethod.QRIS || 0, tr = byMethod.Transfer || 0;
      var others = Object.keys(byMethod).filter(function (k) { return ['Cash', 'QRIS', 'Transfer'].indexOf(k) === -1; })
        .reduce(function (a, k) { return a + byMethod[k]; }, 0);

      var kpis = el('erp-kpis');
      if (kpis) {
        kpis.innerHTML = [
          { cls: 'k-indigo', ic: '#i-trending', label: 'Omzet', value: money(income), foot: count + ' transaksi · ' + date },
          { cls: 'k-rose', ic: '#i-coins', label: 'Pengeluaran', value: money(expense), foot: exp.length + ' catatan pengeluaran' },
          { cls: 'k-emerald', ic: '#i-savings', label: 'Laba kotor', value: money(income - expense), foot: income > 0 ? ('Margin ' + Math.round((income - expense) / income * 100) + '%') : 'Belum ada omzet' },
          { cls: 'k-sky', ic: '#i-receipt', label: 'Rata-rata / transaksi', value: money(count ? income / count : 0), foot: 'Tunai ' + money(cash) }
        ].map(function (k, i) {
          return '<div class="kpi ' + k.cls + ' anim-zoom" style="animation-delay:' + (i * 0.07) + 's">' +
            '<div class="kpi-top"><span class="kpi-label">' + esc(k.label) + '</span>' +
            '<span class="kpi-ic"><svg class="ic" aria-hidden="true"><use href="' + k.ic + '"/></svg></span></div>' +
            '<div class="kpi-value">' + esc(k.value) + '</div>' +
            '<div class="kpi-foot">' + esc(k.foot) + '</div>' +
          '</div>';
        }).join('');
      }

      var low = erp.stock.filter(function (x) { return (Number(x.Qty) || 0) <= (Number(x.BatasMinimum) || 0); });
      var callout = el('erp-low-stock-callout');
      if (callout) {
        if (low.length) {
          callout.hidden = false;
          callout.innerHTML = '<strong>' + low.length + ' bahan menipis.</strong> ' +
            low.map(function (x) { return esc(x.NamaBarang) + ' (' + num(x.Qty) + ' ' + esc(x.Satuan || '') + ')'; }).join(' · ') +
            ' — catat pengeluaran untuk menambah stok.';
        } else {
          callout.hidden = true;
          callout.textContent = '';
        }
      }

      var label = el('erp-trx-count-label');
      if (label) label.textContent = count + ' transaksi';

      var tbody = el('erp-trx-table').querySelector('tbody');
      if (tbody) {
        tbody.innerHTML = trx.length ? trx.slice().reverse().map(function (t) {
          var m = String(t.Metode || '-');
          var badge = m === 'Cash' ? 'badge-ok' : (m === 'QRIS' ? 'badge-purple' : 'badge-sky');
          return '<tr>' +
            '<td class="ref">' + esc(t.ID) + '</td>' +
            '<td>' + esc(fmtTime(t.Tanggal)) + '</td>' +
            '<td>' + esc(t.NamaKaryawan || t.Kasir || '-') + '</td>' +
            '<td><span class="badge ' + badge + '">' + esc(m) + '</span></td>' +
            '<td class="num"><strong>' + money(t.Total) + '</strong></td>' +
            '<td class="row-actions-cell">' +
              '<button type="button" class="btn btn-ghost btn-sm" data-trx-view="' + escAttr(t.ID) + '">Detail</button>' +
              '<button type="button" class="btn btn-outline-danger btn-sm" data-trx-del="' + escAttr(t.ID) + '">Hapus</button>' +
            '</td>' +
          '</tr>';
        }).join('') : '<tr><td colspan="6"><p class="muted" style="padding:22px;text-align:center">Tidak ada transaksi pada tanggal ini.</p></td></tr>';
      }

      erp.renderChart();
      erp.renderPaymentStrip(cash, qr, tr + others);
    },

    renderPaymentStrip: function (cash, qr, other) {
      var legend = el('erp-chart-legend');
      if (!legend) return;
      var total = cash + qr + other;
      if (!total) { legend.innerHTML = '<span class="muted">Belum ada pembayaran pada tanggal ini.</span>'; return; }
      var rows = [
        { name: 'Tunai', v: cash, color: '#10b981' },
        { name: 'QRIS', v: qr, color: '#8b5cf6' },
        { name: 'Transfer / lainnya', v: other, color: '#06b6d4' }
      ].filter(function (r) { return r.v > 0; });
      legend.innerHTML = rows.map(function (r) {
        return '<span class="legend-item"><span class="legend-swatch" style="background:' + r.color + '"></span>' +
          esc(r.name) + ' ' + Math.round(r.v / total * 100) + '% · ' + money(r.v) + '</span>';
      }).join('');
    },

    renderChart: function () {
      var wrap = el('erp-chart');
      if (!wrap) return;
      var days = [];
      for (var i = 6; i >= 0; i--) {
        var d = new Date();
        d.setDate(d.getDate() - i);
        days.push(dateKey(d));
      }
      var income = days.map(function () { return 0; });
      var expense = days.map(function () { return 0; });
      erp.transactions.forEach(function (t) {
        var idx = days.indexOf(dateKey(t.Tanggal));
        if (idx > -1) income[idx] += (Number(t.Total) || 0);
      });
      erp.expenses.forEach(function (e) {
        var idx = days.indexOf(dateKey(e.Tanggal));
        if (idx > -1) expense[idx] += (Number(e.Total) || 0);
      });

      var max = Math.max.apply(null, income.concat(expense).concat([1]));
      var W = 700, H = 240, padL = 54, padR = 12, padT = 14, padB = 30;
      var innerW = W - padL - padR, innerH = H - padT - padB;
      var stepX = innerW / (days.length - 1 || 1);

      function pts(series) {
        return series.map(function (v, i) {
          var x = padL + i * stepX;
          var y = padT + innerH - (v / max) * innerH;
          return [x, y];
        });
      }
      function path(series) {
        return pts(series).map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
      }
      function area(series) {
        var p = pts(series);
        return path(series) + ' L' + p[p.length - 1][0].toFixed(1) + ' ' + (padT + innerH) + ' L' + p[0][0].toFixed(1) + ' ' + (padT + innerH) + ' Z';
      }

      var gridlines = '';
      for (var g = 0; g <= 4; g++) {
        var gy = padT + innerH - (g / 4) * innerH;
        gridlines += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(1) +
          '" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4 4"/>' +
          '<text x="' + (padL - 8) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="#94a3b8">' +
          esc(shortMoney((g / 4) * max)) + '</text>';
      }
      var labels = days.map(function (k, i) {
        var d = new Date(k + 'T00:00:00');
        var x = padL + i * stepX;
        return '<text x="' + x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#94a3b8">' +
          esc(d.getDate() + '/' + (d.getMonth() + 1)) + '</text>';
      }).join('');

      var incomePts = pts(income), expensePts = pts(expense);
      function dots(p, color, lastFill) {
        return p.map(function (q, i) {
          return '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="' + (lastFill && i === p.length - 1 ? 5 : 4) +
            '" fill="#fff" stroke="' + color + '" stroke-width="3"/>';
        }).join('');
      }

      wrap.innerHTML =
        '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Grafik arus kas 7 hari terakhir">' +
          '<defs>' +
            '<linearGradient id="gIncome" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#10b981" stop-opacity=".28"/><stop offset="100%" stop-color="#10b981" stop-opacity="0"/></linearGradient>' +
            '<linearGradient id="gExpense" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f43f5e" stop-opacity=".22"/><stop offset="100%" stop-color="#f43f5e" stop-opacity="0"/></linearGradient>' +
          '</defs>' +
          gridlines + labels +
          '<path d="' + area(income) + '" fill="url(#gIncome)"/>' +
          '<path d="' + area(expense) + '" fill="url(#gExpense)"/>' +
          '<path d="' + path(income) + '" fill="none" stroke="#10b981" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>' +
          '<path d="' + path(expense) + '" fill="none" stroke="#f43f5e" stroke-width="3" stroke-dasharray="5 4" stroke-linejoin="round" stroke-linecap="round"/>' +
          dots(incomePts, '#10b981', true) +
          dots(expensePts, '#f43f5e', false) +
        '</svg>';
    },

    viewTransaction: function (id) {
      var t = erp.transactions.find(function (x) { return String(x.ID) === String(id); });
      if (!t) { ui.toast('Transaksi tidak ditemukan.', 'error'); return; }
      var items = safeParse(t.ItemsJSON, []) || [];
      var body =
        '<div class="total-row"><span>Ref</span><strong>' + esc(t.ID) + '</strong></div>' +
        '<div class="total-row"><span>Waktu</span><strong>' + esc(fmtDateTime(t.Tanggal)) + '</strong></div>' +
        '<div class="total-row"><span>Kasir</span><strong>' + esc(t.NamaKaryawan || t.Kasir || '-') + '</strong></div>' +
        '<div class="total-row"><span>Metode</span><strong>' + esc(t.Metode || '-') + '</strong></div>' +
        '<div class="total-row"><span>Pelanggan</span><strong>' + esc(t.Pelanggan || '-') + '</strong></div>' +
        '<div class="total-row"><span>Meja</span><strong>' + esc(t.Meja || '-') + '</strong></div>' +
        '<hr class="rule">' +
        items.map(function (it) {
          return '<div class="total-row"><span>' + esc(it.name) + ' × ' + (Number(it.qty) || 0) + '</span>' +
            '<strong>' + money((Number(it.price) || 0) * (Number(it.qty) || 0)) + '</strong></div>';
        }).join('') +
        '<div class="total-row total-row-strong"><span>Total</span><strong>' + money(t.Total) + '</strong></div>';
      ui.modal('Detail transaksi', body, '<button type="button" class="btn btn-primary" data-act="close">Tutup</button>');
      el('app-modal-foot').querySelector('[data-act="close"]').addEventListener('click', ui.closeModal);
    },

    deleteTransaction: function (id) {
      ui.modal('Hapus transaksi',
        '<label class="field"><span class="field-label">Password Owner</span><input type="password" id="del-trx-pass" autocomplete="current-password"></label>' +
        '<p class="muted">Transaksi <strong>' + esc(id) + '</strong> akan dihapus permanen dari laporan.</p>',
        '<button type="button" class="btn btn-ghost" data-act="cancel">Batal</button>' +
        '<button type="button" class="btn btn-danger" data-act="ok">Hapus</button>');
      var foot = el('app-modal-foot');
      foot.querySelector('[data-act="cancel"]').addEventListener('click', ui.closeModal);
      foot.querySelector('[data-act="ok"]').addEventListener('click', function () {
        var pass = String((el('del-trx-pass') || {}).value || '');
        if (!pass) { ui.toast('Masukkan password Owner.', 'warning'); return; }
        rpc('deleteTransaction', { password: pass, trxId: id }).then(function (r) {
          if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal menghapus transaksi.', 'error'); return; }
          ui.closeModal();
          ui.toast('Transaksi dihapus.', 'success');
          erp.refresh();
        }).catch(function (e) { ui.toast(e.message, 'error'); });
      });
    },

    /* ---------- stok ---------- */
    renderStock: function () {
      var tbody = el('erp-stock-table').querySelector('tbody');
      if (!tbody) return;
      if (!erp.stock.length) {
        tbody.innerHTML = '<tr><td colspan="6"><p class="muted" style="padding:22px;text-align:center">Belum ada bahan baku.</p></td></tr>';
        return;
      }
      tbody.innerHTML = erp.stock.map(function (x) {
        var qty = Number(x.Qty) || 0;
        var batas = Number(x.BatasMinimum) || 0;
        var low = qty <= batas;
        return '<tr>' +
          '<td><strong>' + esc(x.NamaBarang) + '</strong><div class="muted">' + esc(x.ID) + '</div></td>' +
          '<td>' + esc(x.Satuan || '-') + '</td>' +
          '<td class="num"><strong style="color:' + (low ? 'var(--c-error)' : 'var(--c-secondary)') + '">' + num(qty) + '</strong></td>' +
          '<td class="num">' + num(batas) + '</td>' +
          '<td><span class="badge ' + (low ? 'badge-warn' : 'badge-ok') + '">' + (low ? 'MENIPIS' : 'AMAN') + '</span></td>' +
          '<td class="row-actions-cell">' +
            '<button type="button" class="btn btn-ghost btn-sm" data-stock-inc="' + escAttr(x.ID) + '" data-delta="1" aria-label="Tambah qty">+1</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-stock-inc="' + escAttr(x.ID) + '" data-delta="-1" aria-label="Kurangi qty">−1</button>' +
            '<button type="button" class="btn btn-soft btn-sm" data-stock-edit="' + escAttr(x.ID) + '">Edit</button>' +
            '<button type="button" class="btn btn-outline-danger btn-sm" data-stock-del="' + escAttr(x.ID) + '">Hapus</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    },

    adjustStock: function (id, delta) {
      var x = erp.stock.find(function (s) { return String(s.ID) === String(id); });
      if (!x) return;
      var next = Math.max(0, (Number(x.Qty) || 0) + delta);
      rpc('updateStockQty', { id: id, newQty: next }).then(function (r) {
        if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal memperbarui qty.', 'error'); return; }
        ui.toast(x.NamaBarang + ' → ' + num(next) + ' ' + (x.Satuan || ''), 'success');
        erp.refresh();
      }).catch(function (e) { ui.toast(e.message, 'error'); });
    },

    openStockForm: function (id) {
      erp.editing.stockId = id || null;
      var x = id ? erp.stock.find(function (s) { return String(s.ID) === String(id); }) : null;
      ui.modal(x ? 'Edit bahan' : 'Tambah bahan',
        '<label class="field"><span class="field-label">Nama bahan</span><input type="text" id="st-name" value="' + escAttr(x ? x.NamaBarang : '') + '"></label>' +
        '<div class="grid-2">' +
          '<label class="field"><span class="field-label">Qty</span><input type="number" id="st-qty" min="0" step="0.01" value="' + (x ? escAttr(x.Qty) : '0') + '"></label>' +
          '<label class="field"><span class="field-label">Satuan</span><input type="text" id="st-unit" value="' + escAttr(x ? (x.Satuan || 'pcs') : 'pcs') + '"></label>' +
        '</div>' +
        '<label class="field"><span class="field-label">Batas minimum</span><input type="number" id="st-min" min="0" step="0.01" value="' + (x ? escAttr(x.BatasMinimum) : '5') + '"></label>',
        '<button type="button" class="btn btn-ghost" data-act="cancel">Batal</button>' +
        '<button type="button" class="btn btn-primary" data-act="ok">Simpan</button>');
      var foot = el('app-modal-foot');
      foot.querySelector('[data-act="cancel"]').addEventListener('click', ui.closeModal);
      foot.querySelector('[data-act="ok"]').addEventListener('click', function () {
        var name = String((el('st-name') || {}).value || '').trim();
        if (!name) { ui.toast('Nama bahan wajib diisi.', 'warning'); return; }
        var data = {
          action: erp.editing.stockId ? 'edit' : 'add',
          ID: erp.editing.stockId || '',
          NamaBarang: name,
          Qty: Number((el('st-qty') || {}).value) || 0,
          Satuan: String((el('st-unit') || {}).value || 'pcs').trim(),
          BatasMinimum: Number((el('st-min') || {}).value) || 0
        };
        rpc('saveStock', { data: data }).then(function (r) {
          if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal menyimpan bahan.', 'error'); return; }
          ui.closeModal();
          ui.toast('Bahan tersimpan.', 'success');
          erp.refresh();
        }).catch(function (e) { ui.toast(e.message, 'error'); });
      });
    },

    deleteStock: function (id) {
      var x = erp.stock.find(function (s) { return String(s.ID) === String(id); });
      ui.confirm('Hapus bahan', 'Hapus "' + ((x && x.NamaBarang) || id) + '" dari daftar stok?',
        function () {
          rpc('saveStock', { data: { action: 'delete', ID: id } }).then(function (r) {
            if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal menghapus bahan.', 'error'); return; }
            ui.toast('Bahan dihapus.', 'success');
            erp.refresh();
          }).catch(function (e) { ui.toast(e.message, 'error'); });
        });
    },

    /* ---------- katalog ---------- */
    renderCatalog: function () {
      var grid = el('erp-catalog-grid');
      if (!grid) return;
      var cats = ['Semua'];
      erp.catalog.forEach(function (c) {
        var k = String(c.Kategori || 'Lainnya').trim();
        if (cats.indexOf(k) === -1) cats.push(k);
      });
      var chipBox = el('erp-catalog-categories');
      if (chipBox) {
        chipBox.innerHTML = cats.map(function (k) {
          var n = k === 'Semua' ? erp.catalog.length
            : erp.catalog.filter(function (c) { return String(c.Kategori || 'Lainnya').trim() === k; }).length;
          return '<button type="button" class="cat-chip" data-erp-cat="' + escAttr(k) + '">' + esc(k) + ' (' + n + ')</button>';
        }).join('');
      }

      var items = erp.catalog.filter(function (c) {
        return erp.catalogCat === 'Semua' || String(c.Kategori || 'Lainnya').trim() === erp.catalogCat;
      });
      if (!items.length) {
        grid.innerHTML = '<div class="callout callout-info">Belum ada produk di katalog.</div>';
        return;
      }
      grid.innerHTML = items.map(function (c) {
        var img = c.FotoURL ? '<img src="' + escAttr(c.FotoURL) + '" alt="' + escAttr(c.NamaMenu) + '" loading="lazy">' : '<span class="ph">☕</span>';
        var habis = String(c.Status) === 'Habis';
        var track = String(c.TrackStok) === 'true';
        var opts = variants.parse(c.OptionsJSON).length;
        return '<article class="owner-card">' +
          '<div class="product-media">' + img + (habis ? '<span class="product-flag out">Habis</span>' : '') + '</div>' +
          '<div class="owner-card-body">' +
            '<div class="product-cat">' + esc(c.Kategori || 'Lainnya') + ' · ' + esc(c.KodeMenu || '-') + '</div>' +
            '<div class="product-name">' + esc(c.NamaMenu) + '</div>' +
            '<div class="product-price">' + money(c.Harga) + '</div>' +
            '<div class="muted">' +
              (track ? 'Stok produk: ' + num(c.StokProduk) : 'Tanpa stok produk') +
              (opts ? ' · ' + opts + ' grup varian' : '') +
              (String(c.BahanStockID || '') ? ' · ' + esc(String(c.BahanStockID).split(',').length) + ' bahan' : '') +
            '</div>' +
            '<div class="owner-card-actions">' +
              '<button type="button" class="btn btn-soft btn-sm" data-cat-edit="' + escAttr(c.ID) + '">Edit</button>' +
              '<button type="button" class="btn btn-outline-danger btn-sm" data-cat-del="' + escAttr(c.ID) + '">Hapus</button>' +
            '</div>' +
          '</div>' +
        '</article>';
      }).join('');
    },

    openCatalogForm: function (id) {
      erp.editing.catalogId = id || null;
      var c = id ? erp.catalog.find(function (x) { return String(x.ID) === String(id); }) : null;
      var groups = c ? variants.parse(c.OptionsJSON) : [];
      var bahanIds = c ? String(c.BahanStockID || '').split(',').filter(Boolean) : [];
      var qtyList = c ? String(c.QtyPengurang || '').split(',') : [];

      var stockRows = bahanIds.map(function (sid, i) {
        return '<div class="restock-row" data-bahan-row>' +
          '<select data-bahan-id>' + erp.stockOptions(sid) + '</select>' +
          '<input type="number" data-bahan-qty min="0" step="0.01" value="' + escAttr(Number(qtyList[i]) || 1) + '">' +
          '<button type="button" class="icon-btn" data-remove-bahan aria-label="Hapus bahan"><svg class="ic" aria-hidden="true"><use href="#i-close"/></svg></button>' +
        '</div>';
      }).join('');

      var variantHtml = groups.map(function (g, gi) {
        return '<div class="variant-group" data-variant-group>' +
          '<div class="variant-head">' +
            '<input type="text" data-v-name placeholder="Nama grup" value="' + escAttr(g.name) + '">' +
            '<select data-v-type style="max-width:150px">' +
              '<option value="single"' + (g.type === 'multi' ? '' : ' selected') + '>Pilih satu</option>' +
              '<option value="multi"' + (g.type === 'multi' ? ' selected' : '') + '>Boleh banyak</option>' +
            '</select>' +
            '<button type="button" class="icon-btn" data-remove-variant aria-label="Hapus grup"><svg class="ic" aria-hidden="true"><use href="#i-close"/></svg></button>' +
          '</div>' +
          g.options.map(function (o) {
            return '<div class="variant-row" data-variant-row>' +
              '<input type="text" data-v-opt-name placeholder="Nama opsi" value="' + escAttr(o.name) + '">' +
              '<input type="number" data-v-opt-price min="0" step="1" placeholder="Harga" value="' + (Number(o.price) || 0) + '">' +
              '<button type="button" class="icon-btn" data-remove-vopt aria-label="Hapus opsi"><svg class="ic" aria-hidden="true"><use href="#i-close"/></svg></button>' +
            '</div>';
          }).join('') +
          '<button type="button" class="btn btn-soft btn-sm" data-add-vopt><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg> Tambah opsi</button>' +
        '</div>';
      }).join('');

      var body =
        '<label class="field"><span class="field-label">Nama menu</span><input type="text" id="ct-name" value="' + escAttr(c ? c.NamaMenu : '') + '"></label>' +
        '<div class="grid-2">' +
          '<label class="field"><span class="field-label">Kategori</span><input type="text" id="ct-cat" value="' + escAttr(c ? c.Kategori : '') + '"></label>' +
          '<label class="field"><span class="field-label">Kode menu</span><input type="text" id="ct-code" value="' + escAttr(c ? c.KodeMenu : '') + '"></label>' +
        '</div>' +
        '<div class="grid-2">' +
          '<label class="field"><span class="field-label">Harga (Rp)</span><input type="number" id="ct-price" min="0" step="1" value="' + (c ? escAttr(c.Harga) : '') + '"></label>' +
          '<label class="field"><span class="field-label">URL foto</span><input type="url" id="ct-photo" value="' + escAttr(c ? (c.FotoURL || '') : '') + '" placeholder="https://…"></label>' +
        '</div>' +
        '<label class="check-line"><input type="checkbox" id="ct-track"' + (c && String(c.TrackStok) === 'true' ? ' checked' : '') + '> Lacak stok produk sendiri</label>' +
        '<label class="field" id="ct-stock-box"' + (c && String(c.TrackStok) === 'true' ? '' : ' hidden') + '>' +
          '<span class="field-label">Stok produk</span><input type="number" id="ct-stock" min="0" step="1" value="' + (c ? escAttr(c.StokProduk) : '0') + '"></label>' +
        '<hr class="rule">' +
        '<h3 class="panel-title"><svg class="ic" aria-hidden="true"><use href="#i-sliders"/></svg> Varian / opsi</h3>' +
        '<div id="ct-variants">' + variantHtml + '</div>' +
        '<button type="button" class="btn btn-soft btn-sm" id="ct-add-variant"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg> Tambah grup varian</button>' +
        '<hr class="rule">' +
        '<h3 class="panel-title"><svg class="ic" aria-hidden="true"><use href="#i-box"/></svg> Bahan yang dipotong</h3>' +
        '<div id="ct-stock-rows">' + stockRows + '</div>' +
        '<button type="button" class="btn btn-soft btn-sm" id="ct-add-stock"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg> Tambah bahan</button>';

      ui.modal(c ? 'Edit produk' : 'Tambah produk', body,
        '<button type="button" class="btn btn-ghost" data-act="cancel">Batal</button>' +
        '<button type="button" class="btn btn-primary" data-act="ok">Simpan produk</button>');

      var foot = el('app-modal-foot');
      foot.querySelector('[data-act="cancel"]').addEventListener('click', ui.closeModal);
      foot.querySelector('[data-act="ok"]').addEventListener('click', erp.saveCatalogForm);

      var track = el('ct-track');
      if (track) track.addEventListener('change', function () {
        var box = el('ct-stock-box');
        if (box) box.hidden = !track.checked;
      });

      el('ct-add-variant').addEventListener('click', function () {
        el('ct-variants').insertAdjacentHTML('beforeend', erp.variantGroupHtml());
      });
      el('ct-add-stock').addEventListener('click', function () {
        el('ct-stock-rows').insertAdjacentHTML('beforeend',
          '<div class="restock-row" data-bahan-row>' +
          '<select data-bahan-id>' + erp.stockOptions('') + '</select>' +
          '<input type="number" data-bahan-qty min="0" step="0.01" value="1">' +
          '<button type="button" class="icon-btn" data-remove-bahan aria-label="Hapus bahan"><svg class="ic" aria-hidden="true"><use href="#i-close"/></svg></button>' +
          '</div>');
      });

    },

    variantGroupHtml: function () {
      return '<div class="variant-group" data-variant-group>' +
        '<div class="variant-head">' +
          '<input type="text" data-v-name placeholder="Nama grup">' +
          '<select data-v-type style="max-width:150px"><option value="single">Pilih satu</option><option value="multi">Boleh banyak</option></select>' +
          '<button type="button" class="icon-btn" data-remove-variant aria-label="Hapus grup"><svg class="ic" aria-hidden="true"><use href="#i-close"/></svg></button>' +
        '</div>' +
        '<div class="variant-row" data-variant-row>' +
          '<input type="text" data-v-opt-name placeholder="Nama opsi">' +
          '<input type="number" data-v-opt-price min="0" step="1" placeholder="Harga" value="0">' +
          '<button type="button" class="icon-btn" data-remove-vopt aria-label="Hapus opsi"><svg class="ic" aria-hidden="true"><use href="#i-close"/></svg></button>' +
        '</div>' +
        '<button type="button" class="btn btn-soft btn-sm" data-add-vopt><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg> Tambah opsi</button>' +
      '</div>';
    },

    stockOptions: function (selectedId) {
      if (!erp.stock.length) return '<option value="">— belum ada bahan —</option>';
      return erp.stock.map(function (s) {
        return '<option value="' + escAttr(s.ID) + '"' + (String(s.ID) === String(selectedId) ? ' selected' : '') + '>' +
          esc(s.NamaBarang) + ' (' + num(s.Qty) + ' ' + esc(s.Satuan || '') + ')</option>';
      }).join('');
    },

    saveCatalogForm: function () {
      var name = String((el('ct-name') || {}).value || '').trim();
      var price = Number((el('ct-price') || {}).value) || 0;
      if (!name) { ui.toast('Nama menu wajib diisi.', 'warning'); return; }
      if (price <= 0) { ui.toast('Harga harus lebih dari 0.', 'warning'); return; }

      var bahanIds = [], bahanQtys = [];
      $$('#ct-stock-rows [data-bahan-row]').forEach(function (r) {
        var id = (r.querySelector('[data-bahan-id]') || {}).value;
        var q = Number((r.querySelector('[data-bahan-qty]') || {}).value) || 0;
        if (!id || q <= 0) return;
        bahanIds.push(String(id));
        bahanQtys.push(q);
      });

      var optGroups = [];
      $$('#ct-variants [data-variant-group]').forEach(function (g) {
        var gname = String((g.querySelector('[data-v-name]') || {}).value || '').trim();
        if (!gname) return;
        var gtype = (g.querySelector('[data-v-type]') || {}).value || 'single';
        var opts = [];
        $$('[data-variant-row]', g).forEach(function (r) {
          var on = String((r.querySelector('[data-v-opt-name]') || {}).value || '').trim();
          if (!on) return;
          opts.push({ name: on, price: Number((r.querySelector('[data-v-opt-price]') || {}).value) || 0 });
        });
        if (!opts.length) return;
        optGroups.push({ name: gname, type: gtype, required: true, options: opts });
      });

      var data = {
        action: erp.editing.catalogId ? 'edit' : 'add',
        ID: erp.editing.catalogId || '',
        NamaMenu: name,
        Kategori: String((el('ct-cat') || {}).value || '').trim(),
        KodeMenu: String((el('ct-code') || {}).value || '').trim(),
        Harga: price,
        FotoURL: String((el('ct-photo') || {}).value || '').trim(),
        TrackStok: el('ct-track') && el('ct-track').checked ? 'true' : 'false',
        StokProduk: Number((el('ct-stock') || {}).value) || 0,
        OptionsJSON: JSON.stringify(optGroups),
        BahanStockID: bahanIds.join(','),
        QtyPengurang: bahanQtys.join(',')
      };

      rpc('saveCatalog', { data: data }).then(function (r) {
        if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal menyimpan produk.', 'error'); return; }
        ui.closeModal();
        ui.toast('Produk tersimpan.', 'success');
        erp.refresh();
      }).catch(function (e) { ui.toast(e.message, 'error'); });
    },

    deleteCatalog: function (id) {
      var c = erp.catalog.find(function (x) { return String(x.ID) === String(id); });
      ui.confirm('Hapus produk', 'Hapus "' + ((c && c.NamaMenu) || id) + '" dari katalog?',
        function () {
          rpc('saveCatalog', { data: { action: 'delete', ID: id } }).then(function (r) {
            if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal menghapus produk.', 'error'); return; }
            ui.toast('Produk dihapus.', 'success');
            erp.refresh();
          }).catch(function (e) { ui.toast(e.message, 'error'); });
        });
    },

    /* ---------- pengeluaran ---------- */
    renderExpenseStockPicker: function () {
      var box = el('erp-exp-stock-list');
      if (!box) return;
      box.innerHTML = erp.stock.length
        ? erp.stock.map(function (s) {
          return '<div class="restock-row" data-exp-stock-row>' +
            '<select data-exp-id>' + erp.stockOptions(s.ID) + '</select>' +
            '<input type="number" data-exp-qty min="0" step="0.01" value="0" aria-label="Jumlah ditambahkan">' +
          '</div>';
        }).join('')
        : '<p class="muted">Belum ada bahan baku. Tambah bahan dulu di tab Stok bahan.</p>';
    },

    renderExpenseTotal: function () {
      var t = el('erp-exp-total');
      if (t) t.textContent = money(Number((el('erp-exp-amount') || {}).value) || 0);
    },

    addNewStockRow: function () {
      var box = el('erp-exp-new-list');
      if (!box) return;
      box.insertAdjacentHTML('beforeend',
        '<div class="restock-row" data-new-stock-row>' +
          '<input type="text" data-new-name placeholder="Nama bahan" style="flex:1">' +
          '<input type="number" data-new-qty min="0" step="0.01" value="0" placeholder="Qty" style="width:90px">' +
          '<input type="text" data-new-unit placeholder="Satuan" value="pcs" style="width:80px">' +
          '<button type="button" class="icon-btn" data-remove-new aria-label="Hapus baris"><svg class="ic" aria-hidden="true"><use href="#i-close"/></svg></button>' +
        '</div>');
    },

    renderExpenseHistory: function () {
      var tbody = el('erp-exp-table').querySelector('tbody');
      if (!tbody) return;
      if (!erp.expenses.length) {
        tbody.innerHTML = '<tr><td colspan="4"><p class="muted" style="padding:22px;text-align:center">Belum ada pengeluaran.</p></td></tr>';
        return;
      }
      tbody.innerHTML = erp.expenses.slice().reverse().map(function (e) {
        return '<tr>' +
          '<td>' + esc(fmtDateTime(e.Tanggal)) + '</td>' +
          '<td>' + esc(e.Keterangan || '-') + '</td>' +
          '<td class="num"><strong>' + money(e.Total) + '</strong></td>' +
          '<td class="row-actions-cell"><button type="button" class="btn btn-outline-danger btn-sm" data-exp-del="' + escAttr(e.ID) + '">Hapus</button></td>' +
        '</tr>';
      }).join('');
    },

    deleteExpense: function (id) {
      ui.confirm('Hapus pengeluaran', 'Hapus catatan pengeluaran ini?',
        function () {
          rpc('deleteExpense', { id: id }).then(function (r) {
            if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal menghapus pengeluaran.', 'error'); return; }
            ui.toast('Pengeluaran dihapus.', 'success');
            erp.refresh();
          }).catch(function (e) { ui.toast(e.message, 'error'); });
        });
    },

    saveExpense: function (ev) {
      if (ev) ev.preventDefault();
      var desc = String((el('erp-exp-desc') || {}).value || '').trim();
      var amount = Number((el('erp-exp-amount') || {}).value) || 0;
      if (!desc) { ui.toast('Keterangan wajib diisi.', 'warning'); return; }
      if (amount <= 0) { ui.toast('Total pengeluaran harus lebih dari 0.', 'warning'); return; }

      var stockItems = [];
      $$('#erp-exp-stock-list [data-exp-stock-row]').forEach(function (r) {
        var id = (r.querySelector('[data-exp-id]') || {}).value;
        var q = Number((r.querySelector('[data-exp-qty]') || {}).value) || 0;
        if (!id || q <= 0) return;
        stockItems.push({ id: String(id), qtyAdded: q });
      });
      var newStockItems = [];
      $$('#erp-exp-new-list [data-new-stock-row]').forEach(function (r) {
        var nama = String((r.querySelector('[data-new-name]') || {}).value || '').trim();
        var qty = Number((r.querySelector('[data-new-qty]') || {}).value) || 0;
        var satuan = String((r.querySelector('[data-new-unit]') || {}).value || 'pcs').trim();
        if (!nama || qty <= 0) return;
        newStockItems.push({ nama: nama, qty: qty, satuan: satuan, batas: 5 });
      });

      rpc('saveExpenseAndStock', {
        desc: desc, amount: amount, stockItems: stockItems, newStockItems: newStockItems
      }).then(function (r) {
        if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal menyimpan pengeluaran.', 'error'); return; }
        el('erp-exp-desc').value = '';
        el('erp-exp-amount').value = '';
        el('erp-exp-new-list').innerHTML = '';
        erp.renderExpenseTotal();
        ui.toast('Pengeluaran tersimpan.', 'success');
        erp.refresh();
      }).catch(function (e) { ui.toast(e.message, 'error'); });
    },

    /* ---------- pengguna ---------- */
    loadUsers: function () {
      return rpc('getUsers').then(function (u) {
        erp.users = Array.isArray(u) ? u : [];
        return erp.users;
      }).catch(function () { erp.users = []; return erp.users; });
    },

    renderUsers: function () {
      erp.loadUsers().then(function (users) {
        var tbody = el('erp-user-table').querySelector('tbody');
        if (!tbody) return;
        if (!users.length) {
          tbody.innerHTML = '<tr><td colspan="3"><p class="muted" style="padding:22px;text-align:center">Belum ada pengguna.</p></td></tr>';
          return;
        }
        tbody.innerHTML = users.map(function (u) {
          return '<tr>' +
            '<td><strong>' + esc(u.Username) + '</strong></td>' +
            '<td><span class="badge ' + (u.Role === 'Owner' ? 'badge-warn' : 'badge-ok') + '">' + esc(u.Role) + '</span></td>' +
            '<td class="row-actions-cell">' +
              '<button type="button" class="btn btn-soft btn-sm" data-user-edit="' + escAttr(u.Username) + '">Edit</button>' +
              '<button type="button" class="btn btn-outline-danger btn-sm" data-user-del="' + escAttr(u.Username) + '">Hapus</button>' +
            '</td>' +
          '</tr>';
        }).join('');

        var sel = el('erp-reset-pass-user');
        if (sel) {
          sel.innerHTML = users.map(function (u) {
            return '<option value="' + escAttr(u.Username) + '">' + esc(u.Username) + ' (' + esc(u.Role) + ')</option>';
          }).join('');
        }
      });
    },

    openUserForm: function (username) {
      erp.editing.userName = username || null;
      var u = username ? erp.users.find(function (x) { return String(x.Username) === String(username); }) : null;
      ui.modal(username ? 'Edit pengguna' : 'Tambah pengguna',
        '<label class="field"><span class="field-label">Username</span><input type="text" id="us-name" value="' + escAttr(username || '') + '"' + (username ? ' readonly' : '') + '></label>' +
        '<label class="field"><span class="field-label">Password' + (username ? ' (kosongkan bila tidak diubah)' : '') + '</span><input type="password" id="us-pass" autocomplete="new-password"></label>' +
        '<label class="field"><span class="field-label">Peran</span><select id="us-role">' +
          '<option value="Kasir"' + (u && u.Role === 'Kasir' ? ' selected' : '') + '>Kasir</option>' +
          '<option value="Owner"' + (u && u.Role === 'Owner' ? ' selected' : '') + '>Owner</option>' +
        '</select></label>',
        '<button type="button" class="btn btn-ghost" data-act="cancel">Batal</button>' +
        '<button type="button" class="btn btn-primary" data-act="ok">Simpan</button>');
      var foot = el('app-modal-foot');
      foot.querySelector('[data-act="cancel"]').addEventListener('click', ui.closeModal);
      foot.querySelector('[data-act="ok"]').addEventListener('click', function () {
        var name = String((el('us-name') || {}).value || '').trim();
        var pass = String((el('us-pass') || {}).value || '');
        var role = (el('us-role') || {}).value || 'Kasir';
        if (!name) { ui.toast('Username wajib diisi.', 'warning'); return; }
        if (/\s/.test(name)) { ui.toast('Username tidak boleh mengandung spasi.', 'warning'); return; }
        if (!erp.editing.userName && pass.length < 4) { ui.toast('Password minimal 4 karakter.', 'warning'); return; }
        if (erp.editing.userName && pass && pass.length < 4) { ui.toast('Password minimal 4 karakter.', 'warning'); return; }
        var data = { action: erp.editing.userName ? 'edit' : 'add', username: name, password: pass, role: role };
        rpc('saveUser', { data: data }).then(function (r) {
          if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal menyimpan pengguna.', 'error'); return; }
          ui.closeModal();
          ui.toast('Pengguna tersimpan.', 'success');
          erp.renderUsers();
        }).catch(function (e) { ui.toast(e.message, 'error'); });
      });
    },

    deleteUser: function (username) {
      ui.confirm('Hapus pengguna', 'Hapus akun "' + username + '"?',
        function () {
          rpc('saveUser', { data: { action: 'delete', username: username } }).then(function (r) {
            if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal menghapus pengguna.', 'error'); return; }
            ui.toast('Pengguna dihapus.', 'success');
            erp.renderUsers();
          }).catch(function (e) { ui.toast(e.message, 'error'); });
        });
    },

    /* ---------- pengaturan ---------- */
    renderSettings: function () {
      var s = erp.settings || {};
      // Jangan menimpa input yang sedang diketik pengguna.
      var active = document.activeElement;
      var dirty = active && active.closest && active.closest('#erp-settings');
      if (dirty) return;
      var set = function (id, v) { var e = el(id); if (e) e.value = (v === undefined || v === null) ? '' : v; };
      set('erp-store-name', s.StoreName || '');
      set('erp-store-address', s.StoreAddress || '');
      set('erp-store-phone', s.StorePhone || '');
      set('erp-receipt-header', s.ReceiptHeader || '');
      set('erp-receipt-footer', s.ReceiptFooter || '');
      set('erp-qris-image', s.QrisImage || '');
      set('erp-store-lat', s.StoreLat || '');
      set('erp-store-lng', s.StoreLng || '');
      set('erp-ongkir-perkm', s.OngkirPerKm === undefined ? '' : s.OngkirPerKm);
      set('erp-max-km', s.MaxDeliveryKm === undefined ? '' : s.MaxDeliveryKm);
      set('erp-pin', '');
      var on = function (k) { return String(s[k]) === 'true'; };
      var setCheck = function (id, v) { var e = el(id); if (e) e.checked = !!v; };
      setCheck('erp-rule-cname', on('RequireCustomerName'));
      setCheck('erp-rule-cmeja', on('RequireTableNumber'));
      setCheck('erp-rule-ordertype', on('RequireOrderType'));
      setCheck('erp-rule-queue', on('RequireQueue'));
      setCheck('erp-rule-online', on('OnlineOrderEnabled'));
    },

    saveRules: function (ev) {
      if (ev) ev.preventDefault();
      var payload = {
        RequireCustomerName: String(el('erp-rule-cname') && el('erp-rule-cname').checked),
        RequireTableNumber: String(el('erp-rule-cmeja') && el('erp-rule-cmeja').checked),
        RequireOrderType: String(el('erp-rule-ordertype') && el('erp-rule-ordertype').checked),
        RequireQueue: String(el('erp-rule-queue') && el('erp-rule-queue').checked),
        OnlineOrderEnabled: String(el('erp-rule-online') && el('erp-rule-online').checked)
      };
      rpc('saveAllSettings', { settingsObj: payload }).then(function (r) {
        if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal menyimpan aturan.', 'error'); return; }
        ui.toast('Aturan transaksi tersimpan.', 'success');
        erp.refresh();
      }).catch(function (e) { ui.toast(e.message, 'error'); });
    },

    saveStoreProfile: function (ev) {
      if (ev) ev.preventDefault();
      var payload = {
        StoreName: String((el('erp-store-name') || {}).value || '').trim(),
        StoreAddress: String((el('erp-store-address') || {}).value || '').trim(),
        StorePhone: String((el('erp-store-phone') || {}).value || '').trim(),
        ReceiptHeader: String((el('erp-receipt-header') || {}).value || ''),
        ReceiptFooter: String((el('erp-receipt-footer') || {}).value || ''),
        QrisImage: String((el('erp-qris-image') || {}).value || '').trim()
      };
      rpc('saveAllSettings', { settingsObj: payload }).then(function (r) {
        if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal menyimpan profil.', 'error'); return; }
        ui.toast('Profil toko tersimpan.', 'success');
        erp.refresh();
      }).catch(function (e) { ui.toast(e.message, 'error'); });
    },

    saveLocation: function (ev) {
      if (ev) ev.preventDefault();
      var lat = parseFloat((el('erp-store-lat') || {}).value);
      var lng = parseFloat((el('erp-store-lng') || {}).value);
      if (isNaN(lat) || isNaN(lng)) { ui.toast('Latitude dan longitude toko wajib diisi.', 'warning'); return; }
      var payload = {
        StoreLat: String(lat), StoreLng: String(lng),
        OngkirPerKm: String((el('erp-ongkir-perkm') || {}).value || '0'),
        MaxDeliveryKm: String((el('erp-max-km') || {}).value || '0')
      };
      rpc('saveAllSettings', { settingsObj: payload }).then(function (r) {
        if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal menyimpan lokasi.', 'error'); return; }
        ui.toast('Lokasi & ongkir tersimpan.', 'success');
        erp.refresh();
      }).catch(function (e) { ui.toast(e.message, 'error'); });
    },

    useMyLocationForStore: function () {
      if (!navigator.geolocation) { ui.toast('Perangkat tidak mendukung geolokasi.', 'warning'); return; }
      navigator.geolocation.getCurrentPosition(function (pos) {
        var li = el('erp-store-lat'), gi = el('erp-store-lng');
        if (li) li.value = pos.coords.latitude.toFixed(6);
        if (gi) gi.value = pos.coords.longitude.toFixed(6);
        ui.toast('Koordinat diambil dari perangkat. Simpan untuk menerapkan.', 'info');
      }, function (err) {
        ui.toast('Gagal mengambil lokasi: ' + (err && err.message ? err.message : 'izin ditolak'), 'warning');
      }, { enableHighAccuracy: true, timeout: 12000 });
    },

    savePin: function (ev) {
      if (ev) ev.preventDefault();
      var pin = String((el('erp-pin') || {}).value || '').trim();
      if (!/^\d{6}$/.test(pin)) { ui.toast('PIN harus 6 angka.', 'warning'); return; }
      rpc('saveAllSettings', { settingsObj: { KasirPin: pin } }).then(function (r) {
        if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal menyimpan PIN.', 'error'); return; }
        el('erp-pin').value = '';
        ui.toast('PIN portal tersimpan.', 'success');
        erp.refresh();
      }).catch(function (e) { ui.toast(e.message, 'error'); });
    },

    changeOwnPassword: function (ev) {
      if (ev) ev.preventDefault();
      var oldP = String((el('erp-pass-old') || {}).value || '');
      var newP = String((el('erp-pass-new') || {}).value || '');
      if (!oldP || !newP) { ui.toast('Isi password lama dan baru.', 'warning'); return; }
      if (newP.length < 4) { ui.toast('Password baru minimal 4 karakter.', 'warning'); return; }
      rpc('changePassword', { oldPass: oldP, newPass: newP }).then(function (r) {
        if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal mengganti password.', 'error'); return; }
        el('erp-pass-old').value = ''; el('erp-pass-new').value = '';
        ui.toast('Password berhasil diganti.', 'success');
      }).catch(function (e) { ui.toast(e.message, 'error'); });
    },

    resetUserPassword: function (ev) {
      if (ev) ev.preventDefault();
      var username = String((el('erp-reset-pass-user') || {}).value || '');
      var pass = String((el('erp-reset-pass-new') || {}).value || '');
      if (!username) { ui.toast('Pilih pengguna terlebih dahulu.', 'warning'); return; }
      if (pass.length < 4) { ui.toast('Password baru minimal 4 karakter.', 'warning'); return; }
      rpc('setPasswordForUser', { username: username, newPass: pass }).then(function (r) {
        if (!r || !r.success) { ui.toast((r && r.message) || 'Gagal menerapkan password.', 'error'); return; }
        el('erp-reset-pass-new').value = '';
        ui.toast('Password ' + username + ' diperbarui.', 'success');
      }).catch(function (e) { ui.toast(e.message, 'error'); });
    }
  };

  function shortMoney(n) {
    var v = Number(n) || 0;
    if (v >= 1e9) return 'Rp ' + Math.round(v / 1e9) + ' M';
    if (v >= 1e6) return 'Rp ' + Math.round(v / 1e6) + ' Jt';
    if (v >= 1e3) return 'Rp ' + Math.round(v / 1e3) + ' Rb';
    return 'Rp ' + Math.round(v);
  }

  /* ==================================================================
   * 8. MODUL: TV (layar antrean)
   * ================================================================== */
  var tv = {
    timer: null,
    clockTimer: null,
    lastCallId: null,
    audioReady: false,
    audioCtx: null,

    init: function () {
      tv.startClock();
      tv.poll();
      if (tv.timer) clearInterval(tv.timer);
      tv.timer = setInterval(tv.poll, 5000);
    },

    stop: function () {
      if (tv.timer) { clearInterval(tv.timer); tv.timer = null; }
    },

    /**
     * Token layar antrean.
     * Selalu token display dari verifyPortalPin (PIN portal) — TV boleh dipakai
     * perangkat bersama tanpa login, dan sesi login tidak pernah menggantikannya.
     */
    token: function () {
      return sessionStorage.getItem(TV_TOKEN_KEY) || '';
    },
    clearToken: function () {
      sessionStorage.removeItem(TV_TOKEN_KEY);
    },

    startClock: function () {
      if (tv.clockTimer) clearInterval(tv.clockTimer);
      var tick = function () {
        var d = new Date();
        function p(n) { return n < 10 ? '0' + n : String(n); }
        var c = el('tv-clock');
        if (c) c.textContent = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
        var dt = el('tv-date');
        if (dt) dt.textContent = fmtDay(d) + ' · WIB';
      };
      tick();
      tv.clockTimer = setInterval(tick, 1000);
    },

    poll: function () {
      var token = tv.token();
      if (!token) {
        tv.render({ data: [], StoreName: 'My Kasir' });
        return;
      }
      rpc('getActiveQueues', { token: token }).then(function (r) {
        if (!r || !r.success) {
          if (/sesi|kedaluwarsa|valid/i.test((r && r.message) || '')) tv.handleExpired();
          return;
        }
        tv.render(r);
      }).catch(function (e) {
        if (/sesi|kedaluwarsa|valid/i.test(e.message)) tv.handleExpired();
      });
    },

    handleExpired: function () {
      tv.clearToken();
      tv.stop();
      tv.openGate();
      var box = el('tv-gate-error');
      if (box) { box.hidden = false; box.textContent = 'Sesi layar antrean berakhir. Masukkan PIN portal kembali.'; }
    },

    render: function (r) {
      var queues = (r && r.data) || [];
      var nameEl = el('tv-store-name');
      if (nameEl) nameEl.textContent = (r && r.StoreName) || 'My Kasir';

      var ready = queues.filter(function (q) { return String(q.status) === 'Selesai'; });
      var processing = queues.filter(function (q) { return String(q.status) !== 'Selesai'; });

      var main = el('tv-ready-number');
      if (main) {
        var last = ready.length ? ready[ready.length - 1] : null;
        main.textContent = last ? last.qNum : '---';
      }
      var rc = el('tv-ready-count');
      if (rc) rc.textContent = String(ready.length);
      var pc = el('tv-processing-count');
      if (pc) pc.textContent = String(processing.length);

      var cust = el('tv-ready-customer'), items = el('tv-ready-items'), time = el('tv-ready-time');
      var lastReady = ready.length ? ready[ready.length - 1] : null;
      if (cust) cust.textContent = lastReady ? (lastReady.customer || '-') : '—';
      if (items) {
        items.textContent = lastReady
          ? (lastReady.items || []).map(function (i) { return i.name + '×' + (Number(i.qty) || 1); }).join(', ')
          : '—';
      }
      if (time) time.textContent = '—';

      var list = el('tv-processing-list');
      if (list) {
        if (!processing.length) {
          list.innerHTML = '<p class="muted" style="text-align:center;padding:30px 0">Tidak ada pesanan dalam proses.</p>';
        } else {
          list.innerHTML = processing.map(function (q) {
            return '<div class="tv-queue-card">' +
              '<div class="tv-queue-top"><span class="tv-queue-num">' + esc(q.qNum) + '</span>' +
              '<span class="badge ' + (String(q.status) === 'Diproses' ? 'badge-warn' : 'badge-info') + '">' + esc(q.status || '-') + '</span></div>' +
              '<div class="tv-queue-cust">' + esc(q.customer || '-') + '</div>' +
              '<div class="tv-queue-items">' +
                esc((q.items || []).map(function (i) { return i.name + ' ×' + (Number(i.qty) || 1); }).join(', ')) +
              '</div>' +
            '</div>';
          }).join('');
        }
      }

      var ticker = el('tv-ticker-text');
      if (ticker) {
        ticker.textContent = processing.length
          ? (processing.length + ' pesanan sedang diproses · ' + ready.length + ' pesanan siap diambil')
          : (ready.length ? ready.length + ' pesanan siap diambil' : 'Tidak ada antrean aktif saat ini.');
      }

      if (r && r.callQueueId && r.callQueueId !== tv.lastCallId) {
        tv.lastCallId = r.callQueueId;
        var qnum = String(r.callQueueId).split('_')[0];
        tv.announce('Nomor antrean ' + String(qnum).replace(/-/g, ' ') + ', silakan ambil pesanan Anda di kasir');
      }
    },

    /* Audio hanya boleh bunyi setelah user gesture (kebijakan autoplay browser). */
    enableAudio: function () {
      tv.audioReady = true;
      try {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx && !tv.audioCtx) {
          tv.audioCtx = new Ctx();
          if (tv.audioCtx.state === 'suspended') tv.audioCtx.resume();
        }
      } catch (e) { /* ignore */ }
      var lbl = el('tv-audio-label');
      if (lbl) lbl.textContent = 'Audio aktif';
      var btn = el('tv-audio-btn');
      if (btn) btn.classList.add('is-active');
      ui.toast('Audio diaktifkan. Pengumuman antrean akan terdengar.', 'success');
      if ('speechSynthesis' in window) {
        try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
      }
    },

    announce: function (text) {
      if (!tv.audioReady) return;
      // 1) bip lokal (selalu tersedia setelah gesture)
      try {
        var ctx = tv.audioCtx;
        if (ctx) {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.type = 'sine'; osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.0001, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
          osc.start(); osc.stop(ctx.currentTime + 0.55);
        }
      } catch (e) { /* ignore */ }

      // 2) speech synthesis browser
      if ('speechSynthesis' in window) {
        try {
          var u = new SpeechSynthesisUtterance(text);
          u.lang = 'id-ID'; u.rate = 0.95; u.pitch = 1;
          speechSynthesis.speak(u);
        } catch (e) { /* ignore */ }
      }

      // 3) TTS dari server (suara lebih natural) — hanya setelah audio diaktifkan
      rpc('getTTS', { txt: text }).then(function (b64) {
        if (!b64) return;
        try {
          var audio = new Audio('data:audio/mpeg;base64,' + b64);
          audio.volume = 1;
          var p = audio.play();
          if (p && p.catch) p.catch(function () { });
        } catch (e) { /* ignore */ }
      }).catch(function () { });
    },

    openGate: function () {
      var gate = el('tv-gate');
      var shell = el('tv-shell');
      if (shell) shell.hidden = true;
      if (gate) gate.hidden = false;
    },

    openScreen: function () {
      var gate = el('tv-gate');
      var shell = el('tv-shell');
      if (gate) gate.hidden = true;
      if (shell) shell.hidden = false;
      tv.init();
    },

    verifyPin: function (ev) {
      if (ev) ev.preventDefault();
      var pin = String((el('tv-pin') || {}).value || '').trim();
      var errBox = el('tv-gate-error');
      if (!pin) { ui.toast('Masukkan PIN portal.', 'warning'); return; }
      rpc('verifyPortalPin', { pin: pin }).then(function (r) {
        if (!r || !r.success || !r.token) {
          if (errBox) { errBox.hidden = false; errBox.textContent = (r && r.message) || 'PIN salah.'; }
          return;
        }
        sessionStorage.setItem(TV_TOKEN_KEY, r.token);
        if (errBox) errBox.hidden = true;
        var pi = el('tv-pin');
        if (pi) pi.value = '';
        tv.openScreen();
        ui.toast('Layar antrean dibuka.', 'success');
      }).catch(function (e) {
        if (errBox) { errBox.hidden = false; errBox.textContent = e.message; }
      });
    }
  };

  /* ==================================================================
   * 9. AUTH / NAVIGASI
   * ================================================================== */
  function requireLogin(role) {
    if (!session.isAuthed()) {
      ui.toast('Silakan masuk terlebih dahulu.', 'warning');
      openLogin(role || 'Kasir');
      return false;
    }
    if (role && session.role !== role) {
      ui.toast('Akses ini khusus untuk peran ' + role + '.', 'warning');
      return false;
    }
    return true;
  }

  function openLogin(role) {
    var body =
      '<form id="login-form" novalidate>' +
        '<label class="field"><span class="field-label">Peran</span><select id="login-role">' +
          '<option value="Kasir"' + (role !== 'Owner' ? ' selected' : '') + '>Kasir</option>' +
          '<option value="Owner"' + (role === 'Owner' ? ' selected' : '') + '>Owner</option>' +
        '</select></label>' +
        '<label class="field"><span class="field-label">Username</span><input type="text" id="login-user" autocomplete="username" required></label>' +
        '<label class="field"><span class="field-label">Password</span><input type="password" id="login-pass" autocomplete="current-password" required></label>' +
        '<div class="callout callout-danger" id="login-error" hidden></div>' +
      '</form>' +
      '<hr class="rule">' +
      '<button type="button" class="btn btn-ghost btn-sm" id="login-recover">Lupa password (akun kasir)</button>';

    ui.modal('Masuk ke My Kasir', body,
      '<button type="button" class="btn btn-ghost" data-act="cancel">Batal</button>' +
      '<button type="button" class="btn btn-primary" data-act="login">Masuk</button>');

    var foot = el('app-modal-foot');
    foot.querySelector('[data-act="cancel"]').addEventListener('click', ui.closeModal);
    foot.querySelector('[data-act="login"]').addEventListener('click', doLogin);

    var form = el('login-form');
    form.addEventListener('submit', function (e) { e.preventDefault(); doLogin(); });
    el('login-recover').addEventListener('click', openRecover);
    setTimeout(function () { var u = el('login-user'); if (u) u.focus(); }, 60);
  }

  function doLogin() {
    var user = String((el('login-user') || {}).value || '').trim();
    var pass = String((el('login-pass') || {}).value || '');
    var role = (el('login-role') || {}).value || 'Kasir';
    var errBox = el('login-error');
    if (!user || !pass) {
      if (errBox) { errBox.hidden = false; errBox.textContent = 'Username dan password wajib diisi.'; }
      return;
    }
    rpc('login', { user: user, pass: pass, expectedRole: role }).then(function (r) {
      if (!r || !r.success || !r.token) {
        if (errBox) { errBox.hidden = false; errBox.textContent = (r && r.message) || 'Login gagal.'; }
        return;
      }
      session.set(r.token, r.username || user, r.role || role);
      session.paint();
      ui.closeModal();
      ui.toast('Selamat datang, ' + (r.username || user) + '.', 'success');
      goPortal(r.role || role);
    }).catch(function (e) {
      if (errBox) { errBox.hidden = false; errBox.textContent = e.message; }
    });
  }

  function openRecover() {
    ui.modal('Reset password kasir',
      '<label class="field"><span class="field-label">Username akun kasir</span><input type="text" id="rec-user" autocomplete="username"></label>' +
      '<p class="muted">Akun Owner tidak dapat di-reset dari halaman publik. Server akan mengembalikan password sementara.</p>',
      '<button type="button" class="btn btn-ghost" data-act="cancel">Batal</button>' +
      '<button type="button" class="btn btn-primary" data-act="ok">Reset</button>');
    var foot = el('app-modal-foot');
    foot.querySelector('[data-act="cancel"]').addEventListener('click', ui.closeModal);
    foot.querySelector('[data-act="ok"]').addEventListener('click', function () {
      var u = String((el('rec-user') || {}).value || '').trim();
      if (!u) { ui.toast('Username wajib diisi.', 'warning'); return; }
      rpc('recoverPassword', { username: u }).then(function (r) {
        if (!r || !r.success) { ui.toast((r && r.message) || 'Reset gagal.', 'error'); return; }
        ui.closeModal();
        ui.modal('Password direset', '<div class="callout callout-warn">' + esc(r.message || '') + '</div>' +
          '<button type="button" class="btn btn-primary btn-block" data-act="close">Saya paham</button>');
        el('app-modal-foot').querySelector('[data-act="close"]').addEventListener('click', ui.closeModal);
      }).catch(function (e) { ui.toast(e.message, 'error'); });
    });
  }

  function goPortal(role) {
    if (role === 'Owner') {
      ui.showView('owner');
      erp.init();
      erp.refresh();
    } else {
      ui.showView('kasir');
      pos.init();
      erp.refresh();
    }
  }

  function doLogout() {
    var t = session.token;
    var done = function () {
      session.clear();
      sessionStorage.removeItem(TV_TOKEN_KEY);
      session.paint();
      ui.showView('store');
      ui.toast('Anda telah keluar.', 'info');
    };
    if (!t) { done(); return; }
    rpc('logout', { token: t }).then(done).catch(done);
  }

  function navigate(view) {
    if (view === 'kasir') {
      if (!session.isAuthed()) { requireLogin('Kasir'); return; }
      tv.stop();
      ui.showView('kasir');
      pos.init();
      if (!erp.catalog.length) erp.refresh();
      return;
    }
    if (view === 'owner') {
      if (!requireLogin('Owner')) return;
      tv.stop();
      ui.showView('owner');
      erp.init();
      erp.refresh();
      return;
    }
    if (view === 'tv') {
      tv.stop();
      ui.showView('tv');
      if (tv.token()) tv.openScreen();
      else tv.openGate();
      return;
    }
    tv.stop();
    ui.showView('store');
    if (!store.catalog.length) store.loadCatalog();
  }

  /* ==================================================================
   * 10. EVENT WIRING
   * ================================================================== */
  function wire() {
    /* --- navigasi utama --- */
    $$('#topnav .nav-btn').forEach(function (b) {
      b.addEventListener('click', function () { navigate(b.dataset.view); });
    });
    el('btn-logout').addEventListener('click', doLogout);

    /* --- modal --- */
    el('app-modal-close').addEventListener('click', ui.closeModal);
    el('app-modal').addEventListener('click', function (ev) {
      if (ev.target === el('app-modal')) ui.closeModal();
    });
    el('app-modal').addEventListener('cancel', function (ev) {
      ev.preventDefault();
      ui.closeModal();
    });

    /* --- store --- */
    el('store-search').addEventListener('input', store.renderProducts);
    el('store-categories').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-cat]');
      if (b) store.setCategory(b.dataset.cat);
    });
    el('store-products').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-add]');
      if (b) store.addToCart(b.dataset.add);
    });
    el('store-cart-items').addEventListener('click', function (ev) {
      var q = ev.target.closest('[data-qty]');
      if (q) { store.changeQty(q.dataset.key, Number(q.dataset.qty)); return; }
      var d = ev.target.closest('[data-del]');
      if (d) store.removeItem(d.dataset.del);
    });
    el('store-cart-clear').addEventListener('click', function () {
      store.cart = [];
      store.renderCart();
    });
    el('store-order-type').addEventListener('change', function () { store.setOrderType(this.value); });
    el('store-pay-options').addEventListener('change', function (ev) {
      if (ev.target && ev.target.name === 'store-pay') store.method = ev.target.value;
    });
    el('store-checkout-form').addEventListener('submit', store.submitOrder);
    el('store-ongkir-btn').addEventListener('click', function () { store.calcOngkir(); });
    el('store-geo-btn').addEventListener('click', function () { store.useMyLocation(); });
    el('store-track-btn').addEventListener('click', function () { store.trackOrder(); });
    el('store-track-code').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); store.trackOrder(); }
    });
    el('store-track-open').addEventListener('click', function () {
      var p = el('store-track-panel');
      if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(function () { var c = el('store-track-code'); if (c) c.focus(); }, 300);
    });

    /* --- pos --- */
    el('kasir-search').addEventListener('input', pos.renderProducts);
    el('kasir-categories').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-cat]');
      if (b) pos.setCategory(b.dataset.cat);
    });
    el('kasir-products').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-add]');
      if (b) pos.addToCart(b.dataset.add);
    });
    el('kasir-cart-items').addEventListener('click', function (ev) {
      var q = ev.target.closest('[data-qty]');
      if (q) { pos.changeQty(q.dataset.key, Number(q.dataset.qty)); return; }
      var d = ev.target.closest('[data-del]');
      if (d) pos.removeItem(d.dataset.del);
    });
    el('kasir-cart-clear').addEventListener('click', function () { pos.cart = []; pos.renderCart(); });
    el('kasir-pay-btn').addEventListener('click', function () { pos.openPayment(); });
    el('kasir-online-btn').addEventListener('click', function () { pos.openOnlineOrders(); });
    el('kasir-queue-btn').addEventListener('click', function () { pos.openQueue(); });
    el('kasir-rules-btn').addEventListener('click', function () { pos.openRules(); });
    $$('.seg-btn[data-order-type]').forEach(function (b) {
      b.addEventListener('click', function () { pos.setOrderType(b.dataset.orderType); });
    });

    /* --- modal delegation (POS + ERP) --- */
    el('app-modal-body').addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.closest('[data-remove-variant]')) {
        var g = t.closest('[data-variant-group]');
        if (g && g.parentNode) g.parentNode.removeChild(g);
        return;
      }
      if (t.closest('[data-remove-vopt]')) {
        var r = t.closest('[data-variant-row]');
        if (r && r.parentNode) r.parentNode.removeChild(r);
        return;
      }
      if (t.closest('[data-remove-bahan]')) {
        var b = t.closest('[data-bahan-row]');
        if (b && b.parentNode) b.parentNode.removeChild(b);
        return;
      }
      if (t.closest('[data-add-vopt]')) {
        t.closest('[data-variant-group]').insertAdjacentHTML('beforeend',
          '<div class="variant-row" data-variant-row>' +
          '<input type="text" data-v-opt-name placeholder="Nama opsi">' +
          '<input type="number" data-v-opt-price min="0" step="1" placeholder="Harga" value="0">' +
          '<button type="button" class="icon-btn" data-remove-vopt aria-label="Hapus opsi"><svg class="ic" aria-hidden="true"><use href="#i-close"/></svg></button>' +
          '</div>');
        return;
      }
      var quick = t.closest('[data-quick]');
      if (quick) {
        var inp = el('pos-cash-received');
        if (inp) { inp.value = quick.dataset.quick; pos.calcChange(); }
        return;
      }
      var cp = t.closest('[data-confirm-pay]');
      if (cp) { pos.confirmOnlinePayment(cp.dataset.confirmPay); return; }
      var ss = t.closest('[data-set-status]');
      if (ss) { pos.setOnlineStatus(ss.dataset.setStatus, ss.dataset.status); return; }
      var qr = t.closest('[data-queue-ready]');
      if (qr) { pos.setQueueReady(qr.dataset.queueReady, qr.dataset.qnum); return; }
      var qc = t.closest('[data-queue-call]');
      if (qc) { pos.callQueueAgain(qc.dataset.queueCall); return; }
      var qrs = t.closest('[data-queue-reset]');
      if (qrs) { pos.resetQueue(); return; }
    });

    /* --- erp --- */
    el('erp-nav').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-tab]');
      if (b) erp.switchTab(b.dataset.tab);
    });
    el('erp-refresh').addEventListener('click', function () { erp.refresh(); });
    el('erp-date').addEventListener('change', function () { erp.renderDashboard(); });
    el('erp-stock-add').addEventListener('click', function () { erp.openStockForm(null); });
    el('erp-stock-table').addEventListener('click', function (ev) {
      var inc = ev.target.closest('[data-stock-inc]');
      if (inc) { erp.adjustStock(inc.dataset.stockInc, Number(inc.dataset.delta)); return; }
      var e = ev.target.closest('[data-stock-edit]');
      if (e) { erp.openStockForm(e.dataset.stockEdit); return; }
      var d = ev.target.closest('[data-stock-del]');
      if (d) erp.deleteStock(d.dataset.stockDel);
    });
    el('erp-catalog-add').addEventListener('click', function () { erp.openCatalogForm(null); });
    el('erp-catalog-categories').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-erp-cat]');
      if (!b) return;
      erp.catalogCat = b.dataset.erpCat;
      erp.renderCatalog();
    });
    el('erp-catalog-grid').addEventListener('click', function (ev) {
      var e = ev.target.closest('[data-cat-edit]');
      if (e) { erp.openCatalogForm(e.dataset.catEdit); return; }
      var d = ev.target.closest('[data-cat-del]');
      if (d) erp.deleteCatalog(d.dataset.catDel);
    });
    el('erp-trx-table').addEventListener('click', function (ev) {
      var v = ev.target.closest('[data-trx-view]');
      if (v) { erp.viewTransaction(v.dataset.trxView); return; }
      var d = ev.target.closest('[data-trx-del]');
      if (d) erp.deleteTransaction(d.dataset.trxDel);
    });
    el('erp-expense-form').addEventListener('submit', erp.saveExpense);
    el('erp-exp-amount').addEventListener('input', erp.renderExpenseTotal);
    el('erp-exp-new-add').addEventListener('click', function () { erp.addNewStockRow(); });
    el('erp-exp-new-list').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-remove-new]');
      if (b) {
        var row = b.closest('[data-new-stock-row]');
        if (row && row.parentNode) row.parentNode.removeChild(row);
      }
    });
    el('erp-exp-table').addEventListener('click', function (ev) {
      var d = ev.target.closest('[data-exp-del]');
      if (d) erp.deleteExpense(d.dataset.expDel);
    });
    el('erp-user-add').addEventListener('click', function () { erp.openUserForm(null); });
    el('erp-user-table').addEventListener('click', function (ev) {
      var e = ev.target.closest('[data-user-edit]');
      if (e) { erp.openUserForm(e.dataset.userEdit); return; }
      var d = ev.target.closest('[data-user-del]');
      if (d) erp.deleteUser(d.dataset.userDel);
    });
    el('erp-rules-form').addEventListener('submit', erp.saveRules);
    el('erp-store-form').addEventListener('submit', erp.saveStoreProfile);
    el('erp-loc-form').addEventListener('submit', erp.saveLocation);
    el('erp-geo-btn').addEventListener('click', function () { erp.useMyLocationForStore(); });
    el('erp-pin-form').addEventListener('submit', erp.savePin);
    el('erp-pass-form').addEventListener('submit', erp.changeOwnPassword);
    el('erp-reset-pass-form').addEventListener('submit', erp.resetUserPassword);

    /* --- tv --- */
    el('tv-pin-form').addEventListener('submit', tv.verifyPin);
    el('tv-audio-btn').addEventListener('click', function () { tv.enableAudio(); });
  }

  /* ==================================================================
   * 11. BOOTSTRAP
   * ================================================================== */
  var installPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installPrompt = e;
    var b = el('btn-install');
    if (b) b.hidden = false;
  });
  var installBtn = el('btn-install');
  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (!installPrompt) return;
      installPrompt.prompt();
      installPrompt = null;
      installBtn.hidden = true;
    });
  }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { });
    });
  }

  function boot() {
    wire();
    session.paint();
    store.init();

    // Shortcut PWA / deep-link: ?view=store|kasir|owner|tv
    var wanted = '';
    try {
      wanted = (new URLSearchParams(window.location.search).get('view') || '').toLowerCase();
    } catch (e) { wanted = ''; }

    if (wanted === 'tv') {
      ui.showView('tv');
      if (tv.token()) tv.openScreen(); else tv.openGate();
      return;
    }
    if (wanted === 'kasir') {
      if (session.isAuthed() && session.role !== 'Owner') {
        ui.showView('kasir'); pos.init(); erp.refresh();
      } else {
        requireLogin('Kasir');
      }
      return;
    }
    if (wanted === 'owner') {
      if (session.role === 'Owner') {
        ui.showView('owner'); erp.init(); erp.refresh();
      } else {
        requireLogin('Owner');
      }
      return;
    }

    // Sesi yang sudah ada: pulihkan tampilan sesuai peran
    if (session.isAuthed()) {
      if (session.role === 'Owner') { ui.showView('owner'); erp.init(); erp.refresh(); }
      else { ui.showView('kasir'); pos.init(); erp.refresh(); }
    } else {
      ui.showView('store');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // expose untuk keperluan debugging di console
  window.MyKasir = {
    rpc: rpc, ui: ui, session: session, store: store, pos: pos, erp: erp, tv: tv, variants: variants
  };})();
