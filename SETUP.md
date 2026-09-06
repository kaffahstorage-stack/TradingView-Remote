# TradingView Remote — chat

PWA chat berbahasa Indonesia (waktu Asia/Makassar) untuk meminta analisis chart melalui Firebase dan bridge Codex lokal. Tidak menjalankan transaksi. Frontend dipublikasikan melalui GitHub Pages di https://kaffahstorage-stack.github.io/TradingView-Remote/. Workflow menjalankan lint, test, dan build ketika perubahan didorong ke main.

## Frontend lokal

Node.js 22+ diperlukan. Dari root repository:

```powershell
npm install
npm run dev
```

Buka http://127.0.0.1:5173 dan login Google. Sesudah login langsung masuk chat. Enter mengirim, Shift+Enter membuat baris baru. Pesan maksimal 1.500 karakter. Mode `?demo=1` hanya tersedia pada localhost/127.0.0.1, tidak mengirim request Firebase, dan memakai hasil simulasi. Status demo tetap Offline/Disconnected.

```powershell
npm run lint
npm test
npm run build
npm run preview
```

Preview default http://127.0.0.1:4173. Service worker aktif pada build production. Instal Android memerlukan HTTPS (atau localhost untuk pengujian di komputer). Tombol Instal menyediakan prompt browser/petunjuk Android. Cache service worker hanya untuk aset aplikasi, bukan data Firebase. Tidak memakai Analytics atau Firebase Storage. Saat offline kerangka aplikasi tetap tersedia; pengiriman memerlukan Firebase.

## Migrasi Firebase manual

Tidak ada konfigurasi Firebase online yang diubah oleh implementasi ini.

1. Pertahankan Google Authentication dan authorized domains yang sudah bekerja. Untuk Pages gunakan hostname `kaffahstorage-stack.github.io`, tanpa path repository. Izinkan popup login.
2. Terapkan **rules terbaru** dari `firestore.rules` melalui Console setelah diperiksa. Rules lama menolak format request chat dan pembacaan `bridgeStatus`, sehingga status dapat Offline dengan pesan akses ditolak.
3. **Pertahankan UID pemilik sebenarnya** jika rules online sudah dikunci. Jangan menggantinya kembali dengan placeholder `OWNER_UID`. Placeholder lokal mengizinkan akun login mengakses dokumennya sendiri; untuk pemakaian pribadi kunci `authorized()` ke UID Anda. Samakan UID ini dengan `OWNER_UID` pada bridge.
4. Pertahankan/buat indeks collection `analysisRequests`: `userId` Ascending + `createdAt` Descending, sesuai `firestore.indexes.json`. Tunggu status indeks Enabled. Query bridge equality memakai indeks bawaan.
5. Service account hanya berada di laptop, di luar repository, dengan akses Firestore minimum yang diperlukan. Admin SDK melewati Rules; jangan bagikan kredensial tersebut.

Klien hanya boleh membuat request pending miliknya dan membaca dokumen sendiri. Klien tidak boleh mengubah hasil/status, menghapus request, menulis heartbeat, atau mengakses lock. Request dashboard lama tetap dapat dibaca dan diproses.

## Bridge lokal

1. Instal/login Codex CLI pada akun OS yang sama. Binary harus mendukung `exec --ignore-user-config --ignore-rules --strict-config --ephemeral` dan `--output-schema`. Gunakan executable native `codex.exe`, bukan shim `.cmd`/`.ps1`.
2. Pertahankan server stdio `[mcp_servers.tradingview]` yang sudah terdaftar di konfigurasi Codex. MCP harus menyediakan `tv_health_check`, baca chart, set simbol/timeframe, drawing, dan `capture_screenshot`.
3. Salin `bridge/.env.example` menjadi `bridge/.env`; isi `GOOGLE_APPLICATION_CREDENTIALS` dengan path JSON di luar Git, `OWNER_UID`, `CODEX_EXECUTABLE`, dan lokasi TradingView. `CODEX_CONFIG_PATH` opsional. Jangan memasukkan kredensial Admin ke variabel VITE_*.
4. Jalankan TradingView/MCP lokal seperti biasa. CDP harus hanya di loopback 127.0.0.1:9222; jangan membuka/tunnel port ke internet. Lokasi `TRADINGVIEW_EXECUTABLE` merupakan referensi peluncuran manual.
5. Jalankan `npm run bridge` dari root. Restart bridge setelah memperbarui kode/dependensi.

Prompt diteruskan melalui stdin menggunakan spawn tanpa shell. Tool Codex dibatasi; tidak tersedia transaksi, shell, klik/evaluate UI, atau eksekusi Pine. Simbol/timeframe yang disebut harus diverifikasi melalui MCP. Drawing lama dipertahankan; tool penghapusan satu drawing hanya diizinkan bila pesan secara eksplisit meminta penghapusan. Tidak tersedia penghapusan massal tanpa batas.

Bridge mengklaim request dan lock chart melalui transaksi, memproses satu job, lalu menyimpan hasil atau error. Claim token mencegah worker lama menimpa hasil. Timeout menghentikan tree proses; shutdown membatalkan job aktif. Lease kedaluwarsa ditandai gagal, tidak otomatis mengulang drawing. Jika `KILL_UNCONFIRMED`, lock ditandai blocked: pastikan proses job telah berhenti sebelum menghapus lock secara manual. Tidak ada jaminan exactly-once untuk drawing saat mesin mati mendadak.

## Skema chat, hasil, dan status

Request chat pada `analysisRequests/{id}` mempertahankan field lama: `userId`, `symbol: null`, `timeframe: null`, `mode: instruction`, `drawings: []`, `instruction`, `status: pending`, `createdAt: serverTimestamp`, serta `startedAt`, `completedAt`, `result`, `error` awalnya null. Field tambahan `requestType: chat` membedakannya dari formulir lama. Instruksi wajib berisi 1–1.500 karakter dan bukan perintah shell.

Hasil `result` berisi `text`, `summary`, `symbol`, `timeframe`, dan `screenshot` opsional. Jawaban meminta level numerik, batas supply/demand, atau harga entry/SL/TP beserta jarak dalam point/pip berdasarkan data chart. Hasil merupakan analisis, bukan kepastian. Ketika data tidak tersedia, bridge tidak mengarang harga.

Screenshot MCP diambil setelah analisis ketika lock chart masih dimiliki. Gambar dikompresi menjadi JPEG dan disimpan sebagai `{mimeType, data, width, height, capturedAt}` pada result (base64 maksimal 480.000 karakter). Ini tidak membutuhkan Storage. Jika MCP mengembalikan file, hanya file raster dalam direktori screenshot tepercaya yang diterima. `TRADINGVIEW_SCREENSHOT_DIR` dapat diisi; default diinferensikan dari lokasi `src/server.js` MCP. Kegagalan screenshot menyimpan `screenshotError` tanpa membuang jawaban teks. Gambar di chat dapat diperbesar. Dokumen gambar menambah bandwidth Firestore; riwayat dimuat 30 request per halaman.

Bridge menulis `bridgeStatus/{OWNER_UID}` sekitar setiap 20 detik, dengan `userId`, `checkedAt` server timestamp, `cdp_connected`, dan `api_available` dari hasil nyata `tv_health_check`. TradingView Connected memerlukan kedua boolean true dan heartbeat tidak lebih tua dari 60 detik. Status Online memerlukan respons server Firebase terbaru, bukan hanya status jaringan browser. Tidak adanya heartbeat berarti Disconnected.

## Notifikasi

Izin hanya diminta setelah tombol **Aktifkan notifikasi** ditekan. Saat tab/PWA masih berjalan, transisi request menjadi completed memunculkan notifikasi lokal dengan ringkasan hasil. Riwayat lama tidak memicu ulang notifikasi. Klik notifikasi membuka request terkait melalui `?request=ID`; akses tetap membutuhkan login pemilik. Browser/OS dapat menangguhkan aplikasi di latar belakang, sehingga fallback ini **tidak menjamin notifikasi saat aplikasi tertutup**.

Push saat aplikasi tertutup belum diaktifkan. Langkah lanjutan manual:

1. Buat Web Push certificate/VAPID public key di Firebase Cloud Messaging. Public key boleh di frontend; private key dan service account tidak boleh.
2. Tambahkan Firebase Messaging setelah pengguna memberi izin; simpan/rotasi token perangkat pada dokumen milik pengguna dengan Rules khusus.
3. Integrasikan handler push Firebase Messaging ke service worker `web/src/sw.js` yang sama, sambil mempertahankan precache dan notificationclick. Hindari dua worker yang saling menggantikan.
4. Tambahkan pengiriman FCM dari bridge/backend tepercaya setelah hasil berhasil disimpan, deduplikasi per request/perangkat, dan hapus token kedaluwarsa. Jangan kirim data akun atau instruksi lengkap pada notifikasi.
5. Uji HTTPS di Android dengan PWA tertutup, token berubah, izin dicabut, dan klik menuju percakapan setelah login. Konfigurasi ini memerlukan implementasi lanjutan; menambahkan VAPID saja belum cukup.

## Verifikasi dan dependensi

`npm test` menguji validasi chat/legacy, prompt dan pembatasan tool, klaim/lock, hasil Codex, heartbeat kedaluwarsa, keamanan screenshot, serta transisi notifikasi. `npm run test:rules` menggunakan Firestore Emulator project **demo-tradingview-remote**, bukan produksi; memerlukan Java 21+ dan unduhan emulator pertama.

Pengujian akun nyata tetap manual: terapkan rules/index, login, hidupkan bridge dan TradingView, kirim analisis, bandingkan level/drawing/screenshot dengan chart, lalu matikan bridge dan pastikan status Disconnected setelah 60 detik. Periksa juga notifikasi setelah opt-in.

Audit dependensi masih memiliki temuan, termasuk sharp 0.34.x yang dipakai kompresi screenshot. Upaya upgrade otomatis sebelumnya ditolak pemeriksaan persetujuan alat karena batas penggunaan. Sebelum produksi, jalankan `npm install -w bridge sharp@^0.35.4`, perbarui/hapus sharp dev dependency web jika tidak dipakai, lalu ulangi test/build dan `npm audit`. firebase-tools dan dependency Firebase juga memiliki temuan transitif; evaluasi upgrade mayor secara terpisah, jangan menjalankan audit fix --force tanpa pengujian.

Workflow GitHub Pages hanya menerbitkan web/dist. Bridge tetap berjalan di laptop. Publikasi frontend tidak menerapkan Firestore Rules dan tidak menjalankan bridge di laptop; kedua langkah tersebut tetap manual.
