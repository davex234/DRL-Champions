"use client";

/**
 * F60 · /admin/content — EL CMS DE UN VISTAZO: recuentos REALES de cada tipo de contenido, pendientes (borradores,
 * referencias rotas, arte que falta, retirados) y la matriz de fuentes de verdad (qué se gestiona aquí y qué no, y por qué).
 */
import Link from "next/link";
import { PageHeader, Panel, Stat, Loading, ErrorBox, LevelBadge, Pill } from "@/components/admin/cc/ui";
import { useAdminQuery } from "@/components/admin/cc/api";
import { SOURCE_MATRIX, type DataClass } from "@/domain/cms/sourceMatrix";
import type { ContentSummary } from "@/server/cms/health";
import { ns, td as i18nTd } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

const CLASS_TONE: Record<DataClass, "ok" | "cyan" | "gold" | "bad"> = { CONTENT: "ok", CONFIGURATION: "cyan", GAME_RULE: "gold", SECURITY_RULE: "bad" };

export default function ContentHubPage() {
  useLocale();
  const q = useAdminQuery<{ summary: ContentSummary; checks: { id: string; label: string; level: "HEALTHY" | "WARNING" | "CRITICAL"; detail: string }[]; broken: string[] }>("/api/admin/cms/health");
  const s = q.data?.summary;
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("Contenido")} title={t("Gestión de contenido")} description={t("Todo lo que se añade al juego sin tocar código: agentes, cartas, jugadores, sobres, eventos y assets. Lo que es regla de juego o de seguridad se enseña, no se edita.")} />
      {q.error && <ErrorBox error={i18nTd(q.error)} onRetry={q.reload} />}
      {!s ? <Loading rows={4} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7" data-testid="content-stats">
            <Stat label={t("Agentes")} value={s.agents.published} hint={t("{draft} borradores · {retired} retirados", { draft: s.agents.draft, retired: s.agents.retired })} href="/admin/agents" accent="cyan" />
            <Stat label={t("Cartas")} value={s.cards.published} hint={t("{cms} del panel · {draft} borradores", { cms: s.cards.cms, draft: s.cards.draft })} href="/admin/cards" />
            <Stat label={t("Jugadores")} value={s.players.total} hint={t("{active} activos", { active: s.players.active })} href="/admin/players" />
            <Stat label={t("Equipos")} value={s.teams} hint={t("identidades (código)")} href="/admin/teams" />
            <Stat label={t("Sobres")} value={s.packs.code + s.packs.cmsActive} hint={t("{code} de código · {cms} del panel", { code: s.packs.code, cms: s.packs.cms })} href="/admin/packs" accent="gold" />
            <Stat label={t("Eventos")} value={s.events} href="/admin/events" />
            <Stat label={t("Assets")} value={s.assets.total} hint={t("{orphans} huérfanos", { orphans: s.assets.orphans })} href="/admin/assets" />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t("Borradores pendientes")} value={s.drafts} accent="gold" />
            <Stat label={t("Referencias rotas")} value={s.brokenReferences} accent={s.brokenReferences ? "drl" : "default"} href="/admin/system" />
            <Stat label={t("Arte pendiente")} value={s.missingArtwork} />
            <Stat label={t("Retirados")} value={s.retired} />
          </div>
          <Panel title={t("Salud del contenido")} subtitle={t("Medida contra las tablas reales (no por existir una migración).")}>
            <ul className="space-y-2">{q.data!.checks.map((c) => <li key={c.id} className="flex flex-wrap items-start gap-2 text-[13px]"><LevelBadge level={c.level} /><b className="text-ink-primary">{i18nTd(c.label)}</b><span className="text-ink-muted">{i18nTd(c.detail)}</span></li>)}</ul>
          </Panel>
        </>
      )}
      <Panel title={t("Fuentes de verdad")} subtitle={t("Qué es cada dato, dónde vive, qué lee el juego y qué permite el panel.")}>
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[860px] text-[12px]" data-testid="source-matrix">
            <caption className="sr-only">{t("Matriz de fuentes de verdad")}</caption>
            <thead><tr className="text-left text-[10px] uppercase tracking-wider text-ink-faint">
              <th className="p-2">{t("Entidad")}</th><th className="p-2">{t("Tipo")}</th><th className="p-2">{t("Fuente")}</th><th className="p-2">{t("Juego lee")}</th><th className="p-2">{t("Panel")}</th><th className="p-2">{t("Notas")}</th>
            </tr></thead>
            <tbody>{SOURCE_MATRIX.map((r) => (
              <tr key={r.entity} className="border-t border-white/[0.06] align-top">
                <td className="p-2 font-semibold text-ink-primary">{r.href ? <Link className="hover:underline" href={r.href}>{i18nTd(r.entity)}</Link> : i18nTd(r.entity)}</td>
                <td className="p-2"><Pill tone={CLASS_TONE[r.dataClass]}>{r.dataClass}</Pill></td>
                <td className="p-2 text-ink-secondary">{r.currentSource}</td>
                <td className="p-2 text-ink-muted">{i18nTd(r.runtimeSource)}</td>
                <td className="p-2 whitespace-nowrap">{[r.adminRead && t("leer"), r.adminCreate && t("crear"), r.adminEdit && t("editar"), r.adminRetire && t("retirar")].filter(Boolean).join(" · ") || "—"}</td>
                <td className="p-2 text-ink-faint">{i18nTd(r.notes)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
