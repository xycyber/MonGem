"use client";

/* ============================================================================
 * Landing + login MetaMask ("/"). Setelah login → /games.
 * ========================================================================== */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "@/app/providers";
import { Logo } from "@/components/site-header";
import { ArenaStatsGrid } from "@/components/arena-stats";
import { Btn, btnClass } from "@/components/ui";
import { useArenaStats } from "@/lib/use-arena-stats";
import { CONTRACT_ADDRESS, EXPLORER } from "@/lib/arena";

const FEATURES = [
  {
    icon: "🔒",
    title: "Prize pool dijaga kontrak",
    text: "Tiket masuk semua pemain disimpan smart contract, bukan server.",
  },
  {
    icon: "🎲",
    title: "Dadu & pemenang on-chain",
    text: "Kontrak yang melempar dadu dan mencatat urutan finish.",
  },
  {
    icon: "⚡",
    title: "Hadiah langsung cair",
    text: "Juara dibayar di transaksi yang sama dengan lemparan terakhir.",
  },
];

export default function Landing() {
  const w = useWallet();
  const router = useRouter();
  const stats = useArenaStats();

  const onLogin = async () => {
    if (await w.login()) router.push("/games");
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-10 pt-4 sm:pb-16">
      {!w.address && (
        <nav className="flex items-center justify-between gap-3 py-1">
          <Logo />
          <Btn
            variant="accent"
            onClick={onLogin}
            disabled={!!w.busy}
            className="shrink-0"
          >
            <span
              title="Setelah login, transaksi game ditandatangani session wallet di browser ini, jadi tidak ada popup setiap lempar dadu."
              className="flex items-center gap-2"
            >
              🦊
              {w.busy ? (
                "Menghubungkan…"
              ) : (
                <>
                  <span className="sm:hidden">Login</span>
                  <span className="hidden sm:inline">Login dengan MetaMask</span>
                </>
              )}
            </span>
          </Btn>
        </nav>
      )}

      <section className="mt-10 max-w-3xl sm:mt-16">
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Live di Monad Testnet
        </span>
        <h1 className="mt-5 text-4xl font-black leading-tight tracking-tight sm:text-6xl">
          Game klasik, turnamen on-chain,{" "}
          <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
            hadiah langsung cair
          </span>{" "}
          di Monad.
        </h1>
        <p className="mt-5 max-w-2xl text-base text-violet-200/80 sm:text-lg">
          MonGem adalah platform mini game on-chain di Monad. Game pertamanya
          Ludo: main bareng teman dalam turnamen on-chain. Setiap pemain membeli
          tiket masuk dengan MON; kontrak yang menyimpan prize pool, melempar
          dadu, dan membagikan hadiah ke juara, tanpa server yang bisa curang.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          {w.address && (
            <Link href="/games" className={btnClass("big")}>
              Masuk ke MonGem →
            </Link>
          )}
          <a
            href={`${EXPLORER}/address/${CONTRACT_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-violet-300 underline-offset-4 hover:text-white hover:underline"
          >
            Lihat kontrak di explorer ↗
          </a>
        </div>
        {!w.address && w.error && (
          <div className="mt-4 max-w-xl rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-100 ring-1 ring-red-500/30">
            {w.error}
          </div>
        )}
      </section>

      <section className="mt-12">
        <ArenaStatsGrid stats={stats} />
        <p className="mt-1 text-xs text-violet-300/70">
          ⚡ Konfirmasi tx terakhir:{" "}
          <span className="font-semibold tabular-nums text-violet-100">
            {w.lastSpeed !== null ? `${w.lastSpeed} ms` : "–"}
          </span>
          {w.lastSpeed === null && " (muncul setelah transaksi pertamamu)"}
        </p>
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="rounded-2xl bg-white/[0.03] p-5 ring-1 ring-white/10"
          >
            <div className="text-2xl">{f.icon}</div>
            <h2 className="mt-3 font-bold">{f.title}</h2>
            <p className="mt-1 text-sm text-violet-200/70">{f.text}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
