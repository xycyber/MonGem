"use client";

/* ============================================================================
 * Statistik arena real-time, dihitung dari state kontrak: getRoom untuk maksimal
 * 100 room terakhir dalam SATU eth_call (Multicall3), diperbarui tiap 6 detik.
 * Room yang sudah Finished/Cancelled tidak berubah lagi, jadi di-cache dan tidak dibaca ulang.
 * ========================================================================== */

import { useEffect, useRef, useState } from "react";
import {
  ABI,
  CONFIGURED,
  CONTRACT_ADDRESS,
  pc,
  read,
  startPolling,
  warnPoll,
  type Room,
} from "@/lib/arena";

const MAX_ROOMS = 100;

export type ArenaStats = {
  /** Jumlah tiket masuk dari room yang sudah mulai atau selesai. */
  volume: bigint;
  playing: number;
  finished: number;
  /** 90% dari volume room yang selesai. */
  paid: bigint;
  locked: bigint;
  weeklyPool: bigint;
  /** Room terbaru dulu. */
  rooms: { id: bigint; room: Room }[];
};

export function useArenaStats(): ArenaStats | null {
  const [stats, setStats] = useState<ArenaStats | null>(null);
  const settled = useRef(new Map<bigint, Room>());

  useEffect(() => {
    if (!CONFIGURED) return;
    let alive = true;
    const tick = async () => {
      try {
        const [count, week] = await Promise.all([
          read<bigint>("roomCount"),
          read<bigint>("currentWeek"),
        ]);
        const ids: bigint[] = [];
        for (let id = count; id > 0n && ids.length < MAX_ROOMS; id--)
          ids.push(id);
        const todo = ids.filter((id) => !settled.current.has(id));
        const [fresh, locked, weeklyPool] = await Promise.all([
          todo.length
            ? (pc.multicall({
                contracts: todo.map((id) => ({
                  address: CONTRACT_ADDRESS,
                  abi: ABI,
                  functionName: "getRoom",
                  args: [id],
                })),
                allowFailure: false,
                batchSize: 0, // semua getRoom dalam satu eth_call
              }) as Promise<unknown[]>)
            : Promise.resolve([] as unknown[]),
          pc.getBalance({ address: CONTRACT_ADDRESS }),
          read<bigint>("weeklyPool", [week]),
        ]);
        if (!alive) return;

        const byId = new Map<bigint, Room>();
        todo.forEach((id, k) => {
          const r = fresh[k] as Room;
          byId.set(id, r);
          if (r.state >= 2) settled.current.set(id, r);
        });
        const rooms = ids.map((id) => ({
          id,
          room: settled.current.get(id) ?? (byId.get(id) as Room),
        }));

        let volume = 0n;
        let finishedVolume = 0n;
        let playing = 0;
        let finished = 0;
        for (const { room } of rooms) {
          const tickets = room.stake * BigInt(room.playerCount);
          if (room.state === 1 || room.state === 2) volume += tickets;
          if (room.state === 1) playing++;
          if (room.state === 2) {
            finished++;
            finishedVolume += tickets;
          }
        }
        setStats({
          volume,
          playing,
          finished,
          paid: (finishedVolume * 9n) / 10n,
          locked,
          weeklyPool,
          rooms,
        });
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

  return stats;
}
