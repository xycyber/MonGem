import { fmt } from "@/lib/arena";
import type { ArenaStats } from "@/lib/use-arena-stats";

/** 6 statistik arena real-time (landing & lobby Ludo). */
export function ArenaStatsGrid({ stats }: { stats: ArenaStats | null }) {
  const mon = (v: bigint | undefined) =>
    stats && v !== undefined ? `${fmt(v)} MON` : "…";
  const num = (v: number | undefined) =>
    stats && v !== undefined ? v.toString() : "…";
  const items: [string, string][] = [
    ["Total volume", mon(stats?.volume)],
    ["Room sedang main", num(stats?.playing)],
    ["Room selesai", num(stats?.finished)],
    ["Total hadiah dibayar", mon(stats?.paid)],
    ["MON terkunci di kontrak", mon(stats?.locked)],
    ["Prize pool mingguan", mon(stats?.weeklyPool)],
  ];
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.map(([label, value]) => (
          <div
            key={label}
            className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10"
          >
            <div className="text-[10px] uppercase tracking-wide text-violet-300/70">
              {label}
            </div>
            <div className="mt-1 text-lg font-black tabular-nums sm:text-xl">
              {value}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-violet-300/50">
        Dihitung langsung dari state kontrak (100 room terakhir), diperbarui
        tiap 6 detik.
      </p>
    </div>
  );
}
