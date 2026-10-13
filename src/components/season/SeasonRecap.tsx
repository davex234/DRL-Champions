"use client";

/**
 * «TU TEMPORADA» (Fase 34). Final (temporada terminada) o «hasta ahora» (en curso). Solo las métricas que
 * `buildSeasonRecap` pudo sostener con hechos fechados; lo que no es fiable no aparece (y se dice).
 */
import { useEffect } from "react";
import { cn } from "@/lib/format";
import type { SeasonRecap as Recap } from "@/domain/season/recap";
import { trackSeason } from "@/lib/season/telemetry";

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="nx-clip-sm min-w-0 border border-white/10 bg-black/40 px-4 py-3">
      <span className="nx-label">{label}</span>
      <div className="mt-1">{children}</div>
    </div>
  );
}

const Big = ({ children, sub }: { children: React.ReactNode; sub?: string }) => (
  <p className="nx-readout text-[32px] leading-none text-white">{children}{sub && <span className="block pt-1 font-sans text-[12px] text-ink-muted">{sub}</span>}</p>
);

export function SeasonRecap({ recap, className }: { recap: Recap; className?: string }) {
  const final = recap.kind === "FINAL";
  useEffect(() => { if (final) trackSeason("season_recap_view"); }, [final]);
  if (recap.kind === "NONE") return null;
  return (
    <section id="resumen" aria-labelledby="recap-title" data-testid="season-recap" data-kind={recap.kind} data-minimal={recap.minimal}
      className={cn("nx-clip relative isolate overflow-hidden border p-5 sm:p-7", final ? "border-drl-gold/40" : "border-white/10", className)}
      style={{ background: final ? "radial-gradient(80% 120% at 50% 0%, rgba(255,211,92,0.18), transparent 65%), #07090f" : "#0a0d16" }}>
      <span className="nx-label">{final ? "Tu recorrido" : "Tu temporada"}</span>
      <h2 id="recap-title" className={cn("font-display font-bold uppercase leading-none text-white", final ? "mt-1 text-[clamp(28px,4.6vw,52px)]" : "mt-1 text-[clamp(20px,2.4vw,28px)]")}>
        {final ? <span className="text-drl-gold" style={{ textShadow: "0 0 34px rgba(255,211,92,0.4)" }}>{recap.title}</span> : recap.title}
      </h2>

      {recap.minimal ? (
        <p className="mt-3 max-w-2xl text-body text-ink-secondary" data-testid="recap-minimal">
          {final ? "Una temporada tranquila: no hay partidas ranked, objetivos, logros ni Pick'ems registrados en estas fechas." : "Todavía no hay actividad registrada en esta temporada. Juega, completa objetivos o haz tus Pick'ems."}
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {recap.ranked && (
            <Block label="Ranked">
              <Big sub={recap.ranked.games > 0 ? `${recap.ranked.wins} V · ${recap.ranked.losses} D · ${recap.ranked.draws} E` : "Sin partidas en estas fechas"}>{recap.ranked.games} <span className="text-[14px] text-white/50">{recap.ranked.games === 1 ? "partida" : "partidas"}</span></Big>
              {recap.ranked.finalRating !== null && <p className="mt-2 text-caption text-ink-secondary">Rating {final ? "final" : "actual en la temporada"}: <b className="text-white">{recap.ranked.finalRating}</b>{recap.ranked.highestRating !== null && <> · máximo <b className="text-white">{recap.ranked.highestRating}</b></>}</p>}
            </Block>
          )}
          {recap.pass && (
            <Block label="Pase">
              <Big sub={`${recap.pass.missionsCompleted} objetivos completados`}>Nivel {recap.pass.level}{recap.pass.maxLevel !== null && <span className="text-[14px] text-white/50"> / {recap.pass.maxLevel}</span>}</Big>
              <p className="mt-2 text-caption text-ink-secondary">{recap.pass.claimedFree} recompensas libres · {recap.pass.claimedCompetitive} competitivas reclamadas</p>
            </Block>
          )}
          {recap.achievementsClaimed !== null && (
            <Block label="Logros">
              <Big sub="reclamados en estas fechas">{recap.achievementsClaimed}</Big>
            </Block>
          )}
          {recap.pickems && (
            <Block label="Pick'ems">
              <Big sub={`${recap.pickems.points} puntos · ${recap.pickems.correct} aciertos`}>{recap.pickems.scored} <span className="text-[14px] text-white/50">{recap.pickems.scored === 1 ? "evento puntuado" : "eventos puntuados"}</span></Big>
            </Block>
          )}
          {recap.cardsObtained !== null && (
            <Block label="Colección">
              <Big sub="cartas conseguidas que conservas">+{recap.cardsObtained}</Big>
            </Block>
          )}
        </div>
      )}
      {recap.cardsObtained === null && !recap.minimal && (
        <p className="mt-3 text-[11px] text-ink-faint" data-testid="recap-collection-omitted">Colección: sin historial fiable de obtención por fechas, así que no se incluye.</p>
      )}
    </section>
  );
}
