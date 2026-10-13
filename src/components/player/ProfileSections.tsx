"use client";

/**
 * SECCIONES DEL PERFIL (Fase 31): trofeos destacados, ranked
 * reciente (reutiliza `RecentForm`, `outcomeTone` y `OUTCOME_LABEL` de la Fase 28), cara a cara
 * (split RANKED / PRIVADOS / TOTAL de la Fase 29), Pick'ems corregidos y actividad. Solo hechos
 * reales de la foto del servidor; ningún número se inventa aquí.
 * F89 · las estadísticas viven en `ProfileCareer` (todas las partidas, no solo ranked) y la colección en
 * `ProfileCollections` (inventario + Collection Sets de F82).
 */
import Link from "next/link";
import { Plate } from "@/components/ui/Surface";
import { Badge } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { RecentForm } from "@/components/competitive/RecentForm";
import { outcomeTone } from "@/components/competitive/MatchHistoryList";
import { OUTCOME_LABEL, type MatchOutcome } from "@/domain/pvpLadder/ladder";
import { playerHref } from "@/lib/player/href";
import type { PlayerIdentitySnapshot } from "@/domain/profile/identity";
import { ProfileButton, fmtDay } from "./bits";
import { GameGlyph } from "@/components/ui/game/GameGlyph";
import { RankInline } from "@/components/competitive/ranked/CompetitiveEmblem";

/* ───────────── trofeos ───────────── */

export function FeaturedTrophies({ snap, onEdit }: { snap: PlayerIdentitySnapshot; onEdit?: () => void }) {
  const isSelf = snap.view === "SELF";
  const featured = snap.featured;
  return (
    <section aria-label="Logros destacados" data-testid="featured-achievements" data-count={featured.length}>
      <SectionTitle action={isSelf && snap.achievements.completed > 0 ? <button type="button" onClick={onEdit} className="nx-action">Elegir logros</button> : undefined}>
        Trofeos <span className="ml-2 text-ink-faint">· {snap.achievements.completed} / {snap.achievements.total} logros</span>
      </SectionTitle>
      {featured.length === 0 && snap.recentAchievements.length > 0 ? (
        <div data-testid="recent-achievements" data-count={snap.recentAchievements.length}>
          <p className="mb-2 text-[11.5px] text-white/50">{isSelf ? "No has elegido logros destacados: estos son tus últimos logros conseguidos." : "Últimos logros conseguidos (no ha elegido destacados)."}</p>
          <ol className="grid gap-3 sm:grid-cols-3">
            {snap.recentAchievements.map((a) => (
              <li key={a.id}>
                <Plate className="flex h-full flex-col items-center gap-2 px-4 py-5 text-center" data-achievement={a.id}>
                  <span aria-hidden className="nx-plate nx-clip-sm grid h-14 w-14 place-items-center text-drl-cyan"><GameGlyph symbol={a.icon} className="h-7 w-7" /></span>
                  <h3 className="font-display text-[13px] font-bold uppercase tracking-wide text-white">{a.name}</h3>
                  <p className="text-[12px] text-white/55">{a.description}</p>
                  <span className="text-[11px] text-white/40">Conseguido el {fmtDay(a.claimedAt)}</span>
                </Plate>
              </li>
            ))}
          </ol>
          {isSelf && <div className="mt-2"><ProfileButton onClick={onEdit}>Destacar logros</ProfileButton></div>}
        </div>
      ) : featured.length === 0 ? (
        <Plate className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 text-caption text-ink-muted">
          <span>
            {snap.achievements.completed === 0
              ? (isSelf ? "Aún no hay logros para mostrar. Cuando reclames uno, podrás destacarlo aquí." : "Aún no hay logros para mostrar.")
              : (isSelf ? "Destaca hasta 3 de tus logros conseguidos." : `Ha conseguido ${snap.achievements.completed} ${snap.achievements.completed === 1 ? "logro" : "logros"}.`)}
          </span>
          {isSelf && snap.achievements.completed > 0 && <ProfileButton onClick={onEdit}>Destacar logros</ProfileButton>}
        </Plate>
      ) : (
        <ol className="grid gap-3 sm:grid-cols-3">
          {featured.map((a) => (
            <li key={a.id}>
              <Plate tone="gold" className="flex h-full flex-col items-center gap-2 px-4 py-5 text-center" data-achievement={a.id}>
                <span aria-hidden className="nx-plate nx-clip-sm grid h-16 w-16 place-items-center text-3xl" style={{ boxShadow: "0 0 26px rgba(255,211,92,0.25)" }}><GameGlyph symbol={a.icon} className="h-8 w-8 text-drl-gold" /></span>
                <h3 className="font-display text-[14px] font-bold uppercase tracking-wide text-white">{a.name}</h3>
                <p className="text-[12px] text-white/55">{a.description}</p>
                <Badge tone="ok" dot>Conseguido</Badge>
              </Plate>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ───────────── ranked ───────────── */

export function RankedPanel({ snap }: { snap: PlayerIdentitySnapshot }) {
  const r = snap.ranked;
  const isSelf = snap.view === "SELF";
  return (
    <section aria-label="Ranked" data-testid="ranked-panel" data-ranked={r ? "yes" : "no"}>
      <SectionTitle action={r ? <Link href={isSelf ? "/duelos/competitivo/historial" : "/competitivo"} className="nx-action" data-action={isSelf ? "history" : "ladder"}>{isSelf ? "Ver historial →" : "Ver clasificación →"}</Link> : undefined}>Competitivo</SectionTitle>
      {!r ? (
        <Plate className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 text-caption text-ink-muted" data-empty="ranked">
          <span>{isSelf ? "Todavía no has jugado competitivo. Tu primera partida liquidada te pone en la escalera." : "Todavía no ha jugado competitivo."}</span>
          {isSelf && <Link href="/competitivo" className="nx-action">Ir a Competitivo →</Link>}
        </Plate>
      ) : (
        <Plate className="p-4">
          <StandingRail snap={snap} />
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <Readout size="sm" label="Posición" value={r.position != null ? `#${r.position}` : "Sin clasificar"} unit={r.position != null ? `de ${r.rankedTotal}` : undefined} />
            <Readout size="sm" label="Rating" value={r.rating} tone="var(--nx-cyan)" />
            <Readout size="sm" label="Récord" value={`${r.wins}–${r.losses}${r.draws > 0 ? `–${r.draws}` : ""}`} tone="var(--nx-ok)" />
            <RecentForm form={r.form} streak={r.streak} />
          </div>
          {snap.recentMatches.length === 0 ? (
            <p className="mt-3 text-caption text-ink-muted">Sin partidas recientes.</p>
          ) : (
            <ol className="mt-4 divide-y divide-white/[0.06] border-t border-white/[0.08]" aria-label="Últimas partidas ranked">
              {snap.recentMatches.map((m) => (
                <li key={m.matchId} className="flex items-center gap-3 py-2 text-[13px]" data-outcome={m.outcome}>
                  <Badge tone={outcomeTone(m.outcome as MatchOutcome)} className="w-[2.6rem] justify-center">{m.letter ?? "—"}</Badge>
                  <span className="min-w-0 flex-1 truncate text-white/85">
                    vs <Link href={playerHref(m.rival.userId)} className="nx-focus text-white underline-offset-2 hover:underline"><span aria-hidden>{m.rival.avatar} </span>{m.rival.username}</Link>
                    <span className="ml-2 text-white/40">{OUTCOME_LABEL[m.outcome as MatchOutcome] ?? ""}</span>
                  </span>
                  <span className="nx-readout text-white/70">{m.scoreYou}–{m.scoreRival}</span>
                  <time className="text-[11px] text-white/35">{fmtDay(m.at)}</time>
                </li>
              ))}
            </ol>
          )}
        </Plate>
      )}
    </section>
  );
}

/**
 * FASE 56 · ANTERIOR → JUGADOR → SIGUIENTE en la escalera real (vecinos públicos con enlace a su perfil) o, en
 * colocación, las muescas. Mismo lenguaje que el centro competitivo.
 *
 * F84 · con temporada competitiva, la colocación es la DE LA TEMPORADA (X / N, servidor) y, clasificado, el RANGO con su
 * mejor rango de la temporada; el puesto es el del Top. Sin temporada competitiva, queda la lectura de la Fase 56.
 */
function StandingRail({ snap }: { snap: PlayerIdentitySnapshot }) {
  const st = snap.standing;
  const r = snap.ranked;
  if (!st || !r) return null;
  const who = snap.view === "SELF" ? "Te faltan" : "Le faltan";
  const comp = snap.competitive;
  const placement = comp ? (comp.state === "PLACEMENT" ? { ...comp.placement, remaining: comp.placement.total - comp.placement.played } : null) : st.state === "PLACEMENT" ? st.placement : null;
  const n = (x: { userId: string; username: string; position: number; rating: number } | null, side: "above" | "below") => (
    <div className={side === "above" ? "min-w-0 text-right" : "min-w-0 text-left"} data-field={`rail-${side}`}>
      <span className="nx-label block !text-[9.5px] !text-white/45">{side === "above" ? "Siguiente ↑" : "↓ Anterior"}</span>
      {x ? (
        <Link href={playerHref(x.userId)} className="nx-focus block min-w-0 underline-offset-2 hover:underline">
          <span className="nx-readout block truncate text-[14px] text-white/85">#{x.position} · {x.rating}</span>
          <span className="block truncate text-[11px] text-white/50">{x.username}</span>
        </Link>
      ) : <span className="block text-[11px] text-white/35">{side === "above" ? (r.position === 1 ? "Nadie por delante" : "—") : "Nadie por detrás"}</span>}
    </div>
  );
  return (
    <div className="mb-4 space-y-3" data-testid="profile-standing" data-state={comp?.state ?? st.state}>
      {comp?.state === "RANKED" && comp.rank && (
        <div className="flex flex-wrap items-center justify-between gap-2" data-field="rank">
          <RankInline rank={comp.rank} />
          {comp.peakRank && <span className="text-[11.5px] text-white/55">Mejor de la temporada: <b style={{ color: comp.peakRank.color }}>{comp.peakRank.label}</b></span>}
        </div>
      )}
      {placement && (
        <div data-field="placement">
          <p className="flex items-baseline justify-between"><span className="nx-label !text-drl-cyan">Partidas de colocación</span><span className="nx-readout text-[15px] text-white">{placement.played} / {placement.total}</span></p>
          <ol className="mt-1.5 grid gap-1" style={{ gridTemplateColumns: `repeat(${placement.total}, minmax(0, 1fr))` }} aria-label={`Colocación: ${placement.played} de ${placement.total} partidas`}>
            {Array.from({ length: placement.total }, (_, i) => <li key={i} className={`nx-clip-sm h-2 ${i < placement.played ? "bg-drl-cyan" : "bg-white/10"}`} />)}
          </ol>
          <p className="mt-1 text-[11px] text-white/45">{who} {placement.remaining} para {comp ? "revelar su rango de la temporada" : "salir de colocación"}.</p>
        </div>
      )}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        {n(st.below, "below")}
        <span className="nx-clip-sm border border-drl/60 bg-drl/15 px-2.5 py-1.5 text-center">
          <span className="nx-label block !text-[9.5px] !text-white/60">{snap.view === "SELF" ? "Tú" : "Jugador"}</span>
          <span className="nx-readout block text-[16px] leading-none text-white">{r.position != null ? `#${r.position}` : "—"}</span>
        </span>
        {n(st.above, "above")}
      </div>
      {st.above && <p className="text-[12px] text-white/65"><b className="nx-readout text-drl-cyan">+{st.above.gap}</b> de rating para superar a {st.above.username}.</p>}
    </div>
  );
}

/* ───────────── temporada (Fase 56) ───────────── */

/**
 * TEMPORADA ACTUAL en el perfil: nombre del calendario canónico y el tramo ranked de la temporada, contado con la
 * misma función que `/temporada` (`rankedRecap`). El pase (nivel, misiones) es PRIVADO: no viaja a un perfil ajeno;
 * en el propio, «Ver temporada» lleva al hub. El rating no se reinicia por temporada.
 */
export function ProfileSeason({ snap }: { snap: PlayerIdentitySnapshot }) {
  const s = snap.season;
  if (!s) return null;
  const days = Math.floor(s.remainingMs / 86_400_000);
  const r = s.ranked;
  return (
    <section aria-label="Temporada actual" data-testid="profile-season" data-season={s.id}>
      <SectionTitle action={snap.view === "SELF" ? <Link href="/temporada/pase" className="nx-action" data-action="season">Ver temporada →</Link> : undefined}>Temporada actual</SectionTitle>
      <Plate tone="gold" className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="font-display text-[16px] font-bold uppercase text-white">{s.displayName}</p>
          <p className="text-[11.5px] text-white/50">{days >= 1 ? `Quedan ${days} ${days === 1 ? "día" : "días"}` : "Último día"} · el rating continúa entre temporadas</p>
        </div>
        {r.games === 0 ? (
          <p className="text-caption text-ink-muted" data-empty="season-ranked">Sin partidas ranked esta temporada.</p>
        ) : (
          <div className="flex flex-wrap gap-x-6 gap-y-2" data-field="season-ranked">
            <Readout size="sm" label="Ranked" value={r.games} unit={r.games === 1 ? "partida" : "partidas"} />
            <Readout size="sm" label="V – D – E" value={`${r.wins} – ${r.losses} – ${r.draws}`} tone="var(--nx-ok)" />
            {r.net !== null && <Readout size="sm" label="Neto" value={`${r.net > 0 ? "+" : ""}${r.net}`} tone={r.net >= 0 ? "var(--nx-cyan)" : "var(--nx-bad)"} />}
            {r.best !== null && <Readout size="sm" label="Mejor rating" value={r.best} tone="var(--nx-gold)" />}
          </div>
        )}
      </Plate>
    </section>
  );
}

/* ───────────── cara a cara ───────────── */

export function H2HPanel({ snap }: { snap: PlayerIdentitySnapshot }) {
  const h = snap.h2h;
  if (!h) return null;
  const cell = (label: string, n: { matches: number }, text: string, strong?: boolean) => (
    <div className="text-center" data-h2h={label.toLowerCase()}>
      <span className="nx-label">{label}</span>
      <span className={`nx-readout mt-1 block text-[22px] ${strong ? "text-white" : "text-white/75"}`}>{n.matches === 0 ? "—" : text}</span>
      <span className="text-[11px] text-white/35">{n.matches} {n.matches === 1 ? "partida" : "partidas"}</span>
    </div>
  );
  return (
    <section aria-label="Cara a cara" data-testid="h2h-panel" data-total={h.total.matches}>
      <SectionTitle>Cara a cara contigo</SectionTitle>
      <Plate className="grid grid-cols-3 gap-3 p-4">
        {cell("Ranked", h.ranked, h.text.ranked)}
        {cell("Privados", h.private, h.text.private)}
        {cell("Total", h.total, h.text.total, true)}
      </Plate>
      <p className="mt-1 text-[11px] text-white/35">Tus victorias – las suyas. Los privados solo los veis vosotros dos.</p>
    </section>
  );
}

/* ───────────── Pick'ems ───────────── */

export function PickemsIdentity({ snap }: { snap: PlayerIdentitySnapshot }) {
  const p = snap.pickems;
  return (
    <section aria-label="Eventos y Pick'ems" data-testid="pickems-identity" data-events={p?.events ?? 0}>
      <SectionTitle>Eventos · Pick&apos;ems</SectionTitle>
      {!p ? (
        <Plate className="px-4 py-4 text-caption text-ink-muted">{snap.view === "SELF" ? "Todavía no tienes Pick'ems corregidos." : "Todavía no tiene Pick'ems corregidos."}</Plate>
      ) : (
        <Plate className="p-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Readout size="sm" label="Pick'ems" value={p.events} />
            <Readout size="sm" label="Puntos" value={p.points} tone="var(--nx-gold)" />
            <Readout size="sm" label="Aciertos" value={`${p.correct} / ${p.total}`} tone="var(--nx-ok)" />
            <Readout size="sm" label="Precisión" value={p.accuracy != null ? `${p.accuracy} %` : "—"} />
          </div>
          <ol className="mt-3 divide-y divide-white/[0.06] border-t border-white/[0.08]">
            {p.recent.map((e) => (
              <li key={e.pickemEventId} className="flex items-center gap-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-white/85">{e.title}</span>
                <span className="text-[12px] text-white/55">{e.correct} / {e.total} aciertos</span>
                <span className="nx-readout text-drl-gold">{e.points} pts</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] text-white/35">Solo predicciones ya corregidas: nunca una elección antes de su cierre.</p>
        </Plate>
      )}
    </section>
  );
}

/* ───────────── actividad ───────────── */

const GLYPH = { RANKED_RESULT: "◆", ACHIEVEMENT: "✦", PICKEM_SCORED: "◈" } as const;

export function ProfileActivity({ snap }: { snap: PlayerIdentitySnapshot }) {
  return (
    <section aria-label="Actividad reciente" data-testid="profile-activity" data-count={snap.activity.length}>
      <SectionTitle>Actividad reciente</SectionTitle>
      {snap.activity.length === 0 ? (
        <Plate className="px-4 py-4 text-caption text-ink-muted">Sin actividad pública todavía.</Plate>
      ) : (
        <ol className="nx-clip-sm divide-y divide-white/[0.06] border border-white/[0.09] bg-white/[0.02]">
          {snap.activity.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-[13px]" data-kind={a.kind}>
              <span aria-hidden className="w-5 text-center text-white/60">{GLYPH[a.kind]}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-white">{a.title}</span><span className="block truncate text-[11px] text-white/45">{a.detail}</span></span>
              <time className="shrink-0 text-[11px] text-white/40">{fmtDay(a.at)}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
