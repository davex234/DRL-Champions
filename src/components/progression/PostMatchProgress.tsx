"use client";

/**
 * PROGRESO TRAS UNA ACTIVIDAD (Fase 27 → FASE 62) — post-partida y post-apertura.
 *
 * Recibe una `ProgressionDelta`: la DIFERENCIA entre dos lecturas del servidor (antes y después). Nada aquí modifica
 * progreso: presenta dos verdades del servidor y la distancia entre ellas.
 *
 * FASE 62 · LA SECUENCIA COMPACTA DEL RESULTADO (las recompensas de la partida ya las pinta `ResultScreen`):
 *     CUENTA      nivel y XP de cuenta, de antes → después (+ subida de nivel, «7 → 8»)
 *     OBJETIVOS   «3 / 5 → 4 / 5»; si alguno se COMPLETA, «OBJETIVO COMPLETADO» y se RECLAMA AQUÍ (mismo reclamo del
 *                 servidor, idempotente); lo reclamado sube la XP de TEMPORADA
 *     TEMPORADA   solo si cambió (tras reclamar): nivel y XP de temporada, releídos del servidor
 *     LOGROS      listos para reclamar
 * SOLO las secciones que cambiaron (`postMatchSections`): nada de paneles con +0.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Meter } from "@/components/ui/Meter";
import { LevelUpBanner } from "./ProgressAlerts";
import { accountLevel, summarizeDeltas } from "@/domain/progression/meta";
import { claimables, postMatchSections } from "@/domain/progression/hub";
import { XP_NAMES } from "@/domain/rewards/display";
import { fetchMetaSnapshot, type MetaSnapshot, type ProgressionDelta } from "@/lib/progression/meta";
import { useClaims } from "@/lib/progression/claims";
import { formatCredits } from "@/lib/format";
import { useGameMoment } from "@/components/ui/game/GameMoment";
import { momentsFromProgress } from "@/lib/gameExperience/moments";
import { RewardDisplay } from "@/components/rewards/RewardDisplay";
import { RewardReveal } from "@/components/rewards/RewardReveal";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("progression");

export function PostMatchProgress({ delta, onLevelUpSeen, className }: { delta: ProgressionDelta | null; onLevelUpSeen?: () => void; className?: string }) {
  useLocale();
  const reduced = useReducedMotion();
  /* Fase 44 · objetivo completado / logro / nivel: rótulo de juego UNA vez por hecho real (la clave es la del evento). */
  const moment = useGameMoment();
  useEffect(() => {
    if (!delta) return;
    for (const m of momentsFromProgress(delta.events)) moment(m);
  }, [delta, moment]);

  /* F62 · la foto del servidor TRAS reclamar aquí (para la temporada). Sin reclamos, la de la partida. */
  const [fresh, setFresh] = useState<MetaSnapshot | null>(null);
  const refresh = useCallback(async () => { try { setFresh(await fetchMetaSnapshot()); } catch { /* se queda la anterior */ } }, []);
  const claims = useClaims(refresh);
  const [levelSeen, setLevelSeen] = useState(false);

  const after = fresh ?? delta?.after ?? null;
  const pending = useMemo(() => (after ? claimables(after.pass, after.serverNow) : []), [after]);

  if (!delta) return null;
  const gained = Math.max(0, delta.xpAfter - delta.xpBefore);
  const before = accountLevel(delta.xpBefore);
  const level = accountLevel(delta.xpAfter);
  const { shown, more } = summarizeDeltas(delta.objectives, 3);
  const achievementsReady = pending.filter((c) => c.kind === "achievement");
  const seasonBefore = delta.after.season;
  const seasonNow = after?.season ?? seasonBefore;
  const sections = postMatchSections({
    xpBefore: delta.xpBefore, xpAfter: delta.xpAfter, levelsGained: delta.levelsGained,
    objectives: shown, achievementsReady: achievementsReady.length + delta.events.filter((e) => e.kind === "ACHIEVEMENT").length,
    seasonXpBefore: seasonBefore.level * seasonBefore.xpForNext + seasonBefore.xpIntoLevel,
    seasonXpAfter: seasonNow.level * seasonNow.xpForNext + seasonNow.xpIntoLevel,
    rewardGranted: false,
  });
  const nothing = sections.length === 0;

  return (
    <section aria-label={t("Tu progreso")} className={className} data-postmatch={nothing ? "none" : "changes"} data-sections={sections.join(",")}>
      {delta.levelsGained.length > 0 && !levelSeen && (
        <LevelUpBanner levels={delta.levelsGained} from={before.level} onClose={() => { setLevelSeen(true); onLevelUpSeen?.(); }} autoCloseMs={600_000} />
      )}

      <div className="nx-f62-panel mt-3 p-4">
        {sections.includes("ACCOUNT") && (
          <div data-section="account">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="nx-label !text-[10px] text-[#7ff0ff]">{t("Nivel de cuenta")}</span>
              <span className="nx-readout text-[12px] text-white/70">
                {level.level > before.level ? <><span className="text-white/40">{t("Nivel")} {before.level}</span> → </> : null}
                {t("Nivel")} {level.level} · {formatCredits(level.xpIntoLevel)} / {formatCredits(level.xpForNext)} {td(XP_NAMES.account)}
                {gained > 0 && <span className="ml-2 text-drl-cyan">+{formatCredits(gained)}</span>}
              </span>
            </div>
            <Meter className="mt-2" value={level.progress * 100} tone="info" height={8} label={t("Nivel de cuenta {level}: {Math}%", { level: level.level, Math: Math.round(level.progress * 100) })} />
          </div>
        )}

        {nothing ? (
          <p className="text-caption text-ink-muted">{t("Esta actividad no ha movido tu progreso.")} <Link href="/misiones" className="nx-action">{t("Ver objetivos →")}</Link></p>
        ) : (
          <ul className="mt-3 space-y-2.5" aria-label={t("Objetivos que han avanzado")} data-section="objectives">
            {shown.map((d) => {
              const claim = pending.find((c) => c.kind === "mission" && c.id === d.id) ?? null;
              const done = claims.claimed.some((c) => c.id === d.id) || (claim === null && d.completed);
              return (
                <li key={d.id} data-delta={d.id} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[13px] text-white/85">{td(d.label)}</span>
                    <span className="nx-readout shrink-0 text-[12px] text-white/70">
                      <span className="text-white/40">{d.from}</span> → <span className={d.completed ? "text-ok" : "text-white"}>{d.to}</span> / {d.goal}
                    </span>
                  </div>
                  <motion.div initial={{ opacity: reduced ? 1 : 0.6 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
                    <Meter value={(d.to / Math.max(1, d.goal)) * 100} tone={d.completed ? "ok" : "info"} height={6} label={t("{label}: {to} de {goal}", { label: td(d.label), to: d.to, goal: d.goal })} />
                  </motion.div>
                  {d.completed && (
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded-md bg-[#ffd35c]/10 px-2.5 py-1.5 ring-1 ring-[#ffd35c]/40" data-objective-complete={d.id}>
                      <span className="font-display text-[11px] font-extrabold uppercase tracking-[0.14em] text-drl-gold">{t("Objetivo completado")}</span>
                      {claim && !done ? (
                        <span className="flex items-center gap-2">
                          <RewardDisplay reward={claim.reward} seasonXp={claim.seasonXp} size="sm" />
                          <button type="button" className="nx-f62-cta is-gold !min-h-[36px]" disabled={claims.busy.has(claim.key)} aria-busy={claims.busy.has(claim.key)} onClick={() => void claims.claimOne(claim)} data-testid="postmatch-claim">
                            {claims.busy.has(claim.key) ? "…" : t("Reclamar")}
                          </button>
                        </span>
                      ) : (
                        <span className="text-[12px] text-ok">{t("Recogido")}</span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
            {achievementsReady.map((a) => (
              <li key={a.key} className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-drl-gold" data-delta={a.id} data-section="achievements">
                <span>✦ {td(a.label)} {t("· listo")}</span>
                <button type="button" className="nx-f62-cta is-gold !min-h-[36px]" disabled={claims.busy.has(a.key)} onClick={() => void claims.claimOne(a)}>{t("Reclamar")}</button>
              </li>
            ))}
            {more > 0 && <li className="text-caption text-ink-muted">+ {more} {more === 1 ? t("progreso más") : t("progresos más")} · <Link href="/misiones" className="nx-action">{t("ver todos")}</Link></li>}
          </ul>
        )}

        {sections.includes("SEASON") && (
          <div className="mt-3 border-t border-white/10 pt-3" data-section="season">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="nx-label !text-[10px] text-[#ffe08a]">{t("Temporada")}</span>
              <span className="nx-readout text-[12px] text-white/70">
                {seasonNow.level > seasonBefore.level ? <><span className="text-white/40">{t("Nivel")} {seasonBefore.level}</span> → </> : null}
                {t("Nivel")} {seasonNow.level} / {seasonNow.maxLevel} · {formatCredits(seasonNow.xpIntoLevel)} / {formatCredits(seasonNow.xpForNext)} {td(XP_NAMES.season)}
              </span>
            </div>
            <Meter className="mt-2" value={seasonNow.progress * 100} tone="gold" height={8} label={t("Temporada nivel {level}: {Math}%", { level: seasonNow.level, Math: Math.round(seasonNow.progress * 100) })} />
            {seasonNow.level > seasonBefore.level && <Link href="/cuenta?seccion=progresion" className="nx-action mt-2 inline-block text-[12px]">{t("Nuevas recompensas de temporada por reclamar →")}</Link>}
          </div>
        )}

        {!nothing && <Link href="/cuenta?seccion=progresion" className="nx-action mt-3 inline-block text-[12px]">{t("Ver todo tu progreso →")}</Link>}
      </div>

      <AnimatePresence>
        {claims.claimed.length > 0 && <RewardReveal key="reveal" claimed={claims.claimed} onClose={claims.clearReveal} />}
      </AnimatePresence>
    </section>
  );
}
