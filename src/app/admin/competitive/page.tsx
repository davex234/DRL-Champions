"use client";

/**
 * F58 · /admin/competitive — salud del competitivo (duel_pvp_ratings + duel_pvp_rating_events). SOLO LECTURA: el dominio
 * no tiene acciones administrativas (invalidar resultado, reset) y el panel no se las inventa.
 *
 * F84 · Ranked 2.0: temporada competitiva activa, fronteras de rango VERSIONADAS, versión de fórmula, distribución por
 * rango y salud de la clasificación. Tampoco hay «poner rating = X»: una corrección excepcional es la RPC auditada
 * `competitive_rating_correct` (motivo obligatorio, asiento inmutable), que no tiene botón aquí.
 */
import { useRouter } from "next/navigation";
import { useAdminQuery, fmt, dateTime } from "@/components/admin/cc/api";
import { PageHeader, Panel, Stat, Loading, ErrorBox, DataTable, Bars, LevelBadge, Empty } from "@/components/admin/cc/ui";

interface F84 {
  season: { id: string; name: string; number: number; startsAt: number; endsAt: number | null; rankConfigVersion: string; formulaVersion: string; placementGames: number; top: { size: number; minSeasonMatches: number; activeDays: number }; pairCap: { matches: number; hours: number }; gameSeasonId: string | null } | null;
  thresholds: { label: string; floor: number; ceil: number | null; color: string }[];
  configIssues: string[];
  formula: { version: string; initial: number; kProvisional: number; kEstablished: number; provisionalGames: number; floor: number; ceiling: number };
  tiers: { tier: string; color: string; all: number; seasonRanked: number }[];
  health: { seasonPlayers: number; placementDone: number; eligible: number; seasonEvents: number; seasonMatchesSum: number; pairCapped: number; adjustments: number };
}

interface V {
  f84?: F84;
  players: number; rated: number; games: number;
  distribution: { from: number; to: number; count: number }[];
  top: { userId: string; username: string | null; rating: number; games: number; wins: number; losses: number; draws: number }[];
  recent: { at: string | null; matchId: string; userId: string; username: string | null; oldRating: number; newRating: number; delta: number; result: string }[];
  anomalies: { kind: string; detail: string }[];
}

export default function Competitive() {
  const router = useRouter();
  const q = useAdminQuery<V>("/api/admin/catalog?view=competitive");
  const d = q.data;
  return (
    <>
      <PageHeader eyebrow="Juego" title="Competitivo" description="Rating Elo de PvP, distribución, partidas puntuadas y anomalías detectadas en los datos. Sin acciones: el dominio no define ninguna acción administrativa segura sobre resultados." />
      {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
      {!d && !q.error && <Loading />}
      {d && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Con rating" value={fmt(d.players)} accent="cyan" />
            <Stat label="Clasificados" value={fmt(d.rated)} hint="con partidas" accent="ok" />
            <Stat label="Partidas puntuadas" value={fmt(d.games)} accent="gold" />
            <Stat label="Anomalías" value={fmt(d.anomalies.length)} accent={d.anomalies.length ? "warn" : "default"} />
          </div>
          {d.f84 && <RankedF84 f={d.f84} />}
          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title="Distribución de rating">{d.distribution.length ? <Bars label="Jugadores por tramo de rating" data={d.distribution.map((b) => ({ label: `${b.from}–${b.to}`, value: b.count }))} /> : <Empty title="Sin partidas puntuadas" />}</Panel>
            <Panel title="Anomalías">{d.anomalies.length ? <ul className="space-y-1.5">{d.anomalies.map((a, i) => <li key={i} className="flex gap-2 text-[13px]"><LevelBadge level="WARNING" label={a.kind} />{a.detail}</li>)}</ul> : <div className="flex items-center gap-2 text-[13px] text-ink-muted"><LevelBadge level="HEALTHY" label="Ninguna" />Contadores, deltas y saltos coherentes.</div>}</Panel>
          </div>
          <Panel title="Escalera (top 20)">
            <DataTable caption="Escalera" rows={d.top} rowKey={(r) => r.userId} onRowClick={(r) => router.push(`/admin/users/${r.userId}`)} empty="Sin jugadores"
              cols={[
                { key: "u", label: "Jugador", render: (r) => <b className="text-ink-primary">{r.username ?? r.userId.slice(0, 8)}</b> },
                { key: "r", label: "Rating", align: "right", render: (r) => r.rating, sort: (r) => r.rating },
                { key: "g", label: "Partidas", align: "right", render: (r) => r.games },
                { key: "w", label: "V / D / E", align: "right", render: (r) => `${r.wins} / ${r.losses} / ${r.draws}` },
              ]} />
          </Panel>
          <Panel title="Resultados recientes">
            <DataTable caption="Resultados recientes" rows={d.recent} rowKey={(r) => `${r.matchId}:${r.userId}`} empty="Sin resultados"
              cols={[
                { key: "t", label: "Fecha", render: (r) => dateTime(r.at) },
                { key: "u", label: "Jugador", render: (r) => r.username ?? r.userId.slice(0, 8) },
                { key: "res", label: "Resultado", render: (r) => r.result },
                { key: "d", label: "Rating", align: "right", render: (r) => <span>{r.oldRating} → <b className="text-ink-primary">{r.newRating}</b> <span className={r.delta >= 0 ? "text-ok" : "text-bad"}>({r.delta >= 0 ? "+" : ""}{r.delta})</span></span> },
                { key: "m", label: "Partida", render: (r) => <code className="text-[11px] text-ink-faint">{r.matchId.slice(0, 12)}</code> },
              ]} />
          </Panel>
        </div>
      )}
    </>
  );
}

/** F84 · temporada competitiva, fronteras, fórmula, distribución por rango y salud de la clasificación. */
function RankedF84({ f }: { f: F84 }) {
  const s = f.season;
  return (
    <div className="space-y-6" data-testid="admin-ranked-f84">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="En la temporada" value={fmt(f.health.seasonPlayers)} hint="con partidas" accent="cyan" />
        <Stat label="Colocación completa" value={fmt(f.health.placementDone)} accent="ok" />
        <Stat label="En el Top" value={fmt(f.health.eligible)} hint={s ? `máx. ${s.top.size}` : undefined} accent="gold" />
        <Stat label="Tope de pareja" value={fmt(f.health.pairCapped)} hint="asientos sin intercambio" accent={f.health.pairCapped ? "warn" : "default"} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Temporada competitiva">
          {s ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-ink-muted">Temporada</dt><dd className="text-ink-primary">{s.name} ({s.id})</dd>
              <dt className="text-ink-muted">Desde</dt><dd>{dateTime(new Date(s.startsAt).toISOString())}</dd>
              <dt className="text-ink-muted">Hasta</dt><dd>{s.endsAt ? dateTime(new Date(s.endsAt).toISOString()) : "Abierta (hasta programar la siguiente)"}</dd>
              <dt className="text-ink-muted">Temporada F83 enlazada</dt><dd>{s.gameSeasonId ?? "Ninguna (XP de temporada ≠ rating)"}</dd>
              <dt className="text-ink-muted">Colocación</dt><dd>{s.placementGames} partidas</dd>
              <dt className="text-ink-muted">Entrar en el Top</dt><dd>colocación + ≥ {s.top.minSeasonMatches} partidas + actividad en {s.top.activeDays} días</dd>
              <dt className="text-ink-muted">Tope de pareja</dt><dd>{s.pairCap.matches} partidas puntuadas / {s.pairCap.hours} h</dd>
              <dt className="text-ink-muted">Fronteras</dt><dd>{s.rankConfigVersion}{f.configIssues.length ? ` · ${f.configIssues.length} problemas` : " · válidas"}</dd>
            </dl>
          ) : <Empty title="Sin temporada competitiva activa" />}
        </Panel>
        <Panel title={`Fórmula · ${f.formula.version}`}>
          <p className="text-[13px] text-ink-muted">Elo de 0033–0035, sin cambios: inicial {f.formula.initial}, K {f.formula.kProvisional} con menos de {f.formula.provisionalGames} partidas y {f.formula.kEstablished} después, suelo {f.formula.floor}, techo {f.formula.ceiling}. El rango se DERIVA del rating; nada lo guarda.</p>
          <p className="mt-2 text-[13px] text-ink-muted">Libro: {fmt(f.health.seasonEvents)} asientos con temporada · Σ partidas de temporada {fmt(f.health.seasonMatchesSum)}{f.health.seasonEvents === f.health.seasonMatchesSum ? " (coinciden)" : " (NO coinciden)"} · {fmt(f.health.adjustments)} ajustes (semillas/correcciones).</p>
        </Panel>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Distribución por rango">
          <Bars label="Jugadores con partidas por rango (derivado del rating)" data={f.tiers.map((t) => ({ label: `${t.tier} (${t.seasonRanked} clasif.)`, value: t.all }))} />
        </Panel>
        <Panel title="Fronteras de rango">
          <DataTable caption="Fronteras" rows={f.thresholds} rowKey={(r) => r.label} empty="Sin fronteras"
            cols={[
              { key: "l", label: "Escalón", render: (r) => <b style={{ color: r.color }}>{r.label}</b> },
              { key: "f", label: "Desde", align: "right", render: (r) => r.floor },
              { key: "c", label: "Hasta", align: "right", render: (r) => (r.ceil === null ? "—" : r.ceil - 1) },
            ]} />
        </Panel>
      </div>
    </div>
  );
}
