"use client";

/* ============================================================================
 * WalletProvider: login MetaMask + session wallet.
 *
 * - MetaMask dicari lewat EIP-6963 (rdns "io.metamask"), karena wallet bawaan Brave bisa
 *   menimpa window.ethereum. Kalau tidak ada yang mengumumkan diri, pakai window.ethereum
 *   yang isMetaMask.
 * - Session wallet = burner per akun MetaMask + slot tab (?p=1..4), disimpan di localStorage
 *   dengan key `ludo-session-${alamatMetaMask}-${slot}`. Semua transaksi game dikirim dari sini
 *   (tanpa popup). Logout hanya menghapus status login; key sesi tetap disimpan.
 * ========================================================================== */

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  BaseError,
  createWalletClient,
  custom,
  getAddress,
  parseEther,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";
import {
  monadTestnet,
  pc,
  prettyError,
  rpcTransport,
  sleep,
  startPolling,
} from "@/lib/arena";

const LOGIN_KEY = "arena-login";
const SPEED_KEY = "arena-last-tx-ms";
const SLOT_KEY = "arena-slot";
const sessionKey = (mm: string, slot: string) =>
  `ludo-session-${mm.toLowerCase()}-${slot}`;

type Eip6963Detail = {
  info: { rdns: string; name: string; uuid: string };
  provider: EIP1193Provider;
};

const makeSessionWallet = (account: PrivateKeyAccount) =>
  createWalletClient({ account, chain: monadTestnet, transport: rpcTransport });

type WalletCtx = {
  /** Pengecekan auto-reconnect sudah selesai. */
  ready: boolean;
  /** Alamat MetaMask yang login. */
  address: Address | null;
  chainId: number | null;
  slot: string;
  session: PrivateKeyAccount | null;
  sessionWallet: ReturnType<typeof makeSessionWallet> | null;
  balance: bigint | null;
  refreshBalance: () => void;
  /** Waktu tx terakhir dari session wallet (aturan reserve balance Monad). */
  lastTxAt: RefObject<number>;
  /** Catat bahwa session wallet baru saja mengirim transaksi. */
  markTx: () => void;
  /** Antrean transaksi session wallet: dijalankan satu per satu supaya nonce tidak bentrok. */
  runTx: <T>(fn: () => Promise<T>) => Promise<T>;
  lastSpeed: number | null;
  setLastSpeed: (ms: number) => void;
  busy: string | null;
  error: string | null;
  setError: (e: string | null) => void;
  login: () => Promise<boolean>;
  logout: () => void;
  topUp: (amount: string) => Promise<void>;
  withdraw: () => Promise<void>;
};

const Ctx = createContext<WalletCtx | null>(null);

export function useWallet(): WalletCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet harus dipakai di dalam <Providers>");
  return v;
}

/** Pastikan MetaMask berada di Monad Testnet; tambahkan jaringannya kalau belum ada. */
async function ensureMonad(eth: EIP1193Provider) {
  const mm = createWalletClient({ chain: monadTestnet, transport: custom(eth) });
  if ((await mm.getChainId()) === monadTestnet.id) return;
  try {
    await mm.switchChain({ id: monadTestnet.id });
  } catch (e) {
    const rejected =
      e instanceof BaseError &&
      e.walk((x) => (x as { code?: number }).code === 4001);
    if (rejected) throw e;
    // 4902: jaringan belum terdaftar di MetaMask → wallet_addEthereumChain (sekaligus pindah).
    await mm.addChain({ chain: monadTestnet });
  }
}

export function Providers({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [slot, setSlot] = useState("main");
  const [pk, setPk] = useState<Hex | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [lastSpeed, setLastSpeedState] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mmProvider = useRef<EIP1193Provider | null>(null);
  const lastTxAt = useRef(0);

  const session = useMemo(() => (pk ? privateKeyToAccount(pk) : null), [pk]);
  const sessionWallet = useMemo(
    () => (session ? makeSessionWallet(session) : null),
    [session],
  );

  const getProvider = useCallback((): EIP1193Provider | null => {
    if (mmProvider.current) return mmProvider.current;
    const eth = window.ethereum as
      | (EIP1193Provider & { isMetaMask?: boolean })
      | undefined;
    return eth?.isMetaMask ? eth : null;
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(LOGIN_KEY);
    } catch {
      /* abaikan */
    }
    setAddress(null);
  }, []);

  // ---- slot tab, EIP-6963, auto-reconnect (eth_accounts, tanpa popup), event MetaMask
  useEffect(() => {
    // Slot ?p= disimpan di sessionStorage (per tab) supaya tetap ada setelah pindah halaman.
    let s = new URLSearchParams(window.location.search).get("p");
    try {
      if (s) sessionStorage.setItem(SLOT_KEY, s);
      else s = sessionStorage.getItem(SLOT_KEY);
    } catch {
      /* storage diblokir */
    }
    setSlot(s || "main");
    try {
      const ms = Number(localStorage.getItem(SPEED_KEY));
      if (ms > 0) setLastSpeedState(ms);
    } catch {
      /* abaikan */
    }

    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent<Eip6963Detail>).detail;
      if (d?.info?.rdns === "io.metamask") mmProvider.current = d.provider;
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    const onAccounts = (accs: string[]) => {
      if (!accs.length) logout();
      else if (localStorage.getItem(LOGIN_KEY) === "1")
        setAddress(getAddress(accs[0]));
    };
    const onChain = (id: string) => setChainId(Number(id));

    let alive = true;
    let eth: EIP1193Provider | null = null;
    // Beri waktu ekstensi mengumumkan diri, lalu coba sambung ulang.
    const t = setTimeout(async () => {
      eth = getProvider();
      try {
        if (eth) {
          eth.on("accountsChanged", onAccounts);
          eth.on("chainChanged", onChain);
          if (localStorage.getItem(LOGIN_KEY) === "1") {
            const [accs, id] = await Promise.all([
              eth.request({ method: "eth_accounts" }),
              eth.request({ method: "eth_chainId" }),
            ]);
            if (!alive) return;
            setChainId(Number(id));
            if (accs[0]) setAddress(getAddress(accs[0]));
            else localStorage.removeItem(LOGIN_KEY);
          }
        }
      } catch {
        /* MetaMask terkunci / storage diblokir: tetap logout */
      }
      if (alive) setReady(true);
    }, 200);

    return () => {
      alive = false;
      clearTimeout(t);
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      eth?.removeListener("accountsChanged", onAccounts);
      eth?.removeListener("chainChanged", onChain);
    };
  }, [getProvider, logout]);

  // ---- session wallet milik akun MetaMask + slot ini
  useEffect(() => {
    if (!address) {
      setPk(null);
      setBalance(null);
      return;
    }
    const k = sessionKey(address, slot);
    let key: string | null = null;
    try {
      key = localStorage.getItem(k);
      // Burner lama (sebelum ada login) diambil alih supaya saldonya tidak hilang.
      const legacy = `ludo-burner-${slot}`;
      if (!key && localStorage.getItem(legacy)) {
        key = localStorage.getItem(legacy);
        localStorage.removeItem(legacy);
      }
    } catch {
      /* storage diblokir */
    }
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) key = generatePrivateKey();
    try {
      localStorage.setItem(k, key);
    } catch {
      /* storage diblokir */
    }
    setBalance(null);
    setPk(key as Hex);
  }, [address, slot]);

  // ---- saldo session wallet
  useEffect(() => {
    if (!session) return;
    let alive = true;
    const tick = async () => {
      try {
        const b = await pc.getBalance({ address: session.address });
        if (alive) setBalance(b);
      } catch {
        /* rpc sibuk */
      }
    };
    const stop = startPolling(tick, 6000);
    return () => {
      alive = false;
      stop();
    };
  }, [session]);

  const markTx = useCallback(() => {
    lastTxAt.current = Date.now();
  }, []);

  const txQueue = useRef<Promise<unknown>>(Promise.resolve());
  const runTx = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = txQueue.current.then(fn, fn);
    txQueue.current = run.catch(() => undefined);
    return run;
  }, []);

  const refreshBalance = useCallback(() => {
    if (!session) return;
    pc.getBalance({ address: session.address })
      .then(setBalance)
      .catch(() => undefined);
  }, [session]);

  const setLastSpeed = useCallback((ms: number) => {
    setLastSpeedState(ms);
    try {
      localStorage.setItem(SPEED_KEY, String(ms));
    } catch {
      /* abaikan */
    }
  }, []);

  // ---- aksi
  const login = useCallback(async () => {
    setError(null);
    const eth = getProvider();
    if (!eth) {
      setError("MetaMask tidak ditemukan. Pasang ekstensi MetaMask lalu refresh.");
      return false;
    }
    setBusy("Menghubungkan MetaMask…");
    try {
      const accs = await eth.request({ method: "eth_requestAccounts" });
      if (!accs[0]) throw new Error("Tidak ada akun MetaMask yang dipilih.");
      await ensureMonad(eth);
      setChainId(monadTestnet.id);
      try {
        localStorage.setItem(LOGIN_KEY, "1");
      } catch {
        /* abaikan */
      }
      setAddress(getAddress(accs[0]));
      return true;
    } catch (e) {
      setError(prettyError(e));
      return false;
    } finally {
      setBusy(null);
    }
  }, [getProvider]);

  const topUp = useCallback(
    async (amount: string) => {
      if (!session || !address) return;
      const eth = getProvider();
      if (!eth) {
        setError("MetaMask tidak ditemukan. Kirim MON testnet manual ke session wallet.");
        return;
      }
      let value: bigint;
      try {
        value = parseEther(amount);
      } catch {
        setError("Nominal isi saldo tidak valid");
        return;
      }
      if (value <= 0n) return setError("Nominal isi saldo harus lebih dari 0");
      setBusy("Menunggu konfirmasi MetaMask…");
      setError(null);
      try {
        await ensureMonad(eth);
        const mm = createWalletClient({
          chain: monadTestnet,
          transport: custom(eth),
        });
        const hash = await mm.sendTransaction({
          account: address,
          chain: monadTestnet,
          to: session.address,
          value,
        });
        setBusy("Mengisi saldo sesi…");
        await pc.waitForTransactionReceipt({ hash, pollingInterval: 250 });
        setBalance(await pc.getBalance({ address: session.address }));
      } catch (e) {
        setError(prettyError(e));
      } finally {
        setBusy(null);
      }
    },
    [session, address, getProvider],
  );

  const withdraw = useCallback(async () => {
    if (!session || !sessionWallet || !address) return;
    setBusy("Menarik saldo ke MetaMask…");
    setError(null);
    try {
      await runTx(async () => {
        // Aturan reserve balance Monad: transaksi yang membawa MON dari akun bersaldo < 10 MON
        // sebaiknya diberi jeda ±3 blok dari transaksi sebelumnya.
        const wait = 2000 - (Date.now() - lastTxAt.current);
        if (wait > 0) await sleep(wait);
        const [bal, fees] = await Promise.all([
          pc.getBalance({ address: session.address }),
          pc.estimateFeesPerGas(),
        ]);
        // Monad menagih gas_limit × harga gas: sisihkan 21000 × maxFeePerGas (+10% buffer).
        const maxFeePerGas = (fees.maxFeePerGas * 11n) / 10n;
        const value = bal - 21_000n * maxFeePerGas;
        if (value <= 0n) throw new Error("Saldo sesi terlalu kecil untuk ditarik.");
        const hash = await sessionWallet.sendTransaction({
          to: address,
          value,
          gas: 21_000n,
          maxFeePerGas,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        });
        lastTxAt.current = Date.now();
        await pc.waitForTransactionReceipt({ hash, pollingInterval: 250 });
      });
      setBalance(await pc.getBalance({ address: session.address }));
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setBusy(null);
    }
  }, [session, sessionWallet, address, runTx]);

  const value = useMemo<WalletCtx>(
    () => ({
      ready,
      address,
      chainId,
      slot,
      session,
      sessionWallet,
      balance,
      refreshBalance,
      lastTxAt,
      markTx,
      runTx,
      lastSpeed,
      setLastSpeed,
      busy,
      error,
      setError,
      login,
      logout,
      topUp,
      withdraw,
    }),
    [
      ready,
      address,
      chainId,
      slot,
      session,
      sessionWallet,
      balance,
      refreshBalance,
      markTx,
      runTx,
      lastSpeed,
      setLastSpeed,
      busy,
      error,
      login,
      logout,
      topUp,
      withdraw,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Halaman yang butuh login: tunggu auto-reconnect, lalu redirect ke "/" kalau belum login. */
export function RequireLogin({ children }: { children: ReactNode }) {
  const { ready, address } = useWallet();
  const router = useRouter();
  useEffect(() => {
    if (ready && !address) router.replace("/");
  }, [ready, address, router]);
  if (!address)
    return (
      <div className="flex flex-1 items-center justify-center py-24 text-sm text-violet-300/70">
        Memeriksa login…
      </div>
    );
  return <>{children}</>;
}
