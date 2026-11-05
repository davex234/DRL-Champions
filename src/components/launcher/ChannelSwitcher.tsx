"use client";

/** LAUNCHER — selector de rama (Stable/Beta/Developer/Nightly) estilo "cambiar rama". */
import { useState } from "react";
import { CHANNELS, type Channel } from "@/platform";

const RISK_COLOR = ["#37e6a0", "#7cc0ff", "#ffd35c", "#ff7a7a"];

export function ChannelSwitcher({
  channel,
  onChange,
  disabled,
}: {
  channel: Channel;
  onChange: (c: Channel) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const cur = CHANNELS.find((c) => c.id === channel) ?? CHANNELS[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-base-800/60 px-3 py-2 text-left text-[12px] transition hover:border-white/25 disabled:opacity-50"
      >
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: RISK_COLOR[cur.risk] }} />
          <span className="font-semibold">{cur.label}</span>
        </span>
        <span className="text-white/35">▾</span>
      </button>
      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-64 overflow-hidden rounded-xl border border-white/10 bg-base-900/95 shadow-glow backdrop-blur">
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setOpen(false);
                if (c.id !== channel) onChange(c.id);
              }}
              className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left transition hover:bg-white/5 ${
                c.id === channel ? "bg-white/5" : ""
              }`}
            >
              <span className="flex items-center gap-2 text-[12px] font-semibold">
                <span className="h-2 w-2 rounded-full" style={{ background: RISK_COLOR[c.risk] }} />
                {c.label}
                {c.id === channel && <span className="text-[9px] text-drl-gold">● actual</span>}
              </span>
              <span className="pl-4 text-[10px] text-white/45">{c.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
