# TradingView Remote — tahap 1

PWA React untuk mengirim permintaan analisis pribadi ke Firestore. Worker Node.js di laptop menjalankan `codex exec` non-interaktif melalui MCP TradingView yang sudah terdaftar. Tidak ada transaksi atau eksekusi order. Seluruh antarmuka memakai bahasa Indonesia; waktu ditampilkan di Asia/Makassar (WITA).

## Menjalankan frontend

Prasyarat: Node.js 22+, npm, Chrome/Edge terbaru.

```powershell
npm install
npm run dev
```

Buka http://127.0.0.1:5173. Login Google diperlukan untuk mengirim request. Formulir dapat dilihat sebelum login. Untuk demo **tanpa request Firebase**, gunakan http://127.0.0.1:5173/?demo=1; mode ini hanya tersedia pada hostname localhost/127.0.0.1 dan semua hasil diberi label simulasi.

```powershell
npm run lint
npm test
npm run build
npm run preview
```

Preview build: http://127.0.0.1:4173. Service worker aktif pada build production, bukan server dev. Tombol instal memanggil prompt browser jika tersedia, atau menampilkan panduan Android. Ikon PNG dibuat sendiri dari `web/public/icon.svg`. Aplikasi menyimpan hanya aset statis dalam cache; data Firebase tidak disimpan oleh service worker. Tidak ada Analytics dan Firebase Storage belum diinisialisasi.

Instal Android membutuhkan **HTTPS** di alamat yang dapat diakses ponsel. HTTP IP LAN bukan secure context untuk instalasi PWA. Deployment belum dilakukan. Saat offline, kerangka aplikasi dapat dibuka; login, kirim request, dan pembaruan status memerlukan internet. Service worker menawarkan pembaruan versi, bukan memuat ulang formulir secara paksa.

## Langkah Firebase manual (belum dilakukan)

1. Di project `tradingview-remote`, aktifkan Authentication → Sign-in method → Google. Isi email dukungan jika diminta.
2. Tambahkan `localhost`, `127.0.0.1`, dan domain HTTPS frontend kelak ke Authentication → Authorized domains. Login memakai pop-up: izinkan pop-up jika diblokir. Untuk domain produksi, periksa pula konfigurasi OAuth domain/redirect Firebase sesuai dokumentasi Firebase.
3. Buat database Cloud Firestore bila belum ada. Jangan membuka rules test/public. Terapkan isi `firestore.rules` lewat Firebase Console, setelah diperiksa.
4. Buat indeks koleksi `analysisRequests`: `userId` ascending + `createdAt` descending, scope collection. Spesifikasi tersedia di `firestore.indexes.json`. Query bridge `userId` + `status` memakai penggabungan indeks equality bawaan.
5. Login lalu salin UID akun dari Authentication → Users. Untuk mengunci rules ke satu pemilik, ubah fungsi `authorized()` menjadi `return request.auth != null && request.auth.uid == 'UID_ANDA';`. Placeholder `OWNER_UID` pada rules sekarang mengizinkan setiap pengguna login **hanya** membaca/membuat dokumen miliknya. Bridge tetap wajib dikunci ke UID pemilik, sehingga akun lain tidak bisa menjalankan Codex di laptop Anda.
6. Buat service account dengan akses Firestore minimum yang diperlukan (misalnya Datastore User), simpan JSON **di luar repository**, batasi akses file OS. Jangan unggah atau tempel private key ke kode. Admin SDK melewati rules: keamanan mesin dan service account tetap penting.

Jangan menjalankan `firebase deploy` sebelum benar-benar siap. `firebase.json` hanya menyediakan konfigurasi lokal/rules/indeks; implementasi ini tidak mengubah konfigurasi Firebase online.

## Menjalankan bridge di laptop

1. Instal dan login Codex CLI (`codex login`) pada akun OS yang sama. Versi CLI harus mendukung `exec --ignore-user-config --ignore-rules --strict-config --ephemeral` dan `mcp_servers.*.enabled_tools`. Periksa `codex exec --help`. Gunakan binary native `codex.exe` di Windows, **bukan** shim npm `.cmd`/`.ps1`. Temukan dengan `Get-Command codex` atau lokasi binary dari instalasi CLI Anda.
2. Pastikan `[mcp_servers.tradingview]` stdio berisi `command` dan `args` dalam `~/.codex/config.toml`; konfigurasi yang sudah ada dibaca tanpa diubah. Jalankan TradingView lokal dengan MCP/CDP Anda yang sudah dikonfigurasi. `TRADINGVIEW_EXECUTABLE` mencatat lokasi untuk peluncuran manual; bridge tidak meluncurkan atau membunuh aplikasi TradingView.
3. Pastikan CDP hanya tersedia di **127.0.0.1:9222**. Jangan port-forward, tunnel, atau membuka port 9222 ke internet. Bridge memaksa host MCP ke loopback. Tidak ada HTTP server atau port masuk pada bridge; koneksi Firestore bersifat keluar.
4. Salin `bridge/.env.example` ke `bridge/.env`. Isi `GOOGLE_APPLICATION_CREDENTIALS`, `OWNER_UID`, `CODEX_EXECUTABLE`, dan lokasi TradingView. `CODEX_CONFIG_PATH` opsional bila konfigurasi bukan default. `JOB_TIMEOUT_MS` default 180000, rentang 1000–900000.
5. Jalankan dari root repository:

```powershell
npm run bridge
```

Bridge membaca `bridge/.env` karena npm workspace menetapkan direktori kerja bridge. Jangan menaruh environment Admin di frontend/VITE_*.

Bridge mengisolasi konfigurasi Codex per pemanggilan: mengambil **hanya** definisi server TradingView, allowlist tool baca/set chart dan tambah drawing, shell/unified exec/JS REPL/apps/multi-agent dimatikan, sandbox read-only, approval never. Konfigurasi/mode ini tidak mewarisi server MCP lain. Kebijakan mesin yang lebih ketat tetap dapat menolak tool; job akan gagal, bukan melewati sandbox. Tidak ada bypass approval berbahaya. Prompt dikirim lewat stdin dengan `spawn(..., shell:false)`, bukan argumen shell. Environment child tidak berisi path service-account atau API key dari bridge.

Tool transaksi, UI click/keyboard/evaluate, Pine execution, peluncuran aplikasi, dan penghapusan drawing tidak termasuk allowlist. Instruksi tambahan diperlakukan sebagai data tak tepercaya; ini melengkapi pembatasan tool, bukan menjadi satu-satunya pengaman. Hanya jalankan versi MCP lokal yang tepercaya. Untuk drawing Fibonacci, MCP dasar hanya menyediakan bentuk umum; prompt meminta garis rasio berlabel dan menyatakan keterbatasannya.

## Data dan siklus job

`analysisRequests/{autoId}` dibuat frontend dengan:

- `userId`, `symbol`, `timeframe`, `mode`, `drawings`, `instruction` (maksimal 1.500 karakter).
- `status: pending`, `createdAt: serverTimestamp()`, `startedAt: null`, `completedAt: null`, `result: null`, `error: null`.

Preset simbol: COINBASE:BTCUSD, OANDA:XAUUSD, EURUSD. Simbol kustom memakai allowlist karakter dan tata bahasa `(EXCHANGE:)?TICKER` (exchange 1–15 karakter A–Z/0–9/underscore, ticker 1–25 karakter A–Z/0–9/titik/underscore/!). Bukan daftar seluruh instrumen valid: MCP tetap harus memverifikasi instrumennya. Timeframe, mode, dan drawing menggunakan allowlist enum yang sama di frontend/bridge; rules juga membatasi skema dan enum.

Bridge mengklaim dokumen melalui transaksi sekaligus mengunci `bridgeLocks/tradingview` supaya beberapa worker tidak mengubah chart bersamaan. Bridge menambahkan `claimToken` dan `leaseExpiresAt` (metadata internal, ditolak untuk write klien). Transisi: `pending → processing → completed | failed`. Hasil: `result: {text: string, screenshot: null}`. Error: `{code, message}`. Field screenshot adalah slot opsional untuk metadata `{storagePath, mimeType, capturedAt}` tahap berikutnya, **belum diunggah atau dirender**.

Timeout menghentikan tree proses Codex. SIGINT/SIGTERM menghentikan listener, membatalkan job aktif, dan mencoba menyimpan status gagal. Crash/power loss dipulihkan dengan menandai lease kedaluwarsa sebagai gagal saat bridge kembali berjalan. Lease berakhir pada timeout + 60 detik. Job tidak otomatis diulang karena drawing mungkin sudah dibuat. Penyimpanan hasil boleh dicoba ulang tanpa menjalankan Codex ulang. Token mencegah hasil worker lama menimpa status baru. Ini bukan jaminan exactly-once untuk side effect MCP saat OS/proses berhenti ekstrem; periksa chart sebelum mengirim ulang job gagal.

Riwayat memuat 30 dokumen terbaru per halaman, query milik pengguna saja. Klien tidak boleh update/delete dokumen atau membaca lock. Dashboard menunjukkan status jaringan browser, **bukan heartbeat laptop**; job pending tetap menunggu ketika bridge mati. Tahap ini belum punya kuota/rate limiting server; penguncian OWNER_UID wajib sebelum penggunaan pribadi dari internet untuk membatasi pemakai yang bisa menjalankan bridge.

## Pengujian lokal

`npm test`: validasi/injeksi field, isolasi config/tools/env, transaksi klaim bersamaan, lock chart, hasil stale, dan pemulihan crash menggunakan model transaksi in-memory. Tidak memakai akun Firebase dan tidak menjalankan analisis nyata.

`npm run test:rules`: Firebase Firestore Emulator (Java 21+ disarankan; unduhan pertama membutuhkan internet), project ID **demo-tradingview-remote**, port localhost:8080. Menguji isolasi data antarpengguna, create/query valid, akses anonim, status palsu, field tambahan, enum invalid, dan larangan update/delete. Tidak mengakses project produksi.

Untuk verifikasi end-to-end sebenarnya: aktifkan Google Auth/rules/indeks secara manual, login frontend, hidupkan bridge dan TradingView, kirim satu request, amati pending → processing → completed/failed dan bandingkan drawing/hasil dengan chart. Alur akun nyata ini tidak bisa dipastikan hanya dari build atau simulasi.

## Referensi implementasi

- [Codex non-interactive](https://developers.openai.com/codex/noninteractive)
- [Referensi konfigurasi Codex](https://developers.openai.com/codex/config-reference)
- [Transaksi Firestore](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Vite PWA](https://vite-pwa-org.netlify.app/guide/)

Jika penghentian tree proses Codex tidak dapat dipastikan (`KILL_UNCONFIRMED`), bridge berhenti dan menandai lock `bridgeLocks/tradingview` dengan `blocked: true`. Pastikan proses Codex/MCP job sudah berhenti sebelum menghapus lock tersebut secara manual melalui Admin/Console. Lock terblokir tidak diklaim otomatis oleh worker lain.

## Deployment GitHub Pages

Workflow `.github/workflows/deploy-pages.yml` membangun dan memublikasikan **hanya `web/dist`** setelah lint/test lulus. Push ke `main` atau jalankan workflow manual. Pilih Settings → Pages → Source: GitHub Actions pada repository tujuan. Bridge, service account, dan environment lokal tidak termasuk artefak website; bridge tetap berjalan di laptop. Jangan memasukkan service account sebagai secret workflow ini.

Base path mengikuti output Configure Pages otomatis, sehingga aset, manifest, start URL, scope, dan service worker bekerja pada `/nama-repository/` maupun domain root. Untuk menguji subpath lokal:

```powershell
$env:VITE_BASE_PATH = '/TradingViewRemote/'
npm run build
npm run preview
```

Buka `http://127.0.0.1:4173/TradingViewRemote/`. Hapus environment `VITE_BASE_PATH` dari terminal setelah pengujian untuk kembali ke build root. Setelah deployment, tambahkan hostname Pages (misalnya `kaffahstorage-stack.github.io`, tanpa path repository) ke Firebase Authentication Authorized domains. Pengaturan Firebase tersebut tetap manual.
