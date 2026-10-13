"use client";

/**
 * LAUNCHER — MENÚ DE USUARIO.
 *
 * Desplegable animado con identidad, presencia editable, progreso de nivel, actividad
 * reciente y accesos. Se cierra al pulsar fuera o con Escape — lo básico que casi nadie
 * implementa y que separa un menú de un `div` que aparece.
 */
import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ACTIVITY, PRESENCE_TONE, PRESENCE_LABEL, formatDate, getGame,
  type LauncherUser, type PresenceId,
} from "@/launcher";
import { cn } from "@/lib/format";
import { StatusDot } from "@/components/ui/Badge";
import { Meter } from "@/components/ui/Meter";
import { Avatar } from "./primitives";

const PRESENCES: PresenceId[] = ["online", "in-queue", "away", "offline"];

export function ProfileMenu({
  open, user, onClose, onPresence, onNavigate, onExit, motionScale,
}: {
  open: boolean;
  user: LauncherUser;
  onClose: () => void;
  onPresence: (p: PresenceId) => void;
  onNavigate: (view: "profile" | "settings") => void;
  onExit: () => void;
  motionScale: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // `mousedown` y no `click`: cerrar al empezar la pulsación evita el parpadeo del reabrir.
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: -10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: motionScale > 0 ? 0.2 : 0, ease: [0.16, 1, 0.3, 1] }}
          className="nx-clip-sm nx-no-drag absolute right-0 top-[calc(100%+10px)] z-overlay w-[300px] overflow-hidden border border-white/10 bg-[#0b0d16]/95 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.95)] backdrop-blur-xl"
        >
          <div className="flex items-center gap-3 border-b border-white/[0.07] p-4">
            <Avatar name={user.name} color={user.color} size={44} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[15px] font-black uppercase tracking-wide text-white">
                {user.name}
                <span className="ml-1 text-caption font-bold text-white/30">{user.tag}</span>
              </p>
              <p className="flex items-center gap-1.5 text-caption text-white/45">
                <StatusDot tone={PRESENCE_TONE[user.presence]} size={6} />
                {PRESENCE_LABEL[user.presence]}
              </p>
            </div>
          </div>

          <div className="border-b border-white/[0.07] px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="font-display text-label font-bold uppercase tracking-[0.24em] text-white/35">Nivel</span>
              <span className="nx-readout text-[15px] text-drl-gold">{user.level}</span>
            </div>
            <Meter value={user.levelProgress * 100} tone="warn" height={5} className="mt-2" />
            <p className="mt-1.5 text-[10.5px] text-white/35">
              {Math.round(user.levelProgress * 100)} % hacia el nivel {user.level + 1}
            </p>
          </div>

          <div className="border-b border-white/[0.07] px-2 py-2">
            <p className="px-2 pb-1.5 font-display text-label font-bold uppercase tracking-[0.24em] text-white/35">Estado</p>
            <div className="grid grid-cols-2 gap-1">
              {PRESENCES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPresence(p)}
                  className={cn(
                    "nx-clip-sm flex items-center gap-2 px-2.5 py-1.5 text-[11.5px] transition",
                    p === user.presence ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/[0.06] hover:text-white",
                  )}
                >
                  <StatusDot tone={PRESENCE_TONE[p]} size={6} />
                  {PRESENCE_LABEL[p]}
                </button>
              ))}
            </div>
          </div>

          <div className="border-b border-white/[0.07] px-4 py-3">
            <p className="pb-2 font-display text-label font-bold uppercase tracking-[0.24em] text-white/35">Actividad reciente</p>
            <ul className="space-y-2">
              {ACTIVITY.slice(0, 3).map((a) => (
                <li key={a.id} className="flex gap-2">
                  <span
                    aria-hidden
                    className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: getGame(a.gameId ?? "")?.palette.key ?? "var(--nx-ink-faint)" }}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[11.5px] text-white/70">{a.text}</span>
                    <span className="block text-label text-white/30">{formatDate(a.at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="p-1.5">
            <MenuItem onClick={() => onNavigate("profile")}>Ver perfil completo</MenuItem>
            <MenuItem onClick={() => onNavigate("settings")}>Configuración</MenuItem>
            <MenuItem onClick={onExit} danger>
              Cerrar el cliente
            </MenuItem>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "nx-clip-sm block w-full px-3 py-2 text-left text-[12.5px] font-semibold transition",
        danger ? "text-bad/80 hover:bg-bad/10 hover:text-bad" : "text-white/70 hover:bg-white/[0.07] hover:text-white",
      )}
    >
      {children}
    </button>
  );
}
