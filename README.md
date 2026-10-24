# MonGem 💎

**MonGem adalah platform mini game on-chain di Monad.** Game pertamanya **Ludo** 🎲: turnamen Ludo full on-chain. Tiket masuk disimpan smart contract sebagai prize pool, dadu dilempar kontrak, dan hadiah langsung cair ke pemenang. Tidak ada server. Game berikutnya (Ular Tangga, Congklak, Gaple/Domino) memakai pola yang sama.

Ludo berjalan di dua kontrak Solidity:

- **`LudoArena`** (game, prize pool, Weekly Rank), Monad Testnet: [`0x4b4596bcca1ddb8B327EDcdAd0a66baC4Eee4676`](https://testnet.monadvision.com/address/0x4b4596bcca1ddb8B327EDcdAd0a66baC4Eee4676)
- **`ArenaChat`** (chat on-chain per room): [`0xEEf1D8B937E78fCBE02caBB04728BF7d029e14c4`](https://testnet.monadvision.com/address/0xEEf1D8B937E78fCBE02caBB04728BF7d029e14c4)
- Rata-rata waktu konfirmasi transaksi (smoke test): **907 ms** (lempar dadu: **822 ms**)
- Contoh match on-chain: [tx lemparan penutup room #2](https://testnet.monadvision.com/tx/0x672a14a2bdfe81a24f26d97960934150c486b13d84f5e3e87ee9cfc803ce8c88) (hadiah dibayar di tx yang sama)

## Masalah & solusi

Turnamen game online berhadiah biasanya mengharuskan pemain percaya pada server. Server memegang prize pool, server mengocok dadu, dan server memutuskan kapan hadiah dibayar. Pemain tidak bisa membuktikan apakah semua itu adil.

MonGem memindahkan semuanya ke kontrak. Untuk Ludo, kontraknya adalah `LudoArena`:

- **Tiket masuk** disimpan di kontrak sebagai prize pool saat pemain masuk room.
- **Dadu** dilempar oleh kontrak, dan posisi semua pion tersimpan on-chain.
- **Pemenang** ditentukan dari urutan finish yang dicatat kontrak.
- **Hadiah** dikirim ke juara di transaksi yang sama dengan lemparan terakhir.

## Kenapa ini menaikkan volume & TVL Monad

- **Setiap match = tiket masuk + payout.** Untuk N pemain ada N transaksi tiket masuk dan 1 transaksi pembayaran hadiah.
- **Setiap lempar dadu = 1 transaksi.** Satu match 2 pemain di smoke test butuh 13 lemparan.
- **10% prize pool tiap match masuk prize pool mingguan (Weekly Rank)**, dan MON itu tetap terkunci di kontrak sampai minggu difinalisasi.
- **Sponsor (atau Monad) bisa menambah prize pool mingguan** lewat `fundWeeklyPool()`, sehingga ada insentif untuk terus bermain.
- **Chat on-chain di setiap room.** Setiap pesan = 1 transaksi Monad lewat kontrak `ArenaChat`, dan muncul dalam < 1 detik. Ngobrol dan "GG" pun ikut menambah aktivitas on-chain.
- **"MON terkunci di arena"** (saldo kontrak) tampil real-time di UI.

## Kenapa harus Monad

Game turn-based on-chain hanya enak dimainkan kalau setiap giliran terasa instan. Dengan **blok 300 ms dan finality 600 ms**, satu lemparan dadu rata-rata terkonfirmasi dalam waktu kurang dari satu detik.

Hasil smoke test di Monad Testnet (19 transaksi, diukur dari kirim tx sampai receipt, sudah termasuk latensi jaringan ke RPC publik):

| | Rata-rata | Median | Min | Max |
|---|---|---|---|---|
| Semua transaksi | 907 ms | 690 ms | 643 ms | 2443 ms |
| Lempar dadu | 822 ms | 698 ms | 643 ms | 1532 ms |

Karena Monad kompatibel penuh dengan EVM, kontraknya ditulis dengan Solidity biasa dan frontend memakai viem.

## Aturan main

- 2–4 pemain, masing-masing punya 1 pion. Papan berisi 28 kotak keliling, dan posisi ≥ 28 berarti finish.
- Dadu 1–6. Dapat 6 berarti jalan lagi.
- Pion yang mendarat di kotak lawan memakan pion lawan, dan pion itu kembali ke start.
- Kalau pemain diam lebih dari 60 detik, siapa saja bisa melakukan auto-roll untuknya, jadi game tidak macet.
- Game selesai saat tinggal satu pemain yang belum finish.

**Pembagian hadiah** (dari total tiket masuk)

| Pemain | Juara 1 | Juara 2 | Juara 3 | Prize pool mingguan |
|---|---|---|---|---|
| 4 | 50% | 25% | 15% | 10% |
| 3 | 60% | 30% | – | 10% |
| 2 | 90% | – | – | 10% |

**Weekly Rank:** juara 1, 2, dan 3 di setiap match mendapat 3, 2, dan 1 poin. Setelah minggu berakhir, siapa saja bisa memanggil `finalizeWeek(week)`, lalu prize pool mingguan dibagi **50/30/20** ke top 3. Untuk demo, panjang satu minggu adalah 5 menit.

## Arsitektur

```
Browser (tab ?p=1..4)                          Monad Testnet
┌───────────────────────────────┐  tx game     ┌─────────────────────────┐
│ /  →  /games  →  /games/ludo  │  (tanpa      │ LudoArena.sol           │
│                               │   popup)     │ room · dadu · settlement│
│ MetaMask (login, isi, tarik)  │ ───────────▶ │ Weekly Rank · prize pool│
│ Session wallet (tanda tangan  │ ◀─────────── │                         │
│ semua tx game)                │ getRoom +    └─────────────────────────┘
└───────────────────────────────┘ eth_getLogs
```

**Alur:**
1. **`/`**: landing dengan statistik live dari kontrak, lalu "Login dengan MetaMask".
2. **`/games`**: pilih game. Ludo sudah LIVE; Ular Tangga, Congklak, dan Gaple/Domino segera hadir.
3. **`/games/ludo`**: lobby, room, dan Weekly Rank.

- **`contracts/LudoArena.sol`**: satu kontrak Solidity 0.8.26 tanpa owner dan tanpa admin. Isinya room, lemparan dadu, pembagian hadiah, dan Weekly Rank.
- **`contracts/ArenaChat.sol`** ([`0xEEf1…14c4`](https://testnet.monadvision.com/address/0xEEf1D8B937E78fCBE02caBB04728BF7d029e14c4)): chat on-chain per room. `say(roomId, text)` (1–140 karakter) memancarkan event `Message`. Frontend membaca event ini di request `eth_getLogs` yang sama dengan event game (dua alamat dalam satu request), jadi chat tidak menambah request RPC. Pesan dikirim dari session wallet tanpa popup, maksimal 1 pesan per 2 detik.
- **`app/games/ludo/page.tsx`**: halaman game. Halaman ini membaca `getRoom` dan event lewat polling `eth_getLogs` dengan rentang maksimal 80 blok, lalu menampilkan papan, log permainan, lobby, dan leaderboard.
- **Login MetaMask** (`app/providers.tsx`):
  - MetaMask dicari lewat EIP-6963 (`io.metamask`), bukan langsung `window.ethereum`, karena wallet bawaan Brave bisa menimpanya.
  - Setelah connect, MetaMask otomatis pindah ke Monad Testnet. Kalau jaringannya belum ada, jaringan itu ditambahkan dulu.
  - Saat refresh, login tersambung ulang lewat `eth_accounts` tanpa popup.
- **Session wallet**:
  - Burner yang terikat ke akun MetaMask: satu key per akun dan per slot tab, disimpan di localStorage (`ludo-session-<alamat>-<slot>`).
  - Semua transaksi game ditandatangani session wallet, jadi tidak ada popup.
  - Header menampilkan saldo sesi dengan tombol **Isi saldo** (MetaMask → sesi) dan **Tarik** (seluruh saldo sesi → MetaMask, dikurangi 21000 × maxFeePerGas karena Monad menagih gas limit).
  - Logout hanya keluar dari aplikasi. Key sesi tetap disimpan, jadi saldonya tidak hilang.
- **Bukti on-chain di UI:**
  - Setiap baris log permainan, chat, dan live feed bisa diklik ke tx-nya di explorer.
  - Kotak **Escrow** menunjukkan prize pool yang dikunci kontrak (Dikunci atau Sudah dibayar), plus "Hadiah +X MON → alamat juara" dengan link ke tx `GameEnded`.
  - **Statistik arena**: total volume, room main/selesai, hadiah dibayar, MON terkunci, dan prize pool mingguan. Semuanya dihitung dari `getRoom` 100 room terakhir dalam satu `eth_call` Multicall3, diperbarui tiap 6 detik. Data yang sama dipakai untuk **riwayat** 10 room terakhir.
- **`lib/arena.ts`**: chain, RPC, ABI, dan helper yang dipakai bersama semua halaman.
- **Penyesuaian khusus Monad:**
  - Monad menagih gas dari gas *limit*. Karena itu gas diambil dari estimasi × 1.3. Lemparan yang bisa menutup game diberi batas bawah dari gas nyata di Monad (218.427 untuk 2 pemain, diukur dengan `eth_estimateGas` + state override): 218.427 × 1,5, ditambah 60.000 per pemenang tambahan. Sebelumnya batas bawahnya 900k, jadi biaya lemparan penutup turun dari 0,0918 menjadi ±0,033 MON.
  - Ada jeda ±2 detik sebelum transaksi yang membawa MON, mengikuti aturan reserve balance.
  - RPC publik membatasi request per IP (15 request/detik), padahal demo menjalankan 4 tab di satu laptop. Untuk itu frontend:
    - menggabungkan pembacaan kontrak yang bersamaan lewat Multicall3,
    - polling lebih jarang, berhenti saat tab tidak aktif, dan tidak menumpuk tick,
    - pindah otomatis ke RPC cadangan (monadinfra, Ankr) kalau satu RPC menolak.
- **`scripts/smoke-test.mjs`**: uji end-to-end ke kontrak live, dari beli tiket masuk, main sampai selesai, verifikasi hadiah, sampai refund.

## Menjalankan lokal

```bash
npm install
echo "NEXT_PUBLIC_LUDO_ADDRESS=0x4b4596bcca1ddb8B327EDcdAd0a66baC4Eee4676" > .env.local
echo "NEXT_PUBLIC_CHAT_ADDRESS=0xEEf1D8B937E78fCBE02caBB04728BF7d029e14c4" >> .env.local
npm run dev
```

**Demo 4 pemain di 1 laptop:** buka 4 tab berikut dan login dengan MetaMask yang sama. Setiap tab mendapat session wallet sendiri.

- http://localhost:3000/?p=1
- http://localhost:3000/?p=2
- http://localhost:3000/?p=3
- http://localhost:3000/?p=4

1. Isi saldo sesi di tiap tab lewat tombol "Isi saldo" di header, atau dari [faucet](https://faucet.monad.xyz). Sekitar 0,5 MON per sesi sudah cukup.
2. Buka Ludo. Tab 1 membuat room 4 pemain.
3. Tab 2–4 join dari lobby.
4. Lempar dadu bergiliran sampai game selesai.

**Smoke test** (butuh ±0,6 MON testnet + gas, sisa saldo dikembalikan otomatis):

```bash
PRIVATE_KEY=0x... node scripts/smoke-test.mjs
```

**Deploy sendiri** (Foundry):

```bash
forge create contracts/LudoArena.sol:LudoArena --use 0.8.26 \
  --rpc-url https://testnet-rpc.monad.xyz --private-key $PRIVATE_KEY \
  --broadcast --constructor-args 300   # 300 = 1 minggu demo (5 menit)
forge create contracts/ArenaChat.sol:ArenaChat --use 0.8.26 \
  --rpc-url https://testnet-rpc.monad.xyz --private-key $PRIVATE_KEY --broadcast
```

## Rencana ke depan

- **VRF untuk dadu.** Dadu saat ini memakai `prevrandao` + `blockhash`, yang secara teori bisa dimanipulasi validator.
- **Mode no-loss.** Tiket masuk diparkir di vault yield, dan yang diperebutkan hanya yield-nya.
- **Aturan Ludo penuh.** 4 pion per pemain, jalur home, dan kotak aman.
- **Anti-sybil untuk leaderboard.** Mencegah satu orang memakai banyak wallet untuk mengumpulkan poin Weekly Rank.
