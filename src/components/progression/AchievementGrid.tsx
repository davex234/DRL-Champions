"use client";

/**
 * LOGROS 2.0 (Fase 27). El catálogo real (7 logros) como colección de hitos, agrupada por
 * categoría DERIVADA (Sobres, Colección: no hay logros de juego, competitivos ni de Pick'ems, así
 * que esas categorías no aparecen). Estado por autoridad real: Bloqueado · En progreso ·
 * Pendiente de recoger · Conseguido, con la fecha si el servidor la tiene (`claimedAt`).
 * Sin logros secretos en el catálogo: no se inventan.
 */
import Link from "next/link";
import { Meter } from "@/components/ui/Meter";
import { Badge } from "@/components/ui/Badge";
import { cn, formatCredits } from "@/lib/format";
import {
  achievementCategory, categoriesPresent, achievementStatus, isSecretAchievement,
  CATEGORY_LABEL, ACHIEVEMENT_STATUS_LABEL, type AchievementStatus,
} from "@/domain/progression/meta";
import type { AchievementView } from "@/server/services/progression";
import { GameGlyph } from "@/components/ui/game/GameGlyph";

const TONE: Record<AchievementStatus, "muted" | "info" | "gold" | "ok"> = {
  BLOQUEADO: "muted", EN_PROGRESO: "info", PENDIENTE_DE_RECOGER: "gold", CONSEGUIDO: "ok",
};

const fmtDate = (s: string) => new Date(s).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });

export function AchievementCard({ a }: { a: AchievementView }) {
  const status = achievementStatus(a);
  const secret = isSecretAchievement(a.id) && status === "BLOQUEADO";
  const pct = a.goal > 0 ? Math.min(100, (a.current / a.goal) * 100) : 0;
  return (
    <article
      data-achievement={a.id}
      data-status={status}
      className={cn(
        "nx-clip-sm flex items-start gap-3 border p-3.5",
        status === "PENDIENTE_DE_RECOGER" ? "border-drl-gold/50 bg-drl-gold/[0.07]"
          : status === "CONSEGUIDO" ? "border-ok/30 bg-ok/[0.04]"
            : "border-white/[0.09] bg-white/[0.025]",
        status === "BLOQUEADO" && "opacity-80",
      )}
    >
      <span className="nx-plate nx-clip-sm grid h-11 w-11 shrink-0 place-items-center text-xl text-drl-cyan" aria-hidden>{secret ? "?" : <GameGlyph symbol={a.icon} className="h-6 w-6" />}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <b className="font-display text-[15px] font-bold text-white">{secret ? "Logro secreto" : a.name}</b>
          <Badge tone={TONE[status]} dot={status !== "BLOQUEADO"}>{ACHIEVEMENT_STATUS_LABEL[status]}</Badge>
        </div>
        <p className="text-[12.5px] leading-snug text-white/50">{secret ? "Se revela al conseguirlo." : a.description}</p>
        <Meter className="mt-2" height={6} tone={TONE[status] === "muted" ? "info" : TONE[status]} value={pct} label={`${a.name}: ${a.current} de ${a.goal}`} />
        <p className="nx-readout mt-1.5 text-[12px] text-white/50">
          {a.current} / {a.goal} · <span className="text-drl-gold">{formatCredits(a.reward)} créditos</span>
          {a.claimedAt && <span className="ml-2 text-white/35">· {fmtDate(a.claimedAt)}</span>}
        </p>
        {status === "PENDIENTE_DE_RECOGER" && (
          <Link href="/logros" className="nx-action mt-1.5 inline-block">Recoger en Logros y pase →</Link>
        )}
      </div>
    </article>
  );
}

export function AchievementGrid({ achievements, className }: { achievements: AchievementView[]; className?: string }) {
  const cats = categoriesPresent(achievements.map((a) => a.id));
  const done = achievements.filter((a) => a.claimed).length;
  return (
    <section aria-label="Logros" className={className} data-achievements={achievements.length}>
      <p className="mb-3 text-caption text-ink-muted">
        <b className="nx-readout text-white">{done}</b> de {achievements.length} conseguidos · permanentes, no se reinician con la temporada
      </p>
      <div className="space-y-5">
        {cats.map((c) => {
          const items = achievements.filter((a) => achievementCategory(a.id) === c);
          return (
            <div key={c} data-category={c}>
              <h3 className="nx-label mb-2 !text-white/70">{CATEGORY_LABEL[c]} <span className="text-white/35">· {items.filter((a) => a.claimed).length}/{items.length}</span></h3>
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((a) => <AchievementCard key={a.id} a={a} />)}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
