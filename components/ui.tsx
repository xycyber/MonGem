import type { ReactNode } from "react";

export function Card({
  title,
  right,
  children,
  className = "",
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10 ${className}`}
    >
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-bold">{title}</h3>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Btn({
  children,
  onClick,
  disabled,
  variant = "primary",
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: keyof typeof BTN_STYLES;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${btnClass(variant)} ${className}`}
    >
      {children}
    </button>
  );
}

const BTN_STYLES = {
  primary:
    "rounded-xl px-4 py-2 text-sm bg-violet-500 text-white hover:bg-violet-400 shadow-lg shadow-violet-950/50",
  accent:
    "rounded-xl px-4 py-2 text-sm bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:brightness-110 shadow-lg shadow-fuchsia-950/50",
  big: "rounded-2xl px-6 py-3 text-base bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:brightness-110 shadow-xl shadow-fuchsia-950/50",
  ghost:
    "rounded-xl px-4 py-2 text-sm bg-white/5 text-violet-100 ring-1 ring-white/10 hover:bg-white/10",
  danger:
    "rounded-xl px-4 py-2 text-sm bg-red-500/15 text-red-200 ring-1 ring-red-500/30 hover:bg-red-500/25",
};

/** Kelas tombol, juga dipakai untuk <Link> yang tampil seperti tombol. */
export function btnClass(variant: keyof typeof BTN_STYLES = "primary") {
  return `inline-flex items-center justify-center gap-2 font-semibold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${BTN_STYLES[variant]}`;
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/10">
      <div className="text-[10px] uppercase tracking-wide text-violet-300/70">
        {label}
      </div>
      <div className="font-bold tabular-nums">{value}</div>
    </div>
  );
}
