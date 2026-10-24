"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useWallet } from "@/app/providers";
import { Btn } from "@/components/ui";
import { EXPLORER, FAUCET, fmt, short } from "@/lib/arena";

export function Logo() {
  return (
    <span className="text-xl font-black tracking-tight">
      💎 Mon
      <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
        Gem
      </span>
    </span>
  );
}

/** Header global, tampil setelah login: alamat MetaMask, saldo sesi, isi/tarik, logout. */
export function SiteHeader() {
  const w = useWallet();
  const router = useRouter();
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [amount, setAmount] = useState("0.5");

  if (!w.address) return null;

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0d0a1c]/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/games" aria-label="Pilih game">
          <Logo />
        </Link>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <a
            href={`${EXPLORER}/address/${w.address}`}
            target="_blank"
            rel="noreferrer"
            title="Akun MetaMask"
            className="rounded-full bg-white/5 px-3 py-1.5 font-mono text-xs ring-1 ring-white/10 hover:bg-white/10"
          >
            🦊 {short(w.address)}
          </a>
          <span
            title={w.session ? `Session wallet ${w.session.address}` : undefined}
            className="rounded-full bg-violet-500/15 px-3 py-1.5 text-xs font-semibold tabular-nums ring-1 ring-violet-400/30"
          >
            Sesi{w.slot !== "main" ? ` ${w.slot}` : ""}:{" "}
            {w.balance === null ? "…" : fmt(w.balance)} MON
          </span>
          <Btn
            onClick={() => setTopUpOpen((v) => !v)}
            disabled={!!w.busy}
            className="!px-3 !py-1.5"
          >
            Isi saldo
          </Btn>
          <Btn
            variant="ghost"
            onClick={w.withdraw}
            disabled={!!w.busy || !w.balance}
            className="!px-3 !py-1.5"
          >
            Tarik
          </Btn>
          <Btn
            variant="ghost"
            onClick={() => {
              w.logout();
              router.push("/");
            }}
            className="!px-3 !py-1.5"
          >
            Logout
          </Btn>
        </div>
      </div>

      {topUpOpen && (
        <div className="mx-auto max-w-6xl px-4 pb-3">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await w.topUp(amount);
              setTopUpOpen(false);
            }}
            className="flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10"
          >
            <span className="text-sm text-violet-200">
              Kirim dari MetaMask ke session wallet
            </span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              aria-label="Jumlah MON"
              className="w-24 rounded-lg bg-black/30 px-3 py-1.5 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-violet-400"
            />
            <span className="text-sm text-violet-300">MON</span>
            <Btn type="submit" disabled={!!w.busy} className="!px-3 !py-1.5">
              Kirim
            </Btn>
            <Btn
              variant="ghost"
              onClick={() => setTopUpOpen(false)}
              className="!px-3 !py-1.5"
            >
              Batal
            </Btn>
            <span className="basis-full text-xs text-violet-300/70">
              Atau kirim MON testnet dari{" "}
              <a
                href={FAUCET}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-white"
              >
                faucet
              </a>{" "}
              ke{" "}
              <span className="font-mono">
                {w.session ? w.session.address : "…"}
              </span>
            </span>
          </form>
        </div>
      )}

      {(w.busy || w.error) && (
        <div className="mx-auto max-w-6xl px-4 pb-3">
          {w.busy ? (
            <div className="rounded-xl bg-violet-500/15 px-4 py-2 text-sm ring-1 ring-violet-400/30">
              ⏳ {w.busy}
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3 rounded-xl bg-red-500/15 px-4 py-2 text-sm text-red-100 ring-1 ring-red-500/30">
              <span>{w.error}</span>
              <button
                onClick={() => w.setError(null)}
                className="text-red-200 hover:text-white"
                aria-label="Tutup"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
