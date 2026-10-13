"use client";

/**
 * LAUNCHER — PERFIL.
 *
 * La pantalla del usuario: identidad, progreso, biblioteca resumida y actividad. Las cifras
 * salen de la biblioteca REAL del cliente (títulos instalados, espacio ocupado, sesiones), no
 * de constantes: si el usuario instala algo, esta pantalla lo refleja.
 */
import { motion } from "framer-motion";
import { formatBytes } from "@/platform";
import {
  ACTIVITY, PRESENCE_TONE, PRESENCE_LABEL, countConnected, effectiveState, formatDate,
  getFriends, getGame, getGames, stateLabel, stateTone,
  type DownloadJob, type LauncherUser, type LibraryEntry,
} from "@/launcher";
import { Badge, StatusDot } from "@/components/ui/Badge";
import { Meter } from "@/components/ui/Meter";
import { Readout } from "@/components/ui/Readout";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Plate } from "@/components/ui/Surface";
import { Avatar } from "./primitives";
import { ns, td, tdIn } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("launcher");

export function ProfileView({
  user, entries, jobs, motionScale, onOpenGame,
}: {
  user: LauncherUser;
  entries: Record<string, LibraryEntry>;
  jobs: Record<string, DownloadJob>;
  motionScale: number;
  onOpenGame: (gameId: string) => void;
}) {
  useLocale();
  const games = getGames();
  const installed = games.filter((g) => {
    const s = effectiveState(entries[g.id], jobs[g.id]);
    return s === "ready" || s === "installed";
  });
  const diskUsed = installed.reduce((n, g) => n + (entries[g.id]?.bytesOnDisk ?? 0), 0);
  const minutes = Object.values(entries).reduce((n, e) => n + e.minutesPlayed, 0);
  const friends = getFriends();

  return (
    <motion.div
      initial={motionScale > 0 ? { opacity: 0, y: 14 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto max-w-[980px] space-y-6"
    >
      {/* Identidad */}
      <Plate className="relative overflow-hidden p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(90% 120% at 8% 0%, ${user.color}22, transparent 60%)` }}
        />
        <div className="relative flex flex-wrap items-center gap-6">
          <Avatar name={user.name} color={user.color} size={92} />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[34px] font-black uppercase leading-none tracking-tight text-white">
              {user.name}
              <span className="ml-2 align-middle font-display text-[15px] font-bold text-white/25">{user.tag}</span>
            </h1>
            <p className="mt-1.5 flex items-center gap-2 text-[12px] text-white/50">
              <StatusDot tone={PRESENCE_TONE[user.presence]} size={7} pulse={user.presence !== "offline"} />
              {tdIn("launcher", PRESENCE_LABEL[user.presence])}
            </p>
            <div className="mt-4 max-w-[380px]">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-label font-bold uppercase tracking-[0.24em] text-white/35">
                  {t("Nivel")} {user.level}
                </span>
                <span className="text-caption text-white/35">{Math.round(user.levelProgress * 100)} {t("% al nivel")} {user.level + 1}</span>
              </div>
              <Meter value={user.levelProgress * 100} tone="warn" height={6} className="mt-1.5" />
            </div>
          </div>
        </div>
      </Plate>

      {/* Cifras */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Plate className="p-4">
          <Readout size="xs" label={t("Juegos instalados")} value={`${installed.length} / ${games.length}`} tone="var(--nx-cyan)" />
        </Plate>
        <Plate className="p-4">
          <Readout size="xs" label={t("Espacio ocupado")} value={formatBytes(diskUsed)} />
        </Plate>
        <Plate className="p-4">
          <Readout size="xs" label={t("Sesiones registradas")} value={t("{minutes} min", { minutes })} />
        </Plate>
        <Plate className="p-4">
          <Readout size="xs" label={t("Amigos conectados")} value={`${countConnected(friends)} / ${friends.length}`} tone="var(--nx-ok)" />
        </Plate>
      </div>

      {/* Biblioteca */}
      <section>
        <SectionTitle>{t("Mis juegos")}</SectionTitle>
        <Plate className="divide-y divide-white/[0.05]">
          {games.map((g) => {
            const entry = entries[g.id];
            const state = effectiveState(entry, jobs[g.id]);
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => onOpenGame(g.id)}
                className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-white/[0.04]"
              >
                <span
                  className="nx-clip-sm grid h-9 w-9 shrink-0 place-items-center font-display text-[12px] font-black text-white"
                  style={{ background: `linear-gradient(150deg, ${g.palette.key}, ${g.palette.deep})` }}
                >
                  {td(g.monogram)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[13px] font-bold tracking-wide text-white/85">{g.name}</span>
                  <span className="block truncate text-caption text-white/35">
                    {entry?.installPath ?? t("Sin instalar")} · {entry?.installedVersion ? `v${entry.installedVersion}` : "—"}
                  </span>
                </span>
                <Badge dot tone={stateTone(state)}>{stateLabel(state, g, entry)}</Badge>
              </button>
            );
          })}
        </Plate>
      </section>

      {/* Actividad */}
      <section>
        <SectionTitle>{t("Actividad reciente")}</SectionTitle>
        <Plate className="divide-y divide-white/[0.05]">
          {ACTIVITY.map((a) => {
            const game = a.gameId ? getGame(a.gameId) : undefined;
            return (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: game?.palette.key ?? "var(--nx-ink-faint)", boxShadow: `0 0 10px ${game?.palette.key ?? "transparent"}` }}
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-white/70">{td(a.text)}</span>
                <span className="shrink-0 text-caption text-white/30">{formatDate(a.at)}</span>
              </div>
            );
          })}
        </Plate>
      </section>
    </motion.div>
  );
}
