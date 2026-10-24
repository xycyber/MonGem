/* ============================================================================
 * Smoke test LudoArena di Monad testnet (kontrak live).
 *
 *   PRIVATE_KEY=0x... node scripts/smoke-test.mjs
 *
 * Alamat kontrak dibaca dari LUDO_ADDRESS atau NEXT_PUBLIC_LUDO_ADDRESS di .env.local.
 * Alur: 2 burner baru diisi 0.3 MON → A createRoom(2) setor 0.01 → B joinRoom →
 * lempar dadu bergiliran sampai Finished → verifikasi hadiah & pool mingguan →
 * sisa saldo burner dikembalikan ke akun PRIVATE_KEY.
 * ========================================================================== */

import { readFileSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  fallback,
  formatEther,
  http,
  keccak256,
  parseAbi,
  parseEther,
  parseEventLogs,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.RPC_URL || "https://testnet-rpc.monad.xyz";
const RPC_URLS = process.env.RPC_URL
  ? [process.env.RPC_URL]
  : [RPC, "https://monad-testnet.drpc.org", "https://rpc.ankr.com/monad_testnet"];
const EXPLORER = "https://testnet.monadvision.com";
const FUND = parseEther("0.3");
const TOP_UP = parseEther("0.2");
const STAKE = parseEther("0.01");
const TRACK = 28;
// Di Monad gas ditagih dari gas LIMIT; lemparan yang bisa menutup game (2 pemain) diberi
// batas bawah = gas nyata 218.427 × 1,5 (sama dengan frontend).
const FINISH_ROLL_GAS_FLOOR = 327_641n;
// Aturan reserve balance: transaksi bervalue dari akun < 10 MON butuh jeda ±3 blok.
const VALUE_TX_GAP_MS = 2000;
const MAX_ROLLS = 200;
// RPC publik membatasi request per IP (HTTP 429): request bersamaan digabung jadi satu
// JSON-RPC batch, dan kalau satu RPC menolak, pindah ke RPC cadangan.
const transport = () =>
  fallback(RPC_URLS.map((url) => http(url, { batch: { wait: 10 }, retryCount: 2, retryDelay: 300 })));
const RECEIPT_POLL_MS = 150;

const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  testnet: true,
});

const ABI = parseAbi([
  "struct Room { uint256 stake; uint64 lastAction; uint8 maxPlayers; uint8 playerCount; uint8 turn; uint8 finishedCount; uint8 state; address[4] players; uint8[4] positions; bool[4] done; address[4] ranking; }",
  "function createRoom(uint8 maxPlayers) payable returns (uint256 roomId)",
  "function joinRoom(uint256 roomId) payable",
  "function roll(uint256 roomId)",
  "function getRoom(uint256 roomId) view returns (Room)",
  "function weeklyPool(uint256 week) view returns (uint256)",
  "function claimable(address who) view returns (uint256)",
  "function seasonStart() view returns (uint256)",
  "function weekLength() view returns (uint256)",
  "event RoomCreated(uint256 indexed roomId, address indexed creator, uint256 stake, uint8 maxPlayers)",
  "event DiceRolled(uint256 indexed roomId, address indexed player, uint8 dice, uint8 newPosition, address captured)",
  "event PlayerFinished(uint256 indexed roomId, address indexed player, uint8 place)",
  "event GameEnded(uint256 indexed roomId, address[3] winners, uint256[3] prizes, uint256 toWeeklyPool)",
]);

// ---------------------------------------------------------------- setup
function contractAddress() {
  if (process.env.LUDO_ADDRESS) return process.env.LUDO_ADDRESS;
  try {
    const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const m = env.match(/^NEXT_PUBLIC_LUDO_ADDRESS=(0x[0-9a-fA-F]{40})\s*$/m);
    if (m) return m[1];
  } catch {
    /* .env.local tidak ada */
  }
  throw new Error("Alamat kontrak tidak ditemukan. Isi NEXT_PUBLIC_LUDO_ADDRESS di .env.local");
}

const rawKey = process.env.PRIVATE_KEY?.trim();
if (!rawKey) throw new Error("PRIVATE_KEY belum di-set");
const ownerKey = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
const owner = { name: "Owner", account: privateKeyToAccount(ownerKey) };

// Burner diturunkan dari PRIVATE_KEY + id run, jadi bisa dibuat ulang untuk menyapu saldo
// kalau run sebelumnya gagal di tengah. File .smoke-last-run hanya berisi id run, bukan key.
const RUN_FILE = new URL("./.smoke-last-run", import.meta.url);
const burner = (name, runId) => ({
  name,
  account: privateKeyToAccount(keccak256(toBytes(`${ownerKey}:ludo-smoke:${runId}:${name}`))),
});
let prevRunId = null;
try {
  prevRunId = readFileSync(RUN_FILE, "utf8").trim() || null;
} catch {
  /* run pertama */
}
const runId = String(Date.now());
writeFileSync(RUN_FILE, `${runId}\n`);
const A = burner("A", runId);
const B = burner("B", runId);
const address = contractAddress();
const pc = createPublicClient({ chain: monadTestnet, transport: transport() });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mon = (v) => `${formatEther(v)} MON`;
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

const nonces = new Map();
const lastTxAt = new Map();
const timings = [];
let lastBlock = 0n;

async function retry(fn, tries = 6, delay = 300) {
  for (let k = 1; ; k++) {
    try {
      return await fn();
    } catch (e) {
      if (k >= tries) throw e;
      await sleep(delay);
    }
  }
}

// ---------------------------------------------------------------- transaksi
async function sendTx(who, label, { to, data, value = 0n, gas, fees }) {
  const addr = who.account.address;
  if (value > 0n) {
    const wait = VALUE_TX_GAP_MS - (Date.now() - (lastTxAt.get(addr) ?? 0));
    if (wait > 0) await sleep(wait);
  }
  if (!nonces.has(addr)) nonces.set(addr, await pc.getTransactionCount({ address: addr, blockTag: "pending" }));
  const wallet = createWalletClient({ account: who.account, chain: monadTestnet, transport: transport() });
  const request = await wallet.prepareTransactionRequest({
    to,
    data,
    value,
    gas,
    nonce: nonces.get(addr),
    ...(fees ?? {}),
  });
  const serializedTransaction = await wallet.signTransaction(request);

  const hash = keccak256(serializedTransaction);
  const t0 = performance.now();
  try {
    await pc.sendRawTransaction({ serializedTransaction });
  } catch (e) {
    // Kiriman yang di-retry transport bisa ditolak karena sudah masuk mempool.
    if (!/already known|known transaction|already imported|nonce too low/i.test(`${e.details ?? ""} ${e.message}`)) throw e;
  }
  const receipt = await waitReceipt(hash);
  const ms = Math.round(performance.now() - t0);

  nonces.set(addr, nonces.get(addr) + 1);
  lastTxAt.set(addr, Date.now());
  if (receipt.blockNumber > lastBlock) lastBlock = receipt.blockNumber;
  timings.push({ label, ms });
  if (receipt.status !== "success") throw new Error(`${label} revert: ${EXPLORER}/tx/${hash}`);
  return { receipt, ms, gas, hash };
}

/** Satu eth_getTransactionReceipt per polling (lebih hemat dari waitForTransactionReceipt). */
async function waitReceipt(hash, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await pc.getTransactionReceipt({ hash });
    } catch (e) {
      if (e.name !== "TransactionReceiptNotFoundError") throw e;
    }
    if (Date.now() > until) throw new Error(`Receipt tidak muncul: ${EXPLORER}/tx/${hash}`);
    await sleep(RECEIPT_POLL_MS);
  }
}

async function transfer(from, to, value, label) {
  const r = await sendTx(from, label, { to, value, gas: 21_000n });
  console.log(`  ${label}: ${mon(value)} → ${short(to)} | ${r.ms} ms`);
  return r;
}

/** Pastikan saldo cukup untuk value + gasLimit × maxFee; kalau kurang, isi dari owner. */
async function ensureFunds(who, gas, value) {
  const [balance, fees] = await Promise.all([
    pc.getBalance({ address: who.account.address }),
    pc.estimateFeesPerGas(),
  ]);
  const need = value + gas * fees.maxFeePerGas;
  if (balance >= need) return;
  const amount = need - balance > TOP_UP ? need - balance + TOP_UP : TOP_UP;
  console.log(`  ⚠ saldo burner ${who.name} ${mon(balance)} < kebutuhan ${mon(need)}, top-up dari owner`);
  await transfer(owner, who.account.address, amount, `top-up ${who.name}`);
}

async function call(who, label, functionName, args, { value = 0n, gasFloor } = {}) {
  const est = await retry(() =>
    pc.estimateContractGas({ address, abi: ABI, functionName, args, value, account: who.account }),
  );
  let gas = (est * 13n) / 10n;
  if (gasFloor && gas < gasFloor) gas = gasFloor;
  await ensureFunds(who, gas, value);
  const data = encodeFunctionData({ abi: ABI, functionName, args });
  const res = await sendTx(who, label, { to: address, data, value, gas });
  return { ...res, est, logs: parseEventLogs({ abi: ABI, logs: res.receipt.logs }) };
}

const readRoom = (roomId, blockNumber) =>
  pc.readContract({ address, abi: ABI, functionName: "getRoom", args: [roomId], blockNumber });

/** Baca room di blok yang sudah memuat transaksi terakhir (RPC bisa sedikit tertinggal). */
const readRoomSynced = (roomId) => retry(() => readRoom(roomId, lastBlock), 10, 200);

const balanceAt = (who, blockNumber) =>
  retry(() => pc.getBalance({ address: who.account.address, blockNumber }), 10, 200);

// ---------------------------------------------------------------- main
async function main() {
  console.log(`Kontrak : ${address}  (${EXPLORER}/address/${address})`);
  console.log(`Owner   : ${owner.account.address}  saldo ${mon(await pc.getBalance({ address: owner.account.address }))}`);
  console.log(`Burner A: ${A.account.address}`);
  console.log(`Burner B: ${B.account.address}\n`);

  if (prevRunId) {
    const prev = [burner("A", prevRunId), burner("B", prevRunId)];
    const left = await Promise.all(prev.map((p) => pc.getBalance({ address: p.account.address })));
    if (left.some((v) => v > 0n)) {
      console.log("0) Sapu sisa saldo burner dari run sebelumnya");
      await refund(prev);
      console.log();
    }
  }

  console.log("1) Isi saldo burner");
  await transfer(owner, A.account.address, FUND, "fund A");
  await transfer(owner, B.account.address, FUND, "fund B");

  console.log("\n2) Buat & isi room");
  const created = await call(A, "createRoom", "createRoom", [2], { value: STAKE });
  const roomId = created.logs.find((l) => l.eventName === "RoomCreated").args.roomId;
  console.log(`  A createRoom(2) setor ${mon(STAKE)} → room #${roomId} | ${created.ms} ms`);
  const joined = await call(B, "joinRoom", "joinRoom", [roomId], { value: STAKE });
  console.log(`  B joinRoom(${roomId}) | ${joined.ms} ms`);

  let room = await readRoomSynced(roomId);
  if (room.state !== 1) throw new Error(`State room ${room.state}, harusnya 1 (Playing)`);
  const players = [A, B];
  const byAddr = (a) => players.find((p) => same(p.account.address, a));

  console.log("\n3) Lempar dadu bergiliran");
  let final = null;
  let rolls = 0;
  while (room.state === 1) {
    if (++rolls > MAX_ROLLS) throw new Error("Terlalu banyak lemparan");
    const i = room.turn;
    const who = byAddr(room.players[i]);
    const from = room.positions[i];
    const nearFinish = from >= TRACK - 6;

    const res = await call(who, `roll #${rolls}`, "roll", [roomId], {
      gasFloor: nearFinish ? FINISH_ROLL_GAS_FLOOR : undefined,
    });
    const dr = res.logs.find((l) => l.eventName === "DiceRolled").args;
    const to = dr.newPosition >= TRACK ? "FINISH" : `kotak ${dr.newPosition}`;
    const cap = dr.captured !== "0x0000000000000000000000000000000000000000" ? ` · makan ${byAddr(dr.captured).name}` : "";
    const again = dr.dice === 6 && dr.newPosition < TRACK ? " · dapat 6, jalan lagi" : "";
    console.log(
      `  #${String(rolls).padStart(2)} ${who.name} lempar ${dr.dice}: ${String(from).padStart(2)} → ${to}${cap}${again}` +
        ` | gas ${res.gas} (est ${res.est}) | ${res.ms} ms`,
    );
    for (const l of res.logs.filter((x) => x.eventName === "PlayerFinished"))
      console.log(`      🏁 ${byAddr(l.args.player).name} finish urutan #${l.args.place}`);

    const ended = res.logs.find((l) => l.eventName === "GameEnded");
    if (ended) final = { ...res, who, ended: ended.args };
    room = await readRoomSynced(roomId);
  }
  if (room.state !== 2 || !final) throw new Error(`Game berhenti di state ${room.state}`);

  console.log("\n4) Verifikasi hasil");
  const pot = room.stake * BigInt(room.playerCount);
  const champ = byAddr(room.ranking[0]);
  const expectedPrize = (pot * 9000n) / 10_000n;
  const expectedPool = pot - expectedPrize;
  const { winners, prizes, toWeeklyPool } = final.ended;
  const blk = final.receipt.blockNumber;
  const checks = [];
  const check = (ok, text) => {
    checks.push(ok);
    console.log(`  ${ok ? "✅" : "❌"} ${text}`);
  };

  console.log(`  Urutan finish: ${room.ranking.slice(0, room.playerCount).map((a, k) => `#${k + 1} ${byAddr(a).name}`).join(", ")}`);
  console.log(`  Pot: ${mon(pot)}`);
  check(same(winners[0], champ.account.address), `GameEnded.winners[0] = juara 1 (${champ.name})`);
  check(prizes[0] === expectedPrize, `GameEnded.prizes[0] = 90% pot (${mon(prizes[0])})`);
  check(toWeeklyPool === expectedPool, `GameEnded.toWeeklyPool = 10% pot (${mon(toWeeklyPool)})`);

  // Saldo juara: tepat sebelum vs sesudah blok penutup. Biaya tx ditambahkan kembali kalau juara yang melempar.
  const [before, after, block, claim] = await Promise.all([
    balanceAt(champ, blk - 1n),
    balanceAt(champ, blk),
    pc.getBlock({ blockNumber: blk }),
    pc.readContract({ address, abi: ABI, functionName: "claimable", args: [champ.account.address] }),
  ]);
  const price = final.receipt.effectiveGasPrice;
  const paidByChamp = final.who === champ;
  const feeLimit = paidByChamp ? final.gas * price : 0n;
  const feeUsed = paidByChamp ? final.receipt.gasUsed * price : 0n;
  const delta = after - before;
  const matchLimit = delta + feeLimit === expectedPrize;
  const matchUsed = delta + feeUsed === expectedPrize;
  check(
    matchLimit || matchUsed,
    `Saldo juara 1 naik ${mon(delta)} + biaya gas ${mon(matchLimit ? feeLimit : feeUsed)} = ${mon(expectedPrize)}` +
      (paidByChamp ? ` (biaya dihitung dari gas ${matchLimit ? "LIMIT" : "terpakai"})` : ""),
  );
  check(claim === 0n, "claimable juara 1 = 0 (transfer langsung berhasil)");

  const [seasonStart, weekLength] = await Promise.all([
    pc.readContract({ address, abi: ABI, functionName: "seasonStart" }),
    pc.readContract({ address, abi: ABI, functionName: "weekLength" }),
  ]);
  const week = (block.timestamp - seasonStart) / weekLength;
  const [poolBefore, poolAfter] = await Promise.all(
    [blk - 1n, blk].map((blockNumber) =>
      retry(() => pc.readContract({ address, abi: ABI, functionName: "weeklyPool", args: [week], blockNumber })),
    ),
  );
  check(
    poolAfter - poolBefore === expectedPool,
    `weeklyPool[minggu ${week}] bertambah ${mon(poolAfter - poolBefore)} (10% pot): ${mon(poolBefore)} → ${mon(poolAfter)}`,
  );
  console.log(`  Tx penutup: ${EXPLORER}/tx/${final.hash}`);

  return checks.every(Boolean);
}

async function refund(list) {
  for (const who of list) {
    try {
      const wait = VALUE_TX_GAP_MS - (Date.now() - (lastTxAt.get(who.account.address) ?? 0));
      if (wait > 0) await sleep(wait);
      const [balance, fees] = await Promise.all([
        balanceAt(who, lastBlock || undefined),
        pc.estimateFeesPerGas(),
      ]);
      const value = balance - 21_000n * fees.maxFeePerGas;
      if (value <= 0n) {
        console.log(`  ${who.name}: saldo ${mon(balance)}, tidak cukup untuk biaya transfer`);
        continue;
      }
      const r = await sendTx(who, `refund ${who.name}`, {
        to: owner.account.address,
        value,
        gas: 21_000n,
        fees: { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas },
      });
      console.log(`  refund ${who.name}: ${mon(value)} → owner | ${r.ms} ms`);
    } catch (e) {
      console.log(`  ❌ refund ${who.name} gagal: ${e.shortMessage ?? e.message}`);
    }
  }
}

function summary() {
  if (!timings.length) return;
  const all = timings.map((t) => t.ms);
  const rolls = timings.filter((t) => t.label.startsWith("roll")).map((t) => t.ms);
  const stat = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const avg = Math.round(s.reduce((a, b) => a + b, 0) / s.length);
    return `rata-rata ${avg} ms · median ${s[Math.floor(s.length / 2)]} ms · min ${s[0]} ms · max ${s.at(-1)} ms`;
  };
  console.log("\nWaktu konfirmasi (kirim tx → receipt):");
  console.log(`  semua tx (${all.length}) : ${stat(all)}`);
  if (rolls.length) console.log(`  lempar dadu (${rolls.length}): ${stat(rolls)}`);
}

let ok = false;
try {
  ok = await main();
} catch (e) {
  console.error(`\n❌ ${e.shortMessage ?? e.message}${e.details ? `\n   detail: ${e.details}` : ""}${e.status ? ` (HTTP ${e.status})` : ""}`);
} finally {
  console.log("\n5) Kembalikan sisa saldo burner ke owner");
  await refund([A, B]);
  summary();
  console.log(`\n${ok ? "✅ SMOKE TEST LULUS" : "❌ SMOKE TEST GAGAL"}`);
  process.exitCode = ok ? 0 : 1;
}
