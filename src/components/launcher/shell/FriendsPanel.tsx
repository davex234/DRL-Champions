"use client";

/**
 * LAUNCHER — PANEL DE AMIGOS.
 *
 * Columna derecha: quién está y en qué. Los conectados van arriba y los desconectados se
 * agrupan al final, atenuados — la lista de amigos de un launcher no es un directorio, es una
 * respuesta a «¿con quién puedo jugar ahora?».
 *
 * La animación de presencia se limita al punto de estado: un latido por persona conectada y
 * nada más. Diez avatares rebotando serían ruido, no vida.
 */
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  PRESENCE_TONE, PRESENCE_LABEL, countConnected, getFriends, getGame, isConnected, sortFriends,
} from "@/launcher";
import { cn } from "@/lib/format";
import { StatusDot } from "@/components/ui/Badge";
import { TONE } from "@/components/ui/tone";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Avatar } from "./primitives";
import { ns, td, tdIn } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("launcher");

export function FriendsPanel({ motionScale, onOpenGame }: { motionScale: number; onOpenGame: (gameId: string) => void }) {
  useLocale();
  const [query, setQuery] = useState("");
  const friends = useMemo(() => sortFriends(getFriends()), []);
  const connected = countConnected(friends);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? friends.filter((f) => f.name.toLowerCase().includes(q)) : friends;
  }, [friends, query]);

  return (
    <aside className="flex h-full min-h-0 w-[280px] shrink-0 flex-col border-l border-white/[0.06] bg-black/25 px-3 py-4">
      <SectionTitle className="px-1">
        {t("Amigos")}
      </SectionTitle>

      <div className="mb-3 px-1">
        <p className="mb-2 text-caption text-white/35">
          {fill(t("{n} conectados de {total}", { ...slots("n"), total: friends.length }), { n: <span className="nx-readout text-ok">{connected}</span> })}
        </p>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Buscar amigo…")}
          aria-label={t("Buscar amigo")}
          className="nx-clip-sm w-full bg-black/50 px-3 py-2 text-[12px] text-white placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-drl/60"
          style={{ boxShadow: "inset 0 1px 3px rgba(0,0,0,0.8)" }}
        />
      </div>

      <div className="nx-scroll -mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1">
        {visible.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-white/30">{t("Nadie coincide con «")}{query}».</p>
        ) : (
          visible.map((f, i) => {
            const game = f.gameId ? getGame(f.gameId) : undefined;
            const on = isConnected(f.presence);
            return (
              <motion.button
                key={f.id}
                type="button"
                onClick={() => game && onOpenGame(game.id)}
                initial={motionScale > 0 ? { opacity: 0, x: 12 } : false}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.35, delay: 0.05 + i * 0.03, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  "nx-clip-sm group flex w-full items-center gap-2.5 p-2 text-left transition-colors duration-fast",
                  game ? "hover:bg-white/[0.05]" : "cursor-default",
                  !on && "opacity-45",
                )}
              >
                <span className="relative">
                  <Avatar name={f.name} color={f.color} size={32} />
                  <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-[#0b0d16] p-[2px]">
                    <StatusDot tone={PRESENCE_TONE[f.presence]} size={7} pulse={f.presence === "in-game" || f.presence === "in-queue"} />
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1">
                    <span className="truncate font-display text-[12.5px] font-bold tracking-wide text-white/85">{f.name}</span>
                    <span className="shrink-0 text-[9.5px] font-bold text-white/25">{f.tag}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[10.5px]" style={{ color: on ? TONE[PRESENCE_TONE[f.presence]] : undefined }}>
                    {td(f.activity) ?? tdIn("launcher", PRESENCE_LABEL[f.presence])}
                  </span>
                  {game && (
                    <span className="mt-0.5 block truncate text-label uppercase tracking-wider text-white/30">{game.name}</span>
                  )}
                </span>
              </motion.button>
            );
          })
        )}
      </div>

      <div className="mt-3 border-t border-white/[0.06] pt-3">
        <button
          type="button"
          className="nx-clip-sm w-full bg-white/[0.04] py-2.5 font-display text-caption font-bold uppercase tracking-[0.2em] text-white/60 transition hover:bg-white/[0.09] hover:text-white"
        >
          {t("+ Añadir amigo")}
        </button>
      </div>
    </aside>
  );
}
