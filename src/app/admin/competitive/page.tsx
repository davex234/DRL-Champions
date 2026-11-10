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
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("admin");

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
  useLocale();
  const router = useRouter();
  const q = useAdminQuery<V>("/api/admin/catalog?view=competitive");
  const d = q.data;
  return (
    <>
      <PageHeader eyebrow={tr("Juego")} title={tr("Competitivo")} description={tr("Rating Elo de PvP, distribución, partidas puntuadas y anomalías detectadas en los datos. Sin acciones: el dominio no define ninguna acción administrativa segura sobre resultados.")} />
      {q.error && <ErrorBox error={td(q.error)} onRetry={q.reload} />}
      {!d && !q.error && <Loading />}
      {d && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={tr("Con rating")} value={fmt(d.players)} accent="cyan" />
            <Stat label={tr("Clasificados")} value={fmt(d.rated)} hint={tr("con partidas")} accent="ok" />
            <Stat label={tr("Partidas puntuadas")} value={fmt(d.games)} accent="gold" />
            <Stat label={tr("Anomalías")} value={fmt(d.anomalies.length)} accent={d.anomalies.length ? "warn" : "default"} />
          </div>
          {d.f84 && <RankedF84 f={d.f84} />}
          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title={tr("Distribución de rating")}>{d.distribution.length ? <Bars label={tr("Jugadores por tramo de rating")} data={d.distribution.map((b) => ({ label: `${b.from}–${b.to}`, value: b.count }))} /> : <Empty title={tr("Sin partidas puntuadas")} />}</Panel>
            <Panel title={tr("Anomalías")}>{d.anomalies.length ? <ul className="space-y-1.5">{d.anomalies.map((a, i) => <li key={i} className="flex gap-2 text-[13px]"><LevelBadge level="WARNING" label={td(a.kind)} />{td(a.detail)}</li>)}</ul> : <div className="flex items-center gap-2 text-[13px] text-ink-muted"><LevelBadge level="HEALTHY" label={tr("Ninguna")} />{tr("Contadores, deltas y saltos coherentes.")}</div>}</Panel>
          </div>
          <Panel title={tr("Escalera (top 20)")}>
            <DataTable caption={tr("Escalera")} rows={d.top} rowKey={(r) => r.userId} onRowClick={(r) => router.push(`/admin/users/${r.userId}`)} empty={tr("Sin jugadores")}
              cols={[
                { key: "u", label: tr("Jugador"), render: (r) => <b className="text-ink-primary">{r.username ?? r.userId.slice(0, 8)}</b> },
                { key: "r", label: tr("Rating"), align: "right", render: (r) => r.rating, sort: (r) => r.rating },
                { key: "g", label: tr("Partidas"), align: "right", render: (r) => r.games },
                { key: "w", label: tr("V / D / E"), align: "right", render: (r) => `${r.wins} / ${r.losses} / ${r.draws}` },
              ]} />
          </Panel>
          <Panel title={tr("Resultados recientes")}>
            <DataTable caption={tr("Resultados recientes")} rows={d.recent} rowKey={(r) => `${r.matchId}:${r.userId}`} empty={tr("Sin resultados")}
              cols={[
                { key: "t", label: tr("Fecha"), render: (r) => dateTime(r.at) },
                { key: "u", label: tr("Jugador"), render: (r) => r.username ?? r.userId.slice(0, 8) },
                { key: "res", label: tr("Resultado"), render: (r) => r.result },
                { key: "d", label: tr("Rating"), align: "right", render: (r) => <span>{r.oldRating} → <b className="text-ink-primary">{r.newRating}</b> <span className={r.delta >= 0 ? "text-ok" : "text-bad"}>({r.delta >= 0 ? "+" : ""}{r.delta})</span></span> },
                { key: "m", label: tr("Partida"), render: (r) => <code className="text-[11px] text-ink-faint">{r.matchId.slice(0, 12)}</code> },
              ]} />
          </Panel>
        </div>
      )}
    </>
  );
}

/** F84 · temporada competitiva, fronteras, fórmula, distribución por rango y salud de la clasificación. */
function RankedF84({ f }: { f: F84 }) {
  useLocale();
  const s = f.season;
  return (
    <div className="space-y-6" data-testid="admin-ranked-f84">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={tr("En la temporada")} value={fmt(f.health.seasonPlayers)} hint={tr("con partidas")} accent="cyan" />
        <Stat label={tr("Colocación completa")} value={fmt(f.health.placementDone)} accent="ok" />
        <Stat label={tr("En el Top")} value={fmt(f.health.eligible)} hint={s ? tr("máx. {size}", { size: s.top.size }) : undefined} accent="gold" />
        <Stat label={tr("Tope de pareja")} value={fmt(f.health.pairCapped)} hint={tr("asientos sin intercambio")} accent={f.health.pairCapped ? "warn" : "default"} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title={tr("Temporada competitiva")}>
          {s ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-ink-muted">{tr("Temporada")}</dt><dd className="text-ink-primary">{td(s.name)} ({s.id})</dd>
              <dt className="text-ink-muted">{tr("Desde")}</dt><dd>{dateTime(new Date(s.startsAt).toISOString())}</dd>
              <dt className="text-ink-muted">{tr("Hasta")}</dt><dd>{s.endsAt ? dateTime(new Date(s.endsAt).toISOString()) : tr("Abierta (hasta programar la siguiente)")}</dd>
              <dt className="text-ink-muted">{tr("Temporada F83 enlazada")}</dt><dd>{s.gameSeasonId ?? tr("Ninguna (XP de temporada ≠ rating)")}</dd>
              <dt className="text-ink-muted">{tr("Colocación")}</dt><dd>{tr("{n} partidas", { n: s.placementGames })}</dd>
              <dt className="text-ink-muted">{tr("Entrar en el Top")}</dt><dd>{tr("colocación + ≥ {partidas} partidas + actividad en {dias} días", { partidas: s.top.minSeasonMatches, dias: s.top.activeDays })}</dd>
              <dt className="text-ink-muted">{tr("Tope de pareja")}</dt><dd>{tr("{partidas} partidas puntuadas / {horas} h", { partidas: s.pairCap.matches, horas: s.pairCap.hours })}</dd>
              <dt className="text-ink-muted">{tr("Fronteras")}</dt><dd>{s.rankConfigVersion}{f.configIssues.length ? tr(" · {length} problemas", { length: f.configIssues.length }) : (" " + tr("· válidas"))}</dd>
            </dl>
          ) : <Empty title={tr("Sin temporada competitiva activa")} />}
        </Panel>
        <Panel title={tr("Fórmula · {version}", { version: td(f.formula.version) })}>
          <p className="text-[13px] text-ink-muted">{tr("Elo de 0033–0035, sin cambios: inicial {inicial}, K {kprov} con menos de {partidas} partidas y {kest} después, suelo {suelo}, techo {techo}. El rango se DERIVA del rating; nada lo guarda.", { inicial: f.formula.initial, kprov: f.formula.kProvisional, partidas: f.formula.provisionalGames, kest: f.formula.kEstablished, suelo: f.formula.floor, techo: f.formula.ceiling })}</p>
          <p className="mt-2 text-[13px] text-ink-muted">{f.health.seasonEvents === f.health.seasonMatchesSum
            ? tr("Libro: {asientos} asientos con temporada · Σ partidas de temporada {suma} (coinciden) · {ajustes} ajustes (semillas/correcciones).", { asientos: fmt(f.health.seasonEvents), suma: fmt(f.health.seasonMatchesSum), ajustes: fmt(f.health.adjustments) })
            : tr("Libro: {asientos} asientos con temporada · Σ partidas de temporada {suma} (NO coinciden) · {ajustes} ajustes (semillas/correcciones).", { asientos: fmt(f.health.seasonEvents), suma: fmt(f.health.seasonMatchesSum), ajustes: fmt(f.health.adjustments) })}</p>
        </Panel>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title={tr("Distribución por rango")}>
          <Bars label={tr("Jugadores con partidas por rango (derivado del rating)")} data={f.tiers.map((t) => ({ label: tr("{rango} ({n} clasif.)", { rango: td(t.tier), n: t.seasonRanked }), value: t.all }))} />
        </Panel>
        <Panel title={tr("Fronteras de rango")}>
          <DataTable caption={tr("Fronteras")} rows={f.thresholds} rowKey={(r) => r.label} empty={tr("Sin fronteras")}
            cols={[
              { key: "l", label: tr("Escalón"), render: (r) => <b style={{ color: r.color }}>{td(r.label)}</b> },
              { key: "f", label: tr("Desde"), align: "right", render: (r) => r.floor },
              { key: "c", label: tr("Hasta"), align: "right", render: (r) => (r.ceil === null ? "—" : r.ceil - 1) },
            ]} />
        </Panel>
      </div>
    </div>
  );
}
