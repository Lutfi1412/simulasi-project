# Aplikasi Android — Simulasi Trading

Aplikasi mobile **Kotlin + Jetpack Compose + WebView** untuk membuka dashboard yang sama
dengan versi web, ditambah pemantauan latar belakang supaya sinyal dan patokan tetap
terdeteksi saat HP di tangan dan aplikasi tidak dibuka.

Folder proyek (di luar repo ini):

```
C:\Users\sawal fitah\AndroidStudioProjects\simulasi-trading
```

Hasil build release:

```
...\simulasi-trading\release\simulasi-trading-v1.0.0-release.apk
```

## Fitur

- **UI web penuh** di dalam WebView: tema, grafik zoom/pan, kartu model, reset, trade
  blotter, log, Cek WS, ON/OFF, dan patokan web semuanya sama karena memuat situs yang sama.
- **Latar belakang aktif secara default** setelah aplikasi pertama kali dibuka
  (`Prefs.isEnabled` default `true`). Foreground service tipe `specialUse` tetap berjalan
  saat layar mati / aplikasi di belakang, dan dinyalakan lagi setelah HP reboot.
- **Polling `/api/snapshot` tiap 10 detik** untuk mendeteksi sinyal baru dan memantau harga.
- **Notifikasi + suara**:
  - sinyal: `notif.mp3` 1× lalu ucapan “sinyal long/short dari model …” 3×;
  - patokan: 3 siklus (`notif.mp3` + ucapan “patokan … sudah di tercapai”);
  - suara memakai `MediaPlayer` + `TextToSpeech` (bahasa Indonesia bila tersedia).
- **Patokan lebih dari satu** di layar native, disimpan di SharedPreferences supaya bisa
  diperiksa layanan saat aplikasi tertutup. Versi web tetap punya daftar patokan sendiri
  di localStorage.
- **Pengaturan URL server** dari dalam aplikasi (tombol **Set**), penting karena URL
  Cloudflare Quick Tunnel bisa berubah setelah tunnel di-restart / VPS reboot.
- Tombol **Patokan**, **Set**, dan **OFF/ON** di bar atas native; tombol kembali mengikuti
  riwayat WebView.

## Cara kerja background

1. `MainActivity` memulai `MonitorService` saat dibuka (default ON) dan meminta izin
   `POST_NOTIFICATIONS` di Android 13+.
2. `MonitorService` menampilkan notifikasi layanan (ongoing), mengambil wake-lock parsial,
   lalu memanggil `GET {baseUrl}/api/snapshot` secara berkala.
3. Sinyal baru dikenali dari kunci `botId-ts-side`; kunci yang sudah pernah dilihat disimpan
   di SharedPreferences (maksimal 300 kunci), jadi tidak ada notifikasi ulang saat service
   restart.
4. Patokan native yang `waiting` dan sudah tersentuh harga ditandai `reached` (sekali) lalu
   memicu notifikasi + suara.
5. Saat aplikasi sedang terlihat, layanan tidak membunyikan notifikasi ganda (UI web sudah
   menangani sinyal dan patokan web).

> Beberapa produsen HP (Xiaomi/Oppo/Vivo/Samsung) mematikan aplikasi latar belakang secara
> agresif. Gunakan tombol **“Izinkan jalan di latar belakang”** di pengaturan aplikasi dan,
> bila perlu, kunci aplikasi di daftar recent apps.

## Apakah ikut ter-update saat web di-update?

**Ya, untuk UI.** WebView memuat `https://<server>/` dari VPS, jadi setiap deploy web baru
langsung terpakai tanpa rebuild APK. Yang tidak ikut otomatis adalah lapisan native:
notifikasi, suara, dan pemantauan patokan latar belakang. Kalau fitur web baru
membutuhkan API browser yang tidak didukung WebView, atau ingin perilaku background baru,
APK perlu di-build ulang.

## Build ulang

Syarat: JDK 17+ dan Android SDK (platform 35, build-tools 36). Gradle wrapper 8.9.

```powershell
cd C:\Users\sawal fitah\AndroidStudioProjects\simulasi-trading
.\gradlew.bat assembleRelease
```

Konfigurasi signing dibaca dari `keystore.properties` (tidak di-commit):

```
storeFile=D:/key_realese/key-simulasi.jks
storePassword=...
keyAlias=simulasi
keyPassword=...
```

Salin hasil `app\build\outputs\apk\release\app-release.apk` ke folder `release\`.

## Catatan

- Aplikasi tidak menyimpan data historis 305 menit. Semua data trading tetap di backend
  VPS (`/home/ubuntu/simulasi-project/data`), dan aplikasi hanya membaca API.
- Tidak ada order nyata; ini tetap paper trading.
