"use client";

"use client";

/* ============================================================================
 * LudoArena — halaman game Ludo (/games/ludo): lobby, room, dan Weekly Rank.
 *
 * Transaksi game dikirim dari session wallet (burner yang terikat ke akun MetaMask,
 * lihat app/providers.tsx), jadi tidak ada popup saat main.
 * Demo 4 pemain di 1 laptop: buka 4 tab dengan ?p=1, ?p=2, ?p=3, ?p=4.
 * ========================================================================== */

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { parseEther, parseEventLogs, type Address, type Hex } from "viem";
import { RequireLogin, useWallet } from "@/app/providers";
import { Btn, Card, Stat } from "@/components/ui";
import {
  ABI,
  CHAT_ABI,
  CHAT_ADDRESS,
  CHAT_CONFIGURED,
  CONFIGURED,
  CONTRACT_ADDRESS,
  EXPLORER,
  FAUCET,
  ZERO,
  fmt,
  pc,
  prettyError,
  read,
  same,
  short,
  sleep,
  startPolling,
  warnPoll,
  type Room,
} from "@/lib/arena";
import { ArenaStatsGrid } from "@/components/arena-stats";
import { useArenaStats } from "@/lib/use-arena-stats";

// ============================================================================ KONFIGURASI
const TRACK = 28; // harus sama dengan TRACK_LENGTH di kontrak
const TURN_TIMEOUT = 60; // harus sama dengan TURN_TIMEOUT di kontrak
// Di Monad, biaya gas dihitung dari gas LIMIT, jadi batas bawah lemparan dekat finish
// harus pas. Gas nyata lemparan penutup (eth_estimateGas + state override di Monad testnet):
// 2 pemain 218.427, 4 pemain/3 pemenang 341.750. Batas bawah = gas 2 pemain × 1,5,
// ditambah 60.000 per pemenang tambahan (room 3–4 pemain).
const FINISH_ROLL_GAS_2P = 218_427n;
const finishRollGasFloor = (players: number) =>
  (FINISH_ROLL_GAS_2P * 3n) / 2n +
  60_000n * BigInt(prizeSplit(players).length - 1);

// ============================================================================ TIPE & HELPER
type Leaderboard = {
  week: bigint;
  pool: bigint;
  top: readonly Address[];
  points: readonly bigint[];
  endsAt: number;
  prevPool: bigint;
  prevFinalized: boolean;
};

type ParsedLog = {
  eventName: string;
  args: Record<string, unknown>;
  transactionHash: Hex | null;
  logIndex: number | null;
};

type LogLine = { key: string; text: string; color: number; tx: Hex | null };
type ChatLine = {
  key: string;
  name: string;
  text: string;
  color: number;
  tx: Hex | null;
};

type FeedItem = { key: string; text: string; tx: Hex | null };

const CHAT_QUICK = ["👍", "😂", "🔥", "GG"];
const CHAT_COOLDOWN_MS = 2000; // maksimal 1 pesan per 2 detik

const COLORS = [
  { name: "Merah", dot: "bg-red-500", text: "text-red-400" },
  { name: "Biru", dot: "bg-sky-500", text: "text-sky-400" },
  { name: "Hijau", dot: "bg-emerald-500", text: "text-emerald-400" },
  { name: "Kuning", dot: "bg-amber-400", text: "text-amber-300" },
];
const STATE_LABEL = ["Menunggu pemain", "Sedang main", "Selesai", "Dibatalkan"];
const MEDALS = ["🥇", "🥈", "🥉", "4️⃣"];

function prizeSplit(n: number): number[] {
  if (n === 4) return [50, 25, 15];
  if (n === 3) return [60, 30];
  return [90];
}

function countdown(s: number): string {
  if (s <= 0) return "sekarang";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `${d} hari ${h} jam`;
  if (h) return `${h} jam ${m} mnt`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Papan 8x8: 28 kotak keliling, index 0 = START (pojok kiri atas), searah jarum jam. */
function perimeterCell(i: number): { row: number; col: number } {
  if (i <= 7) return { row: 1, col: i + 1 };
  if (i <= 14) return { row: i - 6, col: 8 };
  if (i <= 21) return { row: 8, col: 8 - (i - 14) };
  return { row: 8 - (i - 21), col: 1 };
}

const readRoom = (id: bigint) => read<Room>("getRoom", [id]);

// ============================================================================ KOMPONEN KECIL
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Dice({ value, rolling }: { value: number | null; rolling: boolean }) {
  return (
    <div
      className={`grid h-14 w-14 grid-cols-3 grid-rows-3 gap-0.5 rounded-xl bg-white p-2 shadow-lg shadow-black/40 sm:h-16 sm:w-16 ${
        rolling ? "animate-spin" : ""
      }`}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className={`m-auto h-2 w-2 rounded-full sm:h-2.5 sm:w-2.5 ${
            !rolling && value && PIPS[value]?.includes(i)
              ? "bg-violet-900"
              : "bg-transparent"
          }`}
        />
      ))}
    </div>
  );
}

function Board({
  room,
  me,
  children,
}: {
  room: Room;
  me?: Address;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto grid aspect-square w-full max-w-[560px] grid-cols-8 grid-rows-8 gap-1 rounded-2xl bg-gradient-to-br from-violet-900/60 to-indigo-950/60 p-2 ring-1 ring-violet-400/20">
      {Array.from({ length: TRACK }, (_, i) => {
        const { row, col } = perimeterCell(i);
        const here = room.players
          .slice(0, room.playerCount)
          .map((p, idx) => ({ p, idx }))
          .filter(({ idx }) => !room.done[idx] && room.positions[idx] === i);
        return (
          <div
            key={i}
            style={{ gridRow: row, gridColumn: col }}
            className={`relative flex items-center justify-center rounded-md ${
              i === 0
                ? "bg-violet-500/50"
                : i % 7 === 0
                  ? "bg-fuchsia-500/20"
                  : "bg-white/[0.06]"
            }`}
          >
            <span className="absolute left-1 top-0.5 text-[7px] font-semibold text-violet-200/50 sm:text-[9px]">
              {i === 0 ? "START" : i}
            </span>
            <div className="flex flex-wrap items-center justify-center gap-0.5 pt-2">
              {here.map(({ p, idx }) => (
                <span
                  key={p}
                  title={COLORS[idx].name}
                  className={`h-3 w-3 rounded-full shadow-md ring-2 transition-all sm:h-5 sm:w-5 ${COLORS[idx].dot} ${
                    same(p, me) ? "ring-white" : "ring-black/40"
                  }`}
                />
              ))}
            </div>
          </div>
        );
      })}
      <div
        style={{ gridRow: "2 / 8", gridColumn: "2 / 8" }}
        className="flex flex-col items-center justify-center gap-3 rounded-xl bg-black/30 p-3 text-center"
      >
        {children}
      </div>
    </div>
  );
}

/** Teks yang bisa diklik ke halaman tx di explorer (bukti on-chain). */
function TxLink({ tx, children }: { tx: Hex | null; children: ReactNode }) {
  if (!tx) return <>{children}</>;
  return (
    <a
      href={`${EXPLORER}/tx/${tx}`}
      target="_blank"
      rel="noreferrer"
      title="Lihat transaksi di explorer"
      className="hover:underline"
    >
      {children}
    </a>
  );
}

/** 10 room terakhir yang selesai, dari data getRoom statistik arena. */
function History({
  rooms,
  me,
  onOpen,
}: {
  rooms: { id: bigint; room: Room }[] | null;
  me?: Address;
  onOpen: (id: bigint) => void;
}) {
  if (!rooms) return <p className="text-sm text-violet-300/70">Memuat…</p>;
  const done = rooms.filter(({ room }) => room.state === 2).slice(0, 10);
  if (!done.length)
    return (
      <p className="text-sm text-violet-300/70">Belum ada room yang selesai.</p>
    );
  return (
    <ul className="divide-y divide-white/5">
      {done.map(({ id, room: r }) => {
        const pool = r.stake * BigInt(r.playerCount);
        const ps = r.players.slice(0, r.playerCount);
        return (
          <li key={id.toString()} className="py-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <button
                onClick={() => onOpen(id)}
                className="font-semibold hover:text-violet-300"
              >
                Room #{id.toString()}
              </button>
              <span className="text-xs text-violet-300/70">
                {r.playerCount} pemain · Prize pool {fmt(pool)} MON
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {prizeSplit(r.playerCount).map((pct, k) => {
                const w = r.ranking[k];
                const idx = ps.findIndex((p) => same(p, w));
                return (
                  <span key={k} className="flex items-center gap-1.5">
                    {MEDALS[k]}
                    {idx >= 0 && (
                      <span
                        className={`h-2 w-2 rounded-full ${COLORS[idx].dot}`}
                      />
                    )}
                    <span className={idx >= 0 ? COLORS[idx].text : ""}>
                      {same(w, me)
                        ? "Kamu"
                        : idx >= 0
                          ? COLORS[idx].name
                          : short(w)}
                    </span>
                    <span className="tabular-nums text-violet-200">
                      +{fmt((pool * BigInt(pct)) / 100n)} MON
                    </span>
                  </span>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ============================================================================ HALAMAN
export default function LudoPage() {
  return (
    <RequireLogin>
      <LudoGame />
    </RequireLogin>
  );
}

function LudoGame() {
  // ---- wallet: session wallet milik akun MetaMask yang login (WalletProvider)
  const {
    address: mmAddress,
    slot,
    session: account,
    sessionWallet: wallet,
    balance,
    refreshBalance,
    lastTxAt,
    markTx,
    runTx,
    lastSpeed,
    setLastSpeed,
    topUp: topUpSession,
    withdraw,
  } = useWallet();
  const me = account?.address;
  const [ready, setReady] = useState(false);

  // ---- data on-chain
  const [roomId, setRoomId] = useState<bigint | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [openRooms, setOpenRooms] = useState<{ id: bigint; room: Room }[]>([]);
  const [lb, setLb] = useState<Leaderboard | null>(null);
  const [stats, setStats] = useState<{
    roomCount: bigint;
    locked: bigint;
  } | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [dice, setDice] = useState<number | null>(null);

  // ---- UI
  const [rolling, setRolling] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [stakeInput, setStakeInput] = useState("0.1");
  const [playersInput, setPlayersInput] = useState(4);
  const [topUpInput, setTopUpInput] = useState("0.5");
  const [roomInput, setRoomInput] = useState("");
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [endedTx, setEndedTx] = useState<Hex | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [feedTx, setFeedTx] = useState<{ tx: string; at: number }[]>([]);
  const arena = useArenaStats();
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const lastBlock = useRef<bigint | null>(null);
  const seenLogs = useRef(new Set<string>());
  const seenChat = useRef(new Set<string>());
  const lastChatAt = useRef(0);
  const chatBox = useRef<HTMLUListElement>(null);
  const feedSeen = useRef(new Set<string>());
  const season = useRef<{ start: bigint; length: bigint } | null>(null);

  // ---- room terakhir, disimpan per akun MetaMask + slot tab (?p=1, ?p=2, ...)
  const roomKey = mmAddress ? `ludo-room-${mmAddress.toLowerCase()}-${slot}` : null;
  useEffect(() => {
    if (!roomKey) return;
    try {
      const savedRoom = localStorage.getItem(roomKey);
      if (savedRoom) setRoomId(BigInt(savedRoom));
    } catch {
      /* abaikan */
    }
    setReady(true);
  }, [roomKey]);

  useEffect(() => {
    if (!ready || !roomKey) return;
    try {
      if (roomId === null) localStorage.removeItem(roomKey);
      else localStorage.setItem(roomKey, roomId.toString());
    } catch {
      /* abaikan */
    }
  }, [ready, roomId, roomKey]);

  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  // ---- leaderboard & statistik arena
  useEffect(() => {
    if (!CONFIGURED) return;
    let alive = true;
    const tick = async () => {
      try {
        if (!season.current) {
          const [start, length] = await Promise.all([
            read<bigint>("seasonStart"),
            read<bigint>("weekLength"),
          ]);
          season.current = { start, length };
        }
        const week = await read<bigint>("currentWeek");
        const [pool, topRes, roomCount, locked, prevPool, prevFinalized] =
          await Promise.all([
            read<bigint>("weeklyPool", [week]),
            read<readonly [readonly Address[], readonly bigint[]]>(
              "getWeeklyTop",
              [week],
            ),
            read<bigint>("roomCount"),
            pc.getBalance({ address: CONTRACT_ADDRESS }),
            week > 0n
              ? read<bigint>("weeklyPool", [week - 1n])
              : Promise.resolve(0n),
            week > 0n
              ? read<boolean>("weekFinalized", [week - 1n])
              : Promise.resolve(true),
          ]);
        if (!alive || !season.current) return;
        const { start, length } = season.current;
        setLb({
          week,
          pool,
          top: topRes[0],
          points: topRes[1],
          endsAt: Number(start + (week + 1n) * length),
          prevPool,
          prevFinalized,
        });
        setStats({ roomCount, locked });
      } catch (e) {
        warnPoll(e);
      }
    };
    const stop = startPolling(tick, 6000);
    return () => {
      alive = false;
      stop();
    };
  }, []);

  // ---- lobby: room yang masih terbuka
  useEffect(() => {
    if (!CONFIGURED || roomId !== null) return;
    let alive = true;
    const tick = async () => {
      try {
        const ids = await read<readonly bigint[]>("getOpenRooms", [20n]);
        const rooms = await Promise.all(
          ids.map(async (id) => ({ id, room: await readRoom(id) })),
        );
        if (alive) setOpenRooms(rooms);
      } catch (e) {
        warnPoll(e);
      }
    };
    const stop = startPolling(tick, 4000);
    return () => {
      alive = false;
      stop();
    };
  }, [roomId]);

  // ---- ubah event on-chain jadi log permainan
  const ingest = useCallback(
    (items: ParsedLog[], id: bigint, r: Room) => {
      const nameOf = (a: unknown) => {
        const addr = String(a);
        if (same(addr, me)) return "Kamu";
        const idx = r.players.findIndex((p) => same(p, addr));
        return idx >= 0 ? COLORS[idx].name : short(addr);
      };
      const colorOf = (a: unknown) =>
        r.players.findIndex((p) => same(p, String(a)));
      const fresh: LogLine[] = [];
      let lastDice: number | null = null;
      let endedHash: Hex | null = null;

      for (const l of items) {
        const args = l.args ?? {};
        if (args.roomId === undefined || (args.roomId as bigint) !== id)
          continue;
        const key = `${l.transactionHash}-${l.logIndex}`;
        if (seenLogs.current.has(key)) continue;
        seenLogs.current.add(key);

        let text = "";
        let color = colorOf(args.player);
        switch (l.eventName) {
          case "PlayerJoined":
            text = `${nameOf(args.player)} masuk room`;
            break;
          case "PlayerLeft":
            text = `${nameOf(args.player)} keluar room (tiket masuk dikembalikan)`;
            break;
          case "GameStarted":
            text = "Room penuh, game dimulai! 🎲";
            color = -1;
            break;
          case "DiceRolled": {
            const d = Number(args.dice);
            const pos = Number(args.newPosition);
            lastDice = d;
            text = `${nameOf(args.player)} lempar ${d} → ${pos >= TRACK ? "FINISH" : `kotak ${pos}`}`;
            if (args.captured && !same(String(args.captured), ZERO))
              text += ` · makan pion ${nameOf(args.captured)} 💥`;
            if (d === 6 && pos < TRACK) text += " · dapat 6, jalan lagi!";
            break;
          }
          case "PlayerFinished":
            text = `🏁 ${nameOf(args.player)} finish urutan #${Number(args.place)}`;
            break;
          case "GameEnded":
            text = `🏆 Game selesai! Hadiah langsung dikirim ke pemenang, ${fmt(args.toWeeklyPool as bigint)} MON masuk prize pool mingguan`;
            color = -1;
            endedHash = l.transactionHash;
            break;
          default:
            continue;
        }
        fresh.push({ key, text, color, tx: l.transactionHash });
      }
      if (fresh.length)
        setLogs((prev) => [...fresh.reverse(), ...prev].slice(0, 40));
      if (lastDice !== null) setDice(lastDice);
      if (endedHash) setEndedTx(endedHash);
    },
    [me],
  );

  // ---- pesan chat on-chain (ArenaChat) untuk room ini
  const ingestChat = useCallback(
    (items: ParsedLog[], id: bigint, r: Room) => {
      const fresh: ChatLine[] = [];
      for (const l of items) {
        const args = l.args ?? {};
        if (l.eventName !== "Message" || (args.roomId as bigint) !== id)
          continue;
        const key = `${l.transactionHash}-${l.logIndex}`;
        if (seenChat.current.has(key)) continue;
        seenChat.current.add(key);
        const from = String(args.from);
        const idx = r.players
          .slice(0, r.playerCount)
          .findIndex((pl) => same(pl, from));
        fresh.push({
          key,
          name: same(from, me)
            ? "Kamu"
            : idx >= 0
              ? COLORS[idx].name
              : short(from),
          text: String(args.text),
          color: idx,
          tx: l.transactionHash,
        });
      }
      if (fresh.length) setChat((prev) => [...prev, ...fresh].slice(-60));
    },
    [me],
  );

  useEffect(() => {
    const el = chatBox.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

  // ---- live feed semua room sejak halaman dibuka (dari getLogs room yang sama, tanpa filter roomId)
  const ingestFeed = useCallback((items: ParsedLog[]) => {
    const at = Date.now();
    const fresh: FeedItem[] = [];
    const txs: string[] = [];
    for (const l of items) {
      const key = `${l.transactionHash}-${l.logIndex}`;
      if (feedSeen.current.has(key)) continue;
      const a = l.args ?? {};
      const rid = `#${String(a.roomId)}`;
      let text: string;
      switch (l.eventName) {
        case "DiceRolled":
          text = `🎲 Room ${rid}: ${short(String(a.player))} lempar ${Number(a.dice)}`;
          break;
        case "PlayerFinished":
          text = `🏁 Room ${rid}: ${short(String(a.player))} finish #${Number(a.place)}`;
          break;
        case "GameEnded":
          text = `🏆 Room ${rid} selesai, hadiah dibayar`;
          break;
        case "Message":
          text = `💬 Room ${rid}: ${short(String(a.from))}: ${String(a.text)}`;
          break;
        default:
          continue;
      }
      feedSeen.current.add(key);
      fresh.push({ key, text, tx: l.transactionHash });
      if (l.transactionHash && !txs.includes(l.transactionHash))
        txs.push(l.transactionHash);
    }
    if (!fresh.length) return;
    setFeed((prev) => [...fresh.reverse(), ...prev].slice(0, 20));
    setFeedTx((prev) => {
      const known = new Set(prev.map((t) => t.tx));
      return [
        ...prev.filter((t) => t.at >= at - 60_000),
        ...txs.filter((tx) => !known.has(tx)).map((tx) => ({ tx, at })),
      ];
    });
  }, []);

  // ---- room aktif: state + event (polling cepat, blok Monad 300 ms)
  useEffect(() => {
    if (!CONFIGURED || roomId === null) return;
    let alive = true;
    lastBlock.current = null;
    seenLogs.current = new Set();
    seenChat.current = new Set();
    setLogs([]);
    setChat([]);
    setDice(null);
    setRoom(null);
    setEndedTx(null);

    const tick = async () => {
      try {
        const r = await readRoom(roomId);
        if (!alive) return;
        setRoom(r);
        const latest = await pc.getBlockNumber();
        let from =
          lastBlock.current === null ? latest - 80n : lastBlock.current + 1n;
        if (latest - from > 80n) from = latest - 80n; // RPC membatasi rentang eth_getLogs
        if (from < 0n) from = 0n;
        if (from > latest) return;
        // Event game + chat diambil dalam satu request eth_getLogs.
        const raw = await pc.getLogs({
          address: CHAT_CONFIGURED
            ? [CONTRACT_ADDRESS, CHAT_ADDRESS]
            : CONTRACT_ADDRESS,
          fromBlock: from,
          toBlock: latest,
        });
        if (!alive) return;
        lastBlock.current = latest;
        const ludoLogs = parseEventLogs({
          abi: ABI,
          logs: raw.filter((l) => same(l.address, CONTRACT_ADDRESS)),
        }) as unknown as ParsedLog[];
        const chatLogs = parseEventLogs({
          abi: CHAT_ABI,
          logs: raw.filter((l) => same(l.address, CHAT_ADDRESS)),
        }) as unknown as ParsedLog[];
        ingest(ludoLogs, roomId, r);
        ingestChat(chatLogs, roomId, r);
        ingestFeed([...ludoLogs, ...chatLogs]);
      } catch (e) {
        warnPoll(e);
      }
    };
    const stop = startPolling(tick, 1500);
    return () => {
      alive = false;
      stop();
    };
  }, [roomId, ingest, ingestChat, ingestFeed]);

  // ---- kirim transaksi dari burner (tanpa popup)
  const send = useCallback(
    async (
      label: string,
      functionName: string,
      args: readonly unknown[],
      value?: bigint,
      gasFloor?: bigint,
    ) => {
      if (!wallet || !account) return null;
      setBusy(label);
      setError(null);
      try {
        // Antre bersama transaksi lain dari session wallet (chat, tarik) supaya nonce tidak bentrok.
        return await runTx(async () => {
          // Aturan reserve balance Monad: transaksi yang membawa MON dari akun bersaldo < 10 MON
          // sebaiknya diberi jeda ±3 blok dari transaksi sebelumnya.
          if (value && value > 0n) {
            const wait = 2000 - (Date.now() - lastTxAt.current);
            if (wait > 0) await sleep(wait);
          }
          const est = await pc.estimateContractGas({
            address: CONTRACT_ADDRESS,
            abi: ABI,
            functionName,
            args,
            value,
            account,
          });
          let gas = (est * 13n) / 10n;
          if (gasFloor && gas < gasFloor) gas = gasFloor;

          const t0 = performance.now();
          const hash = await wallet.writeContract({
            address: CONTRACT_ADDRESS,
            abi: ABI,
            functionName,
            args,
            value,
            gas,
          });
          markTx();
          const receipt = await pc.waitForTransactionReceipt({
            hash,
            pollingInterval: 250,
          });
          setLastSpeed(Math.round(performance.now() - t0));
          refreshBalance();
          if (receipt.status !== "success")
            throw new Error(
              "Transaksi revert (state berubah atau gas kurang). Coba lagi.",
            );
          return receipt;
        });
      } catch (e) {
        setError(prettyError(e));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [wallet, account, lastTxAt, markTx, runTx, setLastSpeed, refreshBalance],
  );

  // ---- aksi
  const createRoom = async () => {
    let value: bigint;
    try {
      value = parseEther(stakeInput);
    } catch {
      setError("Harga tiket masuk tidak valid");
      return;
    }
    if (value <= 0n) return setError("Harga tiket masuk harus lebih dari 0");
    const rc = await send("Membuat room…", "createRoom", [playersInput], value);
    if (!rc) return;
    const ev = (
      parseEventLogs({ abi: ABI, logs: rc.logs }) as unknown as ParsedLog[]
    ).find((l) => l.eventName === "RoomCreated");
    if (ev) setRoomId(ev.args.roomId as bigint);
  };

  const joinRoom = async (id: bigint, stake: bigint) => {
    const rc = await send("Bergabung ke room…", "joinRoom", [id], stake);
    if (rc) setRoomId(id);
  };

  const leaveRoom = async () => {
    if (roomId === null) return;
    const rc = await send("Keluar room…", "leaveRoom", [roomId]);
    if (rc) setRoomId(null);
  };

  const rollDice = async () => {
    if (!room || roomId === null) return;
    const nearFinish = room.positions[room.turn] >= TRACK - 6;
    setRolling(true);
    const rc = await send(
      "Melempar dadu…",
      "roll",
      [roomId],
      undefined,
      nearFinish ? finishRollGasFloor(room.playerCount) : undefined,
    );
    setRolling(false);
    if (!rc) return;
    ingest(
      parseEventLogs({ abi: ABI, logs: rc.logs }) as unknown as ParsedLog[],
      roomId,
      room,
    );
    try {
      setRoom(await readRoom(roomId));
    } catch {
      /* polling akan menyusul */
    }
  };

  const finalizeWeek = async () => {
    if (!lb || lb.week === 0n) return;
    await send("Membagikan hadiah mingguan…", "finalizeWeek", [lb.week - 1n]);
  };

  const sponsor = async () => {
    await send(
      "Menambah hadiah mingguan…",
      "fundWeeklyPool",
      [],
      parseEther("0.1"),
    );
  };

  const topUp = () => topUpSession(topUpInput);

  // ---- chat on-chain: dikirim dari session wallet, antre bersama transaksi game
  const sendChat = useCallback(
    async (text: string) => {
      const msg = text.trim();
      if (!msg || roomId === null || !room || !wallet || !account) return;
      if (!CHAT_CONFIGURED) return;
      if (new TextEncoder().encode(msg).length > 140)
        return setChatError("Pesan terlalu panjang (maks 140 karakter).");
      const wait = CHAT_COOLDOWN_MS - (Date.now() - lastChatAt.current);
      if (wait > 0)
        return setChatError(
          `Tunggu ${Math.ceil(wait / 1000)} detik sebelum kirim lagi.`,
        );
      lastChatAt.current = Date.now();
      setChatBusy(true);
      setChatError(null);
      try {
        const rc = await runTx(async () => {
          const est = await pc.estimateContractGas({
            address: CHAT_ADDRESS,
            abi: CHAT_ABI,
            functionName: "say",
            args: [roomId, msg],
            account,
          });
          const hash = await wallet.writeContract({
            address: CHAT_ADDRESS,
            abi: CHAT_ABI,
            functionName: "say",
            args: [roomId, msg],
            gas: (est * 13n) / 10n,
          });
          markTx();
          return pc.waitForTransactionReceipt({ hash, pollingInterval: 250 });
        });
        if (rc.status !== "success")
          throw new Error("Pesan gagal terkirim. Coba lagi.");
        setChatInput((cur) => (cur.trim() === msg ? "" : cur));
        ingestChat(
          parseEventLogs({ abi: CHAT_ABI, logs: rc.logs }) as unknown as ParsedLog[],
          roomId,
          room,
        );
        refreshBalance();
      } catch (e) {
        setChatError(prettyError(e));
      } finally {
        setChatBusy(false);
      }
    },
    [roomId, room, wallet, account, runTx, markTx, ingestChat, refreshBalance],
  );

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  // ---- turunan
  const players = room ? room.players.slice(0, room.playerCount) : [];
  const myIndex = room ? players.findIndex((p) => same(p, me)) : -1;
  const isPlaying = room?.state === 1;
  const isMyTurn = !!room && isPlaying && myIndex === room.turn;
  const timeoutLeft = room ? Number(room.lastAction) + TURN_TIMEOUT - now : 0;
  const canAutoRoll = !!room && isPlaying && !isMyTurn && timeoutLeft < 0;
  const pot = room ? room.stake * BigInt(room.playerCount) : 0n;
  const roomMissing = !!room && room.playerCount === 0 && room.state === 0;
  const txLastMinute = feedTx.filter((t) => t.at >= now * 1000 - 60_000).length;

  // ============================================================================ RENDER
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">
        {/* Judul halaman */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link
              href="/games"
              className="text-sm text-violet-300 hover:text-white"
            >
              ← Semua game
            </Link>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">
              🎲 Ludo
            </h1>
            <p className="mt-1 text-sm text-violet-300/70">
              Beli tiket masuk, lempar dadu on-chain, hadiah juara 1–3 langsung
              cair · Weekly Rank berhadiah
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {stats && (
              <Stat
                label="MON terkunci di arena"
                value={`${fmt(stats.locked)} MON`}
              />
            )}
            {stats && (
              <Stat label="Total room" value={stats.roomCount.toString()} />
            )}
            {lastSpeed !== null && (
              <Stat
                label="Tx terakhir terkonfirmasi"
                value={`${lastSpeed} ms ⚡`}
              />
            )}
          </div>
        </div>

        {!CONFIGURED && (
          <div className="mb-4 rounded-xl bg-amber-500/15 px-4 py-3 text-sm text-amber-100 ring-1 ring-amber-500/30">
            Isi <code className="font-mono">NEXT_PUBLIC_LUDO_ADDRESS</code> di{" "}
            <code className="font-mono">.env.local</code> dengan alamat kontrak
            LudoArena yang sudah kamu deploy, lalu jalankan ulang server.
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-100 ring-1 ring-red-500/30">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-200 hover:text-white"
              aria-label="Tutup"
            >
              ✕
            </button>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* ================= KONTEN UTAMA ================= */}
          <section className="min-w-0">
            {roomId === null ? (
              /* ---------------- LOBBY ---------------- */
              <div className="space-y-6">
                <ArenaStatsGrid stats={arena} />

                <Card title="Buat room baru">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="text-sm text-violet-200">
                      Tiket masuk per pemain (MON)
                      <input
                        value={stakeInput}
                        onChange={(e) => setStakeInput(e.target.value)}
                        inputMode="decimal"
                        className="mt-1 block w-32 rounded-lg bg-black/30 px-3 py-2 text-violet-50 ring-1 ring-white/10 focus:outline-none focus:ring-violet-400"
                      />
                    </label>
                    <label className="text-sm text-violet-200">
                      Jumlah pemain
                      <select
                        value={playersInput}
                        onChange={(e) =>
                          setPlayersInput(Number(e.target.value))
                        }
                        className="mt-1 block rounded-lg bg-black/30 px-3 py-2 text-violet-50 ring-1 ring-white/10 focus:outline-none focus:ring-violet-400"
                      >
                        {[2, 3, 4].map((n) => (
                          <option key={n} value={n} className="bg-[#0d0a1c]">
                            {n} pemain
                          </option>
                        ))}
                      </select>
                    </label>
                    <Btn
                      onClick={createRoom}
                      disabled={!!busy || !CONFIGURED || !account}
                    >
                      Buat room
                    </Btn>
                  </div>
                  <p className="mt-3 text-xs text-violet-300/70">
                    Pembagian hadiah: total tiket masuk menjadi prize pool dan
                    dibagi ke juara. 4 pemain 50/25/15 · 3 pemain 60/30 · 2
                    pemain 90. Sisa 10% masuk prize pool mingguan (Weekly Rank).
                  </p>
                </Card>

                <Card
                  title="Room terbuka"
                  right={
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        try {
                          if (roomInput.trim())
                            setRoomId(BigInt(roomInput.trim()));
                        } catch {
                          setError("ID room tidak valid");
                        }
                      }}
                      className="flex items-center gap-2"
                    >
                      <input
                        value={roomInput}
                        onChange={(e) => setRoomInput(e.target.value)}
                        placeholder="ID"
                        className="w-16 rounded-lg bg-black/30 px-2 py-1.5 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-violet-400"
                      />
                      <Btn
                        type="submit"
                        variant="ghost"
                        className="!px-3 !py-1.5"
                      >
                        Tonton
                      </Btn>
                    </form>
                  }
                >
                  {openRooms.length === 0 ? (
                    <p className="text-sm text-violet-300/70">
                      Belum ada room terbuka. Buat satu di atas!
                    </p>
                  ) : (
                    <ul className="divide-y divide-white/5">
                      {openRooms.map(({ id, room: r }) => {
                        const joined = r.players.some((p) => same(p, me));
                        return (
                          <li
                            key={id.toString()}
                            className="flex flex-wrap items-center justify-between gap-3 py-3"
                          >
                            <div>
                              <div className="font-semibold">
                                Room #{id.toString()}
                              </div>
                              <div className="text-xs text-violet-300/70">
                                Tiket {fmt(r.stake)} MON · Prize pool{" "}
                                {fmt(r.stake * BigInt(r.maxPlayers))} MON
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex gap-1">
                                {Array.from(
                                  { length: r.maxPlayers },
                                  (_, i) => (
                                    <span
                                      key={i}
                                      className={`h-3 w-3 rounded-full ${i < r.playerCount ? COLORS[i].dot : "bg-white/10"}`}
                                    />
                                  ),
                                )}
                              </div>
                              {joined ? (
                                <Btn
                                  variant="ghost"
                                  onClick={() => setRoomId(id)}
                                >
                                  Masuk
                                </Btn>
                              ) : (
                                <Btn
                                  onClick={() => joinRoom(id, r.stake)}
                                  disabled={!!busy}
                                >
                                  Gabung · {fmt(r.stake)} MON
                                </Btn>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>

                <Card title="Riwayat permainan">
                  <History
                    rooms={arena?.rooms ?? null}
                    me={me}
                    onOpen={setRoomId}
                  />
                  <a
                    href={`${EXPLORER}/address/${CONTRACT_ADDRESS}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-block text-xs text-violet-300 hover:text-white"
                  >
                    Lihat semua transaksi kontrak di explorer ↗
                  </a>
                </Card>

                <Card title="Cara main">
                  <ol className="list-decimal space-y-1.5 pl-5 text-sm text-violet-200/90">
                    <li>
                      Isi saldo session wallet dari MetaMask. Session wallet
                      menandatangani otomatis, jadi tidak ada popup saat main.
                    </li>
                    <li>
                      Buat room atau gabung ke room terbuka. Semua pemain
                      membeli tiket masuk dengan harga yang sama, dan kontrak
                      menyimpannya sebagai prize pool.
                    </li>
                    <li>
                      Lempar dadu bergiliran. Dapat 6 jalan lagi, mendarat di
                      pion lawan = lawan balik ke START.
                    </li>
                    <li>
                      Kontrak yang menentukan urutan finish. Hadiah dari prize
                      pool langsung cair ke juara 1–3 (4 pemain 50/25/15, 3
                      pemain 60/30, 2 pemain 90). Tidak ada server yang bisa
                      curang.
                    </li>
                    <li>
                      10% prize pool tiap room masuk prize pool mingguan. Juara
                      dapat poin Weekly Rank (3/2/1), dan top 3 mingguan berbagi
                      prize pool mingguan (50/30/20).
                    </li>
                  </ol>
                </Card>
              </div>
            ) : (
              /* ---------------- ROOM ---------------- */
              <div className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <button
                      onClick={() => setRoomId(null)}
                      className="text-sm text-violet-300 hover:text-white"
                    >
                      ← Kembali ke lobby
                    </button>
                    <h2 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-bold">
                      Room #{roomId.toString()}
                      {room && !roomMissing && (
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium">
                          {STATE_LABEL[room.state]}
                        </span>
                      )}
                    </h2>
                    {room && !roomMissing && (
                      <p className="text-sm text-violet-300/70">
                        Tiket {fmt(room.stake)} MON · Prize pool {fmt(pot)} MON
                        ·{" "}
                        {room.playerCount}/{room.maxPlayers} pemain
                      </p>
                    )}
                  </div>
                </div>

                {!room ? (
                  <p className="text-sm text-violet-300/70">Memuat room…</p>
                ) : roomMissing ? (
                  <Card>
                    <p className="text-sm">
                      Room #{roomId.toString()} tidak ditemukan.
                    </p>
                  </Card>
                ) : (
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_250px]">
                    <div className="min-w-0 space-y-4">
                    <Board room={room} me={me}>
                      {room.state === 0 && (
                        <>
                          <div className="text-lg font-bold">
                            Menunggu pemain
                          </div>
                          <div className="flex gap-1.5">
                            {Array.from({ length: room.maxPlayers }, (_, i) => (
                              <span
                                key={i}
                                className={`h-4 w-4 rounded-full ${i < room.playerCount ? COLORS[i].dot : "bg-white/10"}`}
                              />
                            ))}
                          </div>
                          <p className="text-xs text-violet-300/70">
                            Game mulai otomatis saat room penuh
                          </p>
                          {myIndex >= 0 ? (
                            <Btn
                              variant="danger"
                              onClick={leaveRoom}
                              disabled={!!busy}
                            >
                              Keluar & ambil kembali tiket
                            </Btn>
                          ) : (
                            <Btn
                              onClick={() => joinRoom(roomId, room.stake)}
                              disabled={!!busy}
                            >
                              Gabung · {fmt(room.stake)} MON
                            </Btn>
                          )}
                        </>
                      )}

                      {room.state === 1 && (
                        <>
                          <Dice value={dice} rolling={rolling} />
                          <div className="text-sm sm:text-base">
                            Giliran{" "}
                            <span
                              className={`font-bold ${COLORS[room.turn].text}`}
                            >
                              {COLORS[room.turn].name}
                            </span>
                            {isMyTurn && (
                              <span className="font-bold"> (Kamu!)</span>
                            )}
                          </div>
                          {isMyTurn ? (
                            <Btn
                              variant="big"
                              onClick={rollDice}
                              disabled={!!busy}
                            >
                              {rolling ? "Melempar…" : "Lempar Dadu"}
                            </Btn>
                          ) : canAutoRoll ? (
                            <Btn
                              variant="ghost"
                              onClick={rollDice}
                              disabled={!!busy}
                            >
                              Pemain diam, lemparkan untuknya
                            </Btn>
                          ) : (
                            <p className="text-xs text-violet-300/70">
                              Menunggu lawan…{" "}
                              {timeoutLeft > 0 &&
                                `(auto-roll tersedia dalam ${timeoutLeft} dtk)`}
                            </p>
                          )}
                        </>
                      )}

                      {room.state === 2 && (
                        <>
                          <div className="text-lg font-black sm:text-2xl">
                            🏆 Game selesai
                          </div>
                          <div className="w-full max-w-[240px] space-y-1.5">
                            {room.ranking
                              .slice(0, room.playerCount)
                              .map((addr, k) => {
                                const idx = players.findIndex((p) =>
                                  same(p, addr),
                                );
                                const pct = prizeSplit(room.playerCount)[k];
                                return (
                                  <div
                                    key={k}
                                    className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-2 py-1 text-xs sm:text-sm"
                                  >
                                    <span className="flex items-center gap-1.5">
                                      {MEDALS[k]}
                                      {idx >= 0 && (
                                        <span
                                          className={`h-2.5 w-2.5 rounded-full ${COLORS[idx].dot}`}
                                        />
                                      )}
                                      {same(addr, me)
                                        ? "Kamu"
                                        : idx >= 0
                                          ? COLORS[idx].name
                                          : short(addr)}
                                    </span>
                                    <span className="font-semibold tabular-nums">
                                      {pct
                                        ? `+${fmt((pot * BigInt(pct)) / 100n)} MON`
                                        : "-"}
                                    </span>
                                  </div>
                                );
                              })}
                          </div>
                          <Btn variant="ghost" onClick={() => setRoomId(null)}>
                            Main lagi
                          </Btn>
                        </>
                      )}

                      {room.state === 3 && (
                        <div className="text-lg font-bold">Room dibatalkan</div>
                      )}
                    </Board>

                    <Card
                      title="📡 Live feed semua room"
                      right={
                        <span className="text-xs tabular-nums text-violet-300/80">
                          {txLastMinute} tx / 1 menit terakhir
                        </span>
                      }
                    >
                      {feed.length === 0 ? (
                        <p className="text-xs text-violet-300/60">
                          Menunggu aktivitas on-chain…
                        </p>
                      ) : (
                        <ul className="max-h-56 space-y-1 overflow-y-auto pr-1 text-xs text-violet-100">
                          {feed.map((f) => (
                            <li key={f.key} className="break-words">
                              <TxLink tx={f.tx}>{f.text}</TxLink>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Card>
                    </div>

                    <div className="space-y-4">
                      <Card title="🔒 Escrow">
                        <p className="text-sm text-violet-100">
                          Prize pool{" "}
                          <span className="font-bold tabular-nums">
                            {fmt(pot)} MON
                          </span>{" "}
                          dikunci di kontrak{" "}
                          <a
                            href={`${EXPLORER}/address/${CONTRACT_ADDRESS}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-violet-300 underline-offset-2 hover:text-white hover:underline"
                          >
                            {short(CONTRACT_ADDRESS)}
                          </a>
                        </p>
                        <span
                          className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${
                            room.state === 2
                              ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                              : room.state === 3
                                ? "bg-white/10 text-violet-200 ring-white/10"
                                : "bg-amber-500/15 text-amber-200 ring-amber-500/30"
                          }`}
                        >
                          {room.state === 2
                            ? "Sudah dibayar"
                            : room.state === 3
                              ? "Dikembalikan"
                              : "Dikunci"}
                        </span>
                        {room.state === 2 && (
                          <ul className="mt-3 space-y-1 text-xs">
                            {prizeSplit(room.playerCount).map((pct, k) => {
                              const w = room.ranking[k];
                              return (
                                <li key={k}>
                                  <a
                                    href={
                                      endedTx
                                        ? `${EXPLORER}/tx/${endedTx}`
                                        : `${EXPLORER}/address/${w}`
                                    }
                                    target="_blank"
                                    rel="noreferrer"
                                    className="hover:underline"
                                  >
                                    {MEDALS[k]} Hadiah +
                                    {fmt((pot * BigInt(pct)) / 100n)} MON →{" "}
                                    <span className="font-mono">{short(w)}</span>
                                  </a>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </Card>

                      <Card title="Pemain">
                        <ul className="space-y-1">
                          {Array.from({ length: room.maxPlayers }, (_, i) => {
                            const p = players[i];
                            if (!p)
                              return (
                                <li
                                  key={i}
                                  className="px-2 py-1.5 text-xs text-violet-300/40"
                                >
                                  Kursi kosong
                                </li>
                              );
                            const place = room.ranking.findIndex((r) =>
                              same(r, p),
                            );
                            return (
                              <li
                                key={p}
                                className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${
                                  isPlaying && room.turn === i
                                    ? "bg-white/10 ring-1 ring-violet-400/50"
                                    : ""
                                }`}
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <span
                                    className={`h-3 w-3 shrink-0 rounded-full ${COLORS[i].dot}`}
                                  />
                                  <span
                                    className={`text-sm font-semibold ${COLORS[i].text}`}
                                  >
                                    {COLORS[i].name}
                                  </span>
                                  <span className="truncate text-xs text-violet-300/60">
                                    {same(p, me) ? "Kamu" : short(p)}
                                  </span>
                                </span>
                                <span className="text-xs tabular-nums">
                                  {room.done[i]
                                    ? `🏁 #${place + 1}`
                                    : `${room.positions[i]}/${TRACK}`}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </Card>

                      <Card title="Log permainan">
                        {logs.length === 0 ? (
                          <p className="text-xs text-violet-300/60">
                            Belum ada aksi.
                          </p>
                        ) : (
                          <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1 text-xs">
                            {logs.map((l) => (
                              <li
                                key={l.key}
                                className={
                                  l.color >= 0
                                    ? COLORS[l.color].text
                                    : "text-violet-100"
                                }
                              >
                                <TxLink tx={l.tx}>{l.text}</TxLink>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Card>

                      <Card
                        title="Chat"
                        right={
                          chatBusy ? (
                            <span className="text-xs text-violet-300/70">
                              ⏳ Mengirim…
                            </span>
                          ) : undefined
                        }
                      >
                        {!CHAT_CONFIGURED ? (
                          <p className="text-xs text-violet-300/60">
                            Chat belum aktif. Isi NEXT_PUBLIC_CHAT_ADDRESS di
                            .env.local.
                          </p>
                        ) : (
                          <>
                            <ul
                              ref={chatBox}
                              className="max-h-56 space-y-1.5 overflow-y-auto pr-1 text-sm"
                            >
                              {chat.length === 0 ? (
                                <li className="text-xs text-violet-300/60">
                                  Belum ada pesan. Sapa lawanmu!
                                </li>
                              ) : (
                                chat.map((m) => (
                                  <li key={m.key} className="break-words">
                                    <TxLink tx={m.tx}>
                                      <span
                                        className={`font-semibold ${m.color >= 0 ? COLORS[m.color].text : "text-violet-300"}`}
                                      >
                                        {m.name}:
                                      </span>{" "}
                                      {m.text}
                                    </TxLink>
                                  </li>
                                ))
                              )}
                            </ul>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {CHAT_QUICK.map((q) => (
                                <button
                                  key={q}
                                  onClick={() => sendChat(q)}
                                  disabled={chatBusy || !account}
                                  className="rounded-lg bg-white/5 px-2.5 py-1 text-sm ring-1 ring-white/10 transition hover:bg-white/10 active:scale-95 disabled:opacity-40"
                                >
                                  {q}
                                </button>
                              ))}
                            </div>
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                sendChat(chatInput);
                              }}
                              className="mt-2 flex gap-2"
                            >
                              <input
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                maxLength={140}
                                placeholder="Tulis pesan…"
                                aria-label="Pesan chat"
                                className="min-w-0 flex-1 rounded-lg bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-violet-400"
                              />
                              <Btn
                                type="submit"
                                disabled={
                                  chatBusy || !chatInput.trim() || !account
                                }
                                className="!px-3"
                              >
                                Kirim
                              </Btn>
                            </form>
                            {chatError && (
                              <p className="mt-1.5 text-xs text-red-300">
                                {chatError}
                              </p>
                            )}
                            <p className="mt-1.5 text-[11px] text-violet-300/50">
                              Pesan tersimpan permanen di blockchain.
                            </p>
                          </>
                        )}
                      </Card>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ================= SIDEBAR ================= */}
          <aside className="space-y-6">
            <Card
              title={`Session wallet${slot !== "main" ? ` · slot ${slot}` : ""}`}
            >
              {account ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <a
                      href={`${EXPLORER}/address/${account.address}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-sm hover:text-violet-300"
                    >
                      {short(account.address)}
                    </a>
                    <button
                      onClick={() => copy(account.address)}
                      className="text-xs text-violet-300 hover:text-white"
                    >
                      Salin alamat
                    </button>
                  </div>
                  <div className="mt-2 text-2xl font-bold tabular-nums">
                    {balance === null ? "…" : fmt(balance)}{" "}
                    <span className="text-sm font-medium text-violet-300">
                      MON
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      value={topUpInput}
                      onChange={(e) => setTopUpInput(e.target.value)}
                      inputMode="decimal"
                      className="w-20 rounded-lg bg-black/30 px-2 py-2 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-violet-400"
                    />
                    <Btn onClick={topUp} disabled={!!busy} className="flex-1">
                      Isi dari MetaMask
                    </Btn>
                  </div>
                  <Btn
                    variant="ghost"
                    onClick={withdraw}
                    disabled={!!busy || !balance}
                    className="mt-2 w-full"
                  >
                    Tarik ke MetaMask
                  </Btn>
                  <p className="mt-2 text-xs text-violet-300/70">
                    Atau kirim MON testnet dari{" "}
                    <a
                      href={FAUCET}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-white"
                    >
                      faucet
                    </a>{" "}
                    ke alamat di atas. Session wallet terikat ke akun MetaMask
                    kamu dan kuncinya disimpan di browser ini (khusus testnet).
                  </p>
                </>
              ) : (
                <p className="text-sm text-violet-300/70">Menyiapkan wallet…</p>
              )}
            </Card>

            <Card title="🏆 Weekly Rank">
              {lb ? (
                <>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-violet-300/80">
                      Minggu #{lb.week.toString()}
                    </span>
                    <span className="text-xs tabular-nums text-violet-300/70">
                      berakhir {countdown(lb.endsAt - now)}
                    </span>
                  </div>
                  <div className="mt-1 text-2xl font-bold tabular-nums">
                    {fmt(lb.pool)}{" "}
                    <span className="text-sm font-medium text-violet-300">
                      MON
                    </span>
                  </div>
                  <p className="text-xs text-violet-300/60">
                    Prize pool mingguan dibagi 50/30/20 ke top 3 di akhir
                    minggu
                  </p>
                  <ol className="mt-3 space-y-1.5">
                    {[0, 1, 2].map((k) => {
                      const a = lb.top[k];
                      const empty = !a || same(a, ZERO);
                      return (
                        <li
                          key={k}
                          className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 text-sm"
                        >
                          <span>
                            {MEDALS[k]}{" "}
                            {empty ? (
                              <span className="text-violet-300/40">
                                belum ada
                              </span>
                            ) : same(a, me) ? (
                              "Kamu"
                            ) : (
                              <span className="font-mono">{short(a)}</span>
                            )}
                          </span>
                          {!empty && (
                            <span className="tabular-nums text-violet-200">
                              {lb.points[k].toString()} poin
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  {lb.week > 0n && !lb.prevFinalized && lb.prevPool > 0n && (
                    <Btn
                      onClick={finalizeWeek}
                      disabled={!!busy}
                      className="mt-3 w-full"
                    >
                      Bagikan hadiah minggu #{(lb.week - 1n).toString()} (
                      {fmt(lb.prevPool)} MON)
                    </Btn>
                  )}
                  <Btn
                    variant="ghost"
                    onClick={sponsor}
                    disabled={!!busy || !account}
                    className="mt-2 w-full"
                  >
                    + Sponsori prize pool 0,1 MON
                  </Btn>
                </>
              ) : (
                <p className="text-sm text-violet-300/70">
                  {CONFIGURED ? "Memuat…" : "Menunggu alamat kontrak."}
                </p>
              )}
            </Card>
          </aside>
        </div>

      {busy && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-violet-600 px-4 py-2 text-sm font-medium shadow-xl shadow-black/50">
          ⏳ {busy}
        </div>
      )}
    </main>
  );
}
