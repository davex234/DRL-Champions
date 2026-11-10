"use client";

/**
 * F89 · COLECCIÓN EN EL PERFIL — inventario (copias / cartas distintas) + Collection Sets de F82.
 *
 *   · Copias y distintas: la misma semántica del inventario (Fase 27: «distintas» = definiciones, no ejemplares).
 *   · Colecciones: números de F82 tal cual (compleciones permanentes en `user_collection_completions`):
 *       completadas de las publicadas = numerador; publicadas hoy = denominador. Las retiradas que completó siguen siendo
 *       suyas y cuentan en «colecciones completadas» (trofeo permanente).
 *   · El progreso de lo NO completado es privado: no viaja a un perfil ajeno (la Sala de Trofeos es de cada uno).
 */
import Link from "next/link";
import { Plate } from "@/components/ui/Surface";
import { Meter } from "@/components/ui/Meter";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { TrophyBadge } from "@/components/trophies/TrophyBadge";
import type { PlayerIdentitySnapshot } from "@/domain/profile/identity";
import { Badge } from "@/components/ui/Badge";
import { fmtDate, RARITY_TONE } from "./bits";

export function ProfileCollections({ snap }: { snap: PlayerIdentitySnapshot }) {
  const isSelf = snap.view === "SELF";
  const c = snap.collection;
  const sets = snap.collections;
  const maxRarity = Math.max(1, ...snap.rarity.map((x) => x.count));
  return (
    <section aria-labelledby="collections-title" data-testid="profile-collections" data-distinct={c.distinct} data-instances={c.instances}
      data-sets-completed={sets?.setsCompleted ?? ""} data-team-sets={sets?.teamSetsCompleted ?? ""} data-badges={sets?.badgesUnlocked ?? ""}>
      <SectionTitle action={isSelf ? <Link href="/coleccion/trofeos" className="nx-focus nx-action" data-action="trophy-room-link">Ver Sala de Trofeos</Link> : undefined}>
        <span id="collections-title">Colección</span>
      </SectionTitle>
      <Plate className="overflow-hidden p-5 sm:p-6">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
          <Item label="Copias" value={c.instances} hint="cartas en el inventario" stat="instances" />
          <Item label="Cartas distintas" value={c.distinct} hint={`de ${c.totalCards}`} stat="distinct" />
          {sets && <Item label="Colecciones" value={sets.publishedCompleted} hint={`de ${sets.publishedSets} publicadas`} stat="sets" tone="var(--nx-gold)" />}
          {sets && <Item label="Equipos completos" value={sets.teamSetsCompleted} hint="colecciones de equipo" stat="team-sets" />}
          {sets && <Item label="Insignias" value={sets.badgesUnlocked} hint="desbloqueadas" stat="badges" tone="var(--nx-cyan)" />}
        </dl>
        {sets && sets.publishedSets > 0 && (
          <Meter value={Math.round((sets.publishedCompleted / sets.publishedSets) * 100)} tone="gold" height={5}
            label={`${sets.publishedCompleted} de ${sets.publishedSets} colecciones publicadas completadas`} className="mt-5" />
        )}

        {snap.rarity.length > 0 && (
          <ul className="mt-5 grid gap-1.5 sm:grid-cols-2 sm:gap-x-8" aria-label="Distribución por rareza (cartas distintas)" data-testid="rarity-summary">
            {snap.rarity.map((x) => (
              <li key={x.bucket} className="flex items-center gap-3 text-[12px]" data-rarity={x.bucket}>
                <Badge tone={RARITY_TONE[x.bucket]} className="w-[96px] justify-center">{x.label}</Badge>
                <Meter value={(x.count / maxRarity) * 100} tone={RARITY_TONE[x.bucket] === "muted" ? "info" : RARITY_TONE[x.bucket]} height={4} label={`${x.label}: ${x.count} cartas distintas`} className="flex-1" />
                <span className="w-10 text-right tabular-nums text-white/70">{x.count}</span>
              </li>
            ))}
          </ul>
        )}

        {sets && sets.completed.length > 0 ? (
          <div className="mt-6" data-testid="completed-sets" data-count={sets.completed.length}>
            <h3 className="nx-label">Colecciones completadas</h3>
            <ol className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {sets.completed.slice(0, 8).map((s) => (
                <li key={s.setId}>
                  <Link href={`/coleccion/trofeos/${encodeURIComponent(s.setId)}`} className="nx-focus nx-clip-sm flex h-full flex-col items-center gap-2 border border-white/[0.08] bg-black/25 px-3 py-4 text-center transition hover:border-drl-gold/40 hover:bg-white/[0.04]" data-set={s.setId}>
                    <TrophyBadge badge={{ id: s.setId, label: s.title, logo: s.logo, color: s.kind === "TEAM" ? "#19e3ff" : "#ffce4f", kind: s.kind, caption: s.kind === "TEAM" ? "Equipo completado" : "Edición completada" }} size="sm" />
                    <span className="block w-full truncate font-display text-[12.5px] font-bold uppercase tracking-wide text-white">{s.title}</span>
                    <span className="text-[11px] text-white/45">{fmtDate(s.day)}</span>
                  </Link>
                </li>
              ))}
            </ol>
            {sets.completed.length > 8 && <p className="mt-2 text-[11px] text-white/45">y {sets.completed.length - 8} más</p>}
          </div>
        ) : sets ? (
          <p className="mt-5 text-caption text-ink-muted" data-testid="completed-sets" data-count={0}>
            {isSelf ? "Aún no has completado ninguna colección. Cada equipo completado es una insignia permanente." : "Aún no ha completado ninguna colección."}
            {isSelf && <> <Link href="/coleccion/trofeos" className="nx-focus nx-action">Ver qué te falta</Link></>}
          </p>
        ) : null}
      </Plate>
    </section>
  );
}

function Item({ label, value, hint, tone, stat }: { label: string; value: number; hint: string; tone?: string; stat: string }) {
  return (
    <div data-stat={stat} className="min-w-0">
      <dt className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/45">{label}</dt>
      <dd className="mt-0.5 font-display text-[24px] font-bold tabular-nums text-white sm:text-[28px]" style={tone ? { color: tone } : undefined}>{value}</dd>
      <dd className="text-[11px] text-white/40">{hint}</dd>
    </div>
  );
}
