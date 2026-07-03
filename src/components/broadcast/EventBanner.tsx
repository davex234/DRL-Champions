"use client";

/**
 * Banner central de momentos clave (FIRST BLOOD, CLUTCH, SPIKE, ACE…) y cierre de
 * ronda. Detecta el FLANCO DE SUBIDA de las banderas del BroadcastState y dispara un
 * cartel cinemático + un cue de audio sintetizado. TONTO respecto al juego.
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { BroadcastState } from "@/broadcast";
import { ATK, DEF, ACCENT } from "./theme";
import { playCue, type BroadcastCue } from "@/lib/sound";

interface Banner { id: string; text: string; sub?: string; hex: string; cue: BroadcastCue }

export function EventBanner({ bs }: { bs: BroadcastState }) {
  const [banner, setBanner] = useState<Banner | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const prev = useRef({ plant: false, defuse: false, ace: false, clutch: false, firstBlood: false, ended: false });

  useEffect(() => {
    const f = bs.events.flags;
    const ended = bs.match.phase === "ENDED";
    const p = prev.current;
    const fire = (b: Banner, ms = 2600) => {
      setBanner(b);
      playCue(b.cue);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setBanner(null), ms);
    };

    if (ended && !p.ended) {
      const won = bs.match.score.atk > bs.match.score.def ? "ATK" : "DEF";
      const coachWon = won === bs.match.coachSide;
      fire({ id: "end", text: "ROUND", sub: bs.mvp ? `MVP · ${bs.mvp.name} (${bs.mvp.kills})` : undefined,
        hex: won === "ATK" ? ATK : DEF, cue: coachWon ? "round_win" : "round_lose" }, 2600);
    } else if (f.ace && !p.ace) fire({ id: "ace", text: "ACE", sub: bs.events.flags.aceBy ?? undefined, hex: ACCENT.gold, cue: "ace" }, 3000);
    else if (f.clutch && !p.clutch) fire({ id: "clutch", text: `CLUTCH ${f.clutchSide ?? ""}`.trim(), hex: ACCENT.clutch, cue: "clutch" });
    else if (f.plant && !p.plant) fire({ id: "plant", text: "SPIKE PLANTED", hex: ACCENT.plant, cue: "plant" });
    else if (f.defuse && !p.defuse) fire({ id: "defuse", text: "DEFUSING", hex: DEF, cue: "defuse" });
    else if (f.firstBlood && !p.firstBlood) fire({ id: "fb", text: "FIRST BLOOD", hex: ACCENT.white, cue: "first_blood" }, 2000);

    prev.current = { plant: f.plant, defuse: f.defuse, ace: f.ace, clutch: f.clutch, firstBlood: f.firstBlood, ended };
  }, [bs]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[32%] flex justify-center">
      <AnimatePresence>
        {banner && (
          <motion.div key={banner.id + banner.text}
            initial={{ scale: 0.7, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 1.12, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 16 }}
            className="flex flex-col items-center">
            {/* destello de fondo */}
            <motion.div initial={{ scaleX: 0, opacity: 0.8 }} animate={{ scaleX: 1, opacity: 0 }} transition={{ duration: 0.6 }}
              className="absolute h-16 w-[120%] -skew-x-12 blur-xl" style={{ background: banner.hex }} />
            <div className="relative overflow-hidden rounded-lg border bg-black/70 px-8 py-2.5 backdrop-blur-md"
              style={{ borderColor: `${banner.hex}88`, boxShadow: `0 0 44px ${banner.hex}55` }}>
              <motion.div initial={{ x: "-120%" }} animate={{ x: "220%" }} transition={{ duration: 0.9, ease: "easeOut" }}
                className="absolute inset-y-0 w-1/3 -skew-x-12 bg-white/15" />
              <div className="relative font-display text-[clamp(1.6rem,4vw,3rem)] font-black uppercase italic tracking-[0.08em]"
                style={{ color: banner.hex, textShadow: `0 0 24px ${banner.hex}88` }}>
                {banner.text}
              </div>
            </div>
            {banner.sub && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
                className="mt-2 rounded bg-black/65 px-4 py-0.5 font-display text-xs uppercase tracking-[0.2em] text-white/85 backdrop-blur-sm">
                {banner.sub}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
