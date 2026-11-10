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
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

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
  useLocale();
  const q = useAdminQuery<Dash>("/api/admin/dashboard");
  const d = q.data, s = d?.stats;
  const actionable = (d?.alerts ?? []).filter((a) => a.level !== "HEALTHY");
  const info = (d?.alerts ?? []).filter((a) => a.level === "HEALTHY");
  return (
    <>
      <PageHeader eyebrow={t("NEXUS · DRLCards")} title={t("Centro operativo")}
        description={t("Estado real del producto: cada cifra sale de la base de datos o del catálogo; las alertas, de comprobaciones automáticas.")}
        actions={<><LinkButton href="/admin/cards/new" variant="primary">{t("+ Carta")}</LinkButton><LinkButton href="/admin/agents/new" variant="cyan">{t("+ Agente")}</LinkButton><LinkButton href="/admin/packs/new" variant="cyan">{t("+ Sobre")}</LinkButton><LinkButton href="/admin/events/new" variant="cyan">{t("+ Evento")}</LinkButton></>} />
      {q.error && <ErrorBox error={td(q.error)} onRetry={q.reload} />}
      {!d && !q.error && <Loading rows={6} />}
      {d && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label={t("Usuarios")} value={fmt(s?.users)} hint={s ? t("+{newUsers7d} en 7 días · {admins} admin", { newUsers7d: fmt(s.newUsers7d), admins: fmt(s.admins) }) : t("Sin datos")} accent="cyan" href="/admin/users" />
            <Stat label={t("Activos 7 días")} value={fmt(s?.seen7d)} hint={s ? t("{seen24h} en 24 h (last_seen_at)", { seen24h: fmt(s.seen24h) }) : "—"} accent="ok" />
            <Stat label={t("Catálogo")} value={fmt(s?.catalogCards)} hint={s ? t("{catalogPublished} publicadas", { catalogPublished: fmt(s.catalogPublished) }) : "—"} accent="drl" href="/admin/cards" />
            <Stat label={t("Cartas en circulación")} value={fmt(s?.cardsOwned)} hint={t("Ejemplares en colecciones")} accent="gold" />
            <Stat label={t("Sobres abiertos")} value={fmt(s?.packsOpened)} hint={s ? t("{unopenedPacks} sin abrir", { unopenedPacks: fmt(s.unopenedPacks) }) : "—"} accent="gold" href="/admin/packs" />
            <Stat label={t("Créditos en circulación")} value={fmt(s?.creditsInCirculation)} hint={t("Suma de saldos")} accent="default" href="/admin/economy" />
            <Stat label={t("Sancionados")} value={fmt(s?.activeSanctions)} hint={t("Sanciones activas")} accent={s && s.activeSanctions > 0 ? "warn" : "default"} href="/admin/moderation" />
            <Stat label={t("Competitivo")} value={fmt(s?.ratedPlayers)} hint={s ? t("{rankedResults} resultados puntuados", { rankedResults: fmt(s.rankedResults) }) : "—"} accent="cyan" href="/admin/competitive" />
            <Stat label={t("Eventos activos")} value={fmt(d.activeEvents)} hint={s ? t("{eventDrafts} borradores", { eventDrafts: fmt(s.eventDrafts) }) : "—"} accent="drl" href="/admin/events" />
            <Stat label={t("Temporada")} value={d.season ? td(d.season.name) : "—"} hint={d.season ? t("{Math} % · quedan {daysLeft} días", { Math: Math.round(d.season.progress * 100), daysLeft: d.season.daysLeft }) : t("Fuera de temporada")} accent="ok" href="/admin/seasons" />
          </div>

          {d.content && (
            <Panel title={t("Contenido")} subtitle={t("Recuentos reales del CMS (F60)")} actions={<LinkButton href="/admin/content">{t("Ver todo")}</LinkButton>}>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8" data-testid="dashboard-content">
                <Stat label={t("Agentes")} value={fmt(d.content.agents.published)} hint={t("{draft} borradores", { draft: d.content.agents.draft })} href="/admin/agents" accent="cyan" />
                <Stat label={t("Cartas")} value={fmt(d.content.cards.published)} hint={t("{cms} del panel", { cms: d.content.cards.cms })} href="/admin/cards" />
                <Stat label={t("Jugadores")} value={fmt(d.content.players.total)} href="/admin/players" />
                <Stat label={t("Equipos")} value={fmt(d.content.teams)} href="/admin/teams" />
                <Stat label={t("Sobres")} value={fmt(d.content.packs.code + d.content.packs.cmsActive)} hint={t("{cms} del panel", { cms: d.content.packs.cms })} href="/admin/packs" accent="gold" />
                <Stat label={t("Eventos")} value={fmt(d.content.events)} href="/admin/events" />
                <Stat label={t("Assets")} value={fmt(d.content.assets.total)} hint={t("{orphans} huérfanos", { orphans: d.content.assets.orphans })} href="/admin/assets" />
                <Stat label={t("Referencias rotas")} value={fmt(d.content.brokenReferences)} hint={t("{drafts} borradores · {missingArtwork} sin arte · {retired} retirados", { drafts: d.content.drafts, missingArtwork: d.content.missingArtwork, retired: d.content.retired })} accent={d.content.brokenReferences ? "drl" : "ok"} href="/admin/content" />
              </div>
            </Panel>
          )}

          <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
            <Panel title={t("Alertas")} subtitle={t("Comprobaciones reales: economía, catálogo, flags y KPIs")} tone={actionable.some((a) => a.level === "CRITICAL") ? "danger" : undefined}>
              {actionable.length === 0 ? (
                <div className="flex items-center gap-3 rounded-card border border-ok/25 bg-ok/[0.06] px-4 py-3 text-[14px] text-ink-secondary"><LevelBadge level="HEALTHY" label={t("Sin alertas")} />{t("Ninguna comprobación está en aviso ni en crítico.")}</div>
              ) : (
                <ul className="space-y-2">
                  {actionable.map((a, i) => (
                    <li key={i}><Link href={a.href} className="nx-focus flex items-start gap-3 rounded-card border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 hover:border-white/15"><LevelBadge level={a.level} /><span><span className="block text-[14px] text-ink-primary">{td(a.title)}</span><span className="text-[12px] text-ink-muted">{td(a.detail)}</span></span></Link></li>
                  ))}
                </ul>
              )}
              {info.length > 0 && (
                <ul className="mt-4 space-y-1.5 border-t border-white/[0.06] pt-3">
                  {info.map((a, i) => <li key={i}><Link href={a.href} className="nx-focus flex items-center gap-2 text-[13px] text-ink-muted hover:text-ink-primary"><Pill tone="cyan">{td(a.title)}</Pill>{td(a.detail)}</Link></li>)}
                </ul>
              )}
            </Panel>
            <Panel title={t("Temporada y eventos")}>
              {d.season ? (
                <div>
                  <div className="flex items-baseline justify-between"><p className="font-display text-xl font-bold uppercase text-ink-primary">{td(d.season.name)}</p><Pill tone="ok">{td(d.season.presentation)}</Pill></div>
                  <p className="mt-1 text-[12px] text-ink-faint">{dateOnly(d.season.startsAt)} → {dateOnly(d.season.endsAt)}</p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuenow={Math.round(d.season.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={t("Progreso de la temporada")}><div className="h-full rounded-full bg-gradient-to-r from-drl to-drl-cyan" style={{ width: `${d.season.progress * 100}%` }} /></div>
                </div>
              ) : <Empty title={t("Fuera de temporada")} />}
              <p className="mb-2 mt-5 font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">{t("Eventos que empiezan en 7 días")}</p>
              {d.upcomingEvents.length === 0 ? <p className="text-[13px] text-ink-faint">{t("Ninguno.")}</p> : (
                <ul className="space-y-1.5">{d.upcomingEvents.map((e) => <li key={e.id}><Link className="nx-focus text-[13px] text-ink-secondary hover:text-ink-primary" href={`/admin/events/${encodeURIComponent(e.id)}`}>{e.name} <span className="text-ink-faint">· {dateTime(e.startsAt)}</span></Link></li>)}</ul>
              )}
            </Panel>
          </div>

          <Panel title={t("Actividad administrativa reciente")} subtitle={t("Del registro de auditoría (append-only)")} actions={<LinkButton href="/admin/audit">{t("Ver todo")}</LinkButton>}>
            <ActivityList items={d.recent} empty={t("Aún no hay acciones registradas.")} />
          </Panel>
        </div>
      )}
    </>
  );
}
