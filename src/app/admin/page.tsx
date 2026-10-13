"use client";

/**
 * F58 · /admin — CENTRO OPERATIVO. KPIs de `app_admin_dashboard_stats` (0055), alertas de comprobaciones reales
 * (economía, catálogo, eventos, flags), temporada del calendario y actividad del registro de auditoría. Sin un solo
 * número inventado: si algo no se puede medir, se dice.
 *
 * (El editor de roster local que vivía aquí sigue intacto en /admin/roster.)
 */
import Link from "next/link";
import { useAdminQuery, fmt, dateTime, dateOnly } from "@/components/admin/cc/api";
import { PageHeader, Panel, Stat, LevelBadge, Loading, ErrorBox, Empty, Pill, LinkButton, type Level } from "@/components/admin/cc/ui";
import { ActivityList, type AuditItem } from "@/components/admin/cc/Activity";

interface Dash {
  stats: null | { users: number; admins: number; newUsers7d: number; seen24h: number; seen7d: number; creditsInCirculation: number; cardsOwned: number; packsOpened: number; unopenedPacks: number; activeSanctions: number; ratedPlayers: number; rankedResults: number; catalogCards: number; catalogPublished: number; eventDrafts: number };
  season: null | { id: string; name: string; startsAt: string; endsAt: string; progress: number; daysLeft: number; presentation: string };
  activeEvents: number | null;
  upcomingEvents: { id: string; name: string; startsAt: string | null }[];
  alerts: { level: Level; title: string; detail: string; href: string }[];
  recent: AuditItem[];
  /** F60 · resumen de contenido desde datos reales (null si no se pudo medir). */
  content?: null | { agents: { published: number; draft: number }; cards: { published: number; cms: number; draft: number }; players: { total: number }; teams: number;
    packs: { code: number; cms: number; cmsActive: number }; events: number; assets: { total: number; orphans: number }; drafts: number; brokenReferences: number; missingArtwork: number; retired: number };
}

export default function AdminDashboard() {
  const q = useAdminQuery<Dash>("/api/admin/dashboard");
  const d = q.data, s = d?.stats;
  const actionable = (d?.alerts ?? []).filter((a) => a.level !== "HEALTHY");
  const info = (d?.alerts ?? []).filter((a) => a.level === "HEALTHY");
  return (
    <>
      <PageHeader eyebrow="NEXUS · DRLCards" title="Centro operativo"
        description="Estado real del producto: cada cifra sale de la base de datos o del catálogo; las alertas, de comprobaciones automáticas."
        actions={<><LinkButton href="/admin/cards/new" variant="primary">+ Carta</LinkButton><LinkButton href="/admin/agents/new" variant="cyan">+ Agente</LinkButton><LinkButton href="/admin/packs/new" variant="cyan">+ Sobre</LinkButton><LinkButton href="/admin/events/new" variant="cyan">+ Evento</LinkButton></>} />
      {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
      {!d && !q.error && <Loading rows={6} />}
      {d && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Usuarios" value={fmt(s?.users)} hint={s ? `+${fmt(s.newUsers7d)} en 7 días · ${fmt(s.admins)} admin` : "Sin datos"} accent="cyan" href="/admin/users" />
            <Stat label="Activos 7 días" value={fmt(s?.seen7d)} hint={s ? `${fmt(s.seen24h)} en 24 h (last_seen_at)` : "—"} accent="ok" />
            <Stat label="Catálogo" value={fmt(s?.catalogCards)} hint={s ? `${fmt(s.catalogPublished)} publicadas` : "—"} accent="drl" href="/admin/cards" />
            <Stat label="Cartas en circulación" value={fmt(s?.cardsOwned)} hint="Ejemplares en colecciones" accent="gold" />
            <Stat label="Sobres abiertos" value={fmt(s?.packsOpened)} hint={s ? `${fmt(s.unopenedPacks)} sin abrir` : "—"} accent="gold" href="/admin/packs" />
            <Stat label="Créditos en circulación" value={fmt(s?.creditsInCirculation)} hint="Suma de saldos" accent="default" href="/admin/economy" />
            <Stat label="Sancionados" value={fmt(s?.activeSanctions)} hint="Sanciones activas" accent={s && s.activeSanctions > 0 ? "warn" : "default"} href="/admin/moderation" />
            <Stat label="Competitivo" value={fmt(s?.ratedPlayers)} hint={s ? `${fmt(s.rankedResults)} resultados puntuados` : "—"} accent="cyan" href="/admin/competitive" />
            <Stat label="Eventos activos" value={fmt(d.activeEvents)} hint={s ? `${fmt(s.eventDrafts)} borradores` : "—"} accent="drl" href="/admin/events" />
            <Stat label="Temporada" value={d.season ? d.season.name : "—"} hint={d.season ? `${Math.round(d.season.progress * 100)} % · quedan ${d.season.daysLeft} días` : "Fuera de temporada"} accent="ok" href="/admin/seasons" />
          </div>

          {d.content && (
            <Panel title="Contenido" subtitle="Recuentos reales del CMS (F60)" actions={<LinkButton href="/admin/content">Ver todo</LinkButton>}>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8" data-testid="dashboard-content">
                <Stat label="Agentes" value={fmt(d.content.agents.published)} hint={`${d.content.agents.draft} borradores`} href="/admin/agents" accent="cyan" />
                <Stat label="Cartas" value={fmt(d.content.cards.published)} hint={`${d.content.cards.cms} del panel`} href="/admin/cards" />
                <Stat label="Jugadores" value={fmt(d.content.players.total)} href="/admin/players" />
                <Stat label="Equipos" value={fmt(d.content.teams)} href="/admin/teams" />
                <Stat label="Sobres" value={fmt(d.content.packs.code + d.content.packs.cmsActive)} hint={`${d.content.packs.cms} del panel`} href="/admin/packs" accent="gold" />
                <Stat label="Eventos" value={fmt(d.content.events)} href="/admin/events" />
                <Stat label="Assets" value={fmt(d.content.assets.total)} hint={`${d.content.assets.orphans} huérfanos`} href="/admin/assets" />
                <Stat label="Referencias rotas" value={fmt(d.content.brokenReferences)} hint={`${d.content.drafts} borradores · ${d.content.missingArtwork} sin arte · ${d.content.retired} retirados`} accent={d.content.brokenReferences ? "drl" : "ok"} href="/admin/content" />
              </div>
            </Panel>
          )}

          <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
            <Panel title="Alertas" subtitle="Comprobaciones reales: economía, catálogo, flags y KPIs" tone={actionable.some((a) => a.level === "CRITICAL") ? "danger" : undefined}>
              {actionable.length === 0 ? (
                <div className="flex items-center gap-3 rounded-card border border-ok/25 bg-ok/[0.06] px-4 py-3 text-[14px] text-ink-secondary"><LevelBadge level="HEALTHY" label="Sin alertas" />Ninguna comprobación está en aviso ni en crítico.</div>
              ) : (
                <ul className="space-y-2">
                  {actionable.map((a, i) => (
                    <li key={i}><Link href={a.href} className="nx-focus flex items-start gap-3 rounded-card border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 hover:border-white/15"><LevelBadge level={a.level} /><span><span className="block text-[14px] text-ink-primary">{a.title}</span><span className="text-[12px] text-ink-muted">{a.detail}</span></span></Link></li>
                  ))}
                </ul>
              )}
              {info.length > 0 && (
                <ul className="mt-4 space-y-1.5 border-t border-white/[0.06] pt-3">
                  {info.map((a, i) => <li key={i}><Link href={a.href} className="nx-focus flex items-center gap-2 text-[13px] text-ink-muted hover:text-ink-primary"><Pill tone="cyan">{a.title}</Pill>{a.detail}</Link></li>)}
                </ul>
              )}
            </Panel>
            <Panel title="Temporada y eventos">
              {d.season ? (
                <div>
                  <div className="flex items-baseline justify-between"><p className="font-display text-xl font-bold uppercase text-ink-primary">{d.season.name}</p><Pill tone="ok">{d.season.presentation}</Pill></div>
                  <p className="mt-1 text-[12px] text-ink-faint">{dateOnly(d.season.startsAt)} → {dateOnly(d.season.endsAt)}</p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuenow={Math.round(d.season.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progreso de la temporada"><div className="h-full rounded-full bg-gradient-to-r from-drl to-drl-cyan" style={{ width: `${d.season.progress * 100}%` }} /></div>
                </div>
              ) : <Empty title="Fuera de temporada" />}
              <p className="mb-2 mt-5 font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Eventos que empiezan en 7 días</p>
              {d.upcomingEvents.length === 0 ? <p className="text-[13px] text-ink-faint">Ninguno.</p> : (
                <ul className="space-y-1.5">{d.upcomingEvents.map((e) => <li key={e.id}><Link className="nx-focus text-[13px] text-ink-secondary hover:text-ink-primary" href={`/admin/events/${encodeURIComponent(e.id)}`}>{e.name} <span className="text-ink-faint">· {dateTime(e.startsAt)}</span></Link></li>)}</ul>
              )}
            </Panel>
          </div>

          <Panel title="Actividad administrativa reciente" subtitle="Del registro de auditoría (append-only)" actions={<LinkButton href="/admin/audit">Ver todo</LinkButton>}>
            <ActivityList items={d.recent} empty="Aún no hay acciones registradas." />
          </Panel>
        </div>
      )}
    </>
  );
}
