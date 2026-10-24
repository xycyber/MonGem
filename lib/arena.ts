/* ============================================================================
 * Konfigurasi & helper bersama Arena: chain Monad Testnet, RPC, ABI LudoArena.
 * ========================================================================== */

import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  defineChain,
  fallback,
  formatEther,
  http,
  type Abi,
  type Address,
  type EIP1193Provider,
} from "viem";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

// ============================================================================ KONFIGURASI
// ↓↓↓ TEMPEL ALAMAT KONTRAK LudoArena DI SINI (atau isi NEXT_PUBLIC_LUDO_ADDRESS di .env.local)
export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_LUDO_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as Address;

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: {
    default: { name: "MonadVision", url: "https://testnet.monadvision.com" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});
export const EXPLORER = "https://testnet.monadvision.com";
export const FAUCET = "https://faucet.monad.xyz";

export const ZERO = "0x0000000000000000000000000000000000000000";
export const CONFIGURED = CONTRACT_ADDRESS.toLowerCase() !== ZERO;

// ArenaChat: chat on-chain per room. Event Message dibaca lewat getLogs yang sama dengan event game.
export const CHAT_ADDRESS = (process.env.NEXT_PUBLIC_CHAT_ADDRESS ||
  ZERO) as Address;
export const CHAT_CONFIGURED = CHAT_ADDRESS.toLowerCase() !== ZERO;
export const CHAT_ABI = [
  {
    type: "function",
    name: "say",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roomId", type: "uint256" },
      { name: "text", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "Message",
    anonymous: false,
    inputs: [
      { name: "roomId", type: "uint256", indexed: true },
      { name: "from", type: "address", indexed: true },
      { name: "text", type: "string", indexed: false },
    ],
  },
] as const;

// ABI hasil kompilasi LudoArena.sol (solc 0.8.26)
export const ABI = [
  {
    type: "constructor",
    inputs: [{ name: "_weekLength", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "MAX_PLAYERS",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "TRACK_LENGTH",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "TURN_TIMEOUT",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "claimable",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "createRoom",
    inputs: [{ name: "maxPlayers", type: "uint8" }],
    outputs: [{ name: "roomId", type: "uint256" }],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "currentWeek",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "finalizeWeek",
    inputs: [{ name: "week", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "fundWeeklyPool",
    inputs: [],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "getOpenRooms",
    inputs: [{ name: "maxResults", type: "uint256" }],
    outputs: [{ name: "ids", type: "uint256[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRoom",
    inputs: [{ name: "roomId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "stake", type: "uint256" },
          { name: "lastAction", type: "uint64" },
          { name: "maxPlayers", type: "uint8" },
          { name: "playerCount", type: "uint8" },
          { name: "turn", type: "uint8" },
          { name: "finishedCount", type: "uint8" },
          { name: "state", type: "uint8" },
          { name: "players", type: "address[4]" },
          { name: "positions", type: "uint8[4]" },
          { name: "done", type: "bool[4]" },
          { name: "ranking", type: "address[4]" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getWeeklyTop",
    inputs: [{ name: "week", type: "uint256" }],
    outputs: [
      { name: "top", type: "address[3]" },
      { name: "points", type: "uint256[3]" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "joinRoom",
    inputs: [{ name: "roomId", type: "uint256" }],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "leaveRoom",
    inputs: [{ name: "roomId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "roll",
    inputs: [{ name: "roomId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "roomCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "seasonStart",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "weekFinalized",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "weekLength",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "weeklyPoints",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "weeklyPool",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "DiceRolled",
    inputs: [
      { name: "roomId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "dice", type: "uint8", indexed: false },
      { name: "newPosition", type: "uint8", indexed: false },
      { name: "captured", type: "address", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GameEnded",
    inputs: [
      { name: "roomId", type: "uint256", indexed: true },
      { name: "winners", type: "address[3]", indexed: false },
      { name: "prizes", type: "uint256[3]", indexed: false },
      { name: "toWeeklyPool", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GameStarted",
    inputs: [{ name: "roomId", type: "uint256", indexed: true }],
    anonymous: false,
  },
  {
    type: "event",
    name: "PlayerFinished",
    inputs: [
      { name: "roomId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "place", type: "uint8", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PlayerJoined",
    inputs: [
      { name: "roomId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PlayerLeft",
    inputs: [
      { name: "roomId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoomCreated",
    inputs: [
      { name: "roomId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "stake", type: "uint256", indexed: false },
      { name: "maxPlayers", type: "uint8", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "WeekFinalized",
    inputs: [
      { name: "week", type: "uint256", indexed: true },
      { name: "winners", type: "address[3]", indexed: false },
      { name: "prizes", type: "uint256[3]", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "WeeklyPoolFunded",
    inputs: [
      { name: "week", type: "uint256", indexed: true },
      { name: "from", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
] as unknown as Abi;

// RPC publik Monad membatasi request per IP ("requests limited to 15/sec"), padahal demo
// menjalankan 4 tab sekaligus. Kalau satu RPC kena rate limit atau error, viem langsung pindah
// ke RPC berikutnya (retry per RPC dimatikan supaya RPC yang sedang membatasi tidak dibanjiri).
export const rpcTransport = fallback([
  http("https://testnet-rpc.monad.xyz", { retryCount: 0 }),
  http("https://rpc-testnet.monadinfra.com", { retryCount: 0 }),
  http("https://rpc.ankr.com/monad_testnet", { retryCount: 0 }),
]);

export const pc = createPublicClient({
  chain: monadTestnet,
  transport: rpcTransport,
  // readContract yang dipanggil bersamaan digabung jadi satu eth_call lewat Multicall3.
  batch: { multicall: { wait: 50 } },
  pollingInterval: 400,
});

// ============================================================================ TIPE
export type Room = {
  stake: bigint;
  lastAction: bigint;
  maxPlayers: number;
  playerCount: number;
  turn: number;
  finishedCount: number;
  state: number; // 0 Waiting, 1 Playing, 2 Finished, 3 Cancelled
  players: readonly Address[];
  positions: readonly number[];
  done: readonly boolean[];
  ranking: readonly Address[];
};

// ============================================================================ HELPER
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const same = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const fmt = (v: bigint, digits = 4) =>
  Number(formatEther(v)).toLocaleString("id-ID", {
    maximumFractionDigits: digits,
  });

export function prettyError(e: unknown): string {
  if (e instanceof BaseError) {
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError && reverted.reason) {
      return `Ditolak kontrak: ${reverted.reason}`;
    }
    const msg = e.shortMessage || e.message;
    if (
      /insufficient funds|exceeds the balance|gas required exceeds/i.test(msg)
    ) {
      return "Saldo session wallet tidak cukup untuk tiket masuk + gas. Isi saldo dulu.";
    }
    if (/user rejected|denied/i.test(msg)) return "Dibatalkan di wallet.";
    return msg.split("\n")[0];
  }
  return e instanceof Error ? e.message : String(e);
}

export async function read<T>(
  functionName: string,
  args: readonly unknown[] = [],
): Promise<T> {
  return (await pc.readContract({
    address: CONTRACT_ADDRESS,
    abi: ABI,
    functionName,
    args,
  })) as T;
}

export const RATE_LIMITED = /429|too many requests|rate.?limit|limited to/i;

/** Error polling karena rate limit diabaikan; tick berikutnya akan mencoba lagi. */
export function warnPoll(e: unknown) {
  if (!RATE_LIMITED.test(e instanceof Error ? e.message : String(e)))
    console.warn(e);
}

/**
 * Jalankan `tick` sekarang lalu setiap `ms`. Tick dilewati saat tab tidak aktif atau saat tick
 * sebelumnya belum selesai, dan langsung dijalankan lagi begitu tab aktif kembali.
 */
export function startPolling(tick: () => Promise<void>, ms: number): () => void {
  let inFlight = false;
  const run = async () => {
    if (inFlight || document.hidden) return;
    inFlight = true;
    try {
      await tick();
    } finally {
      inFlight = false;
    }
  };
  const onVisible = () => {
    if (!document.hidden) run();
  };
  run();
  const t = setInterval(run, ms);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(t);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
