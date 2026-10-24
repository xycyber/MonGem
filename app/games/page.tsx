"use client";

/* ============================================================================
 * Pilih game ("/games").
 * ========================================================================== */

import Link from "next/link";
import type { ReactNode } from "react";
import { RequireLogin } from "@/app/providers";
import { btnClass } from "@/components/ui";

type Game = {
  name: string;
  desc: string;
  players: string;
  art: ReactNode;
  tint: string;
  href?: string;
};

const GAMES: Game[] = [
  {
    name: "Ludo",
    desc: "Balapan pion di papan 28 kotak, dadu dilempar kontrak.",
    players: "2–4 pemain",
    art: <span className="text-6xl drop-shadow-lg">🎲</span>,
    tint: "from-violet-500/50 to-fuchsia-500/30",
    href: "/games/ludo",
  },
  {
    name: "Ular Tangga",
    desc: "Naik tangga, hindari ular, siapa cepat sampai kotak 100.",
    players: "2–4 pemain",
    art: <span className="text-6xl">🐍🪜</span>,
    tint: "from-emerald-500/25 to-teal-500/10",
  },
  {
    name: "Congklak",
    desc: "Strategi biji klasik Nusantara, tiap langkah dicatat on-chain.",
    players: "2 pemain",
    art: (
      <span className="flex gap-1.5">
        {Array.from({ length: 5 }, (_, i) => (
          <span
            key={i}
            className="h-7 w-7 rounded-full bg-amber-900/60 ring-2 ring-amber-500/40"
          />
        ))}
      </span>
    ),
    tint: "from-amber-500/25 to-orange-500/10",
  },
  {
    name: "Gaple / Domino",
    desc: "Sambung kartu domino, skor dan hadiah dihitung kontrak.",
    players: "2–4 pemain",
    art: (
      <span className="flex h-14 w-24 items-center rounded-lg bg-white text-violet-900 shadow-lg">
        <span className="flex-1 text-center text-3xl">⚂</span>
        <span className="h-10 w-px bg-violet-900/30" />
        <span className="flex-1 text-center text-3xl">⚄</span>
      </span>
    ),
    tint: "from-sky-500/25 to-indigo-500/10",
  },
];

export default function GamesPage() {
  return (
    <RequireLogin>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
          Pilih game
        </h1>
        <p className="mt-1 text-sm text-violet-300/70">
          Semua game MonGem berjalan on-chain di Monad. Tiket masuk disimpan kontrak
          sebagai prize pool, dan hadiah langsung cair ke pemenang.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {GAMES.map((g) => (
            <article
              key={g.name}
              className={`flex flex-col overflow-hidden rounded-2xl bg-white/[0.04] ring-1 ${
                g.href ? "ring-violet-400/40" : "ring-white/10"
              }`}
            >
              <div
                className={`flex h-36 items-center justify-center bg-gradient-to-br ${g.tint} ${
                  g.href ? "" : "opacity-60 grayscale-[40%]"
                }`}
              >
                {g.art}
              </div>
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-bold">{g.name}</h2>
                  {g.href ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-emerald-300 ring-1 ring-emerald-500/30">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                      LIVE
                    </span>
                  ) : (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold tracking-wide text-violet-200/60">
                      SEGERA HADIR
                    </span>
                  )}
                </div>
                <p className="mt-1 flex-1 text-sm text-violet-200/70">
                  {g.desc}
                </p>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <span className="text-xs text-violet-300/70">
                    👥 {g.players}
                  </span>
                  {g.href ? (
                    <Link href={g.href} className={btnClass("primary")}>
                      Main
                    </Link>
                  ) : (
                    <button disabled className={btnClass("ghost")}>
                      Segera hadir
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>
    </RequireLogin>
  );
}
