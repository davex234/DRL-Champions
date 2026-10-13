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

const CLASS_TONE: Record<DataClass, "ok" | "cyan" | "gold" | "bad"> = { CONTENT: "ok", CONFIGURATION: "cyan", GAME_RULE: "gold", SECURITY_RULE: "bad" };

export default function ContentHubPage() {
  const q = useAdminQuery<{ summary: ContentSummary; checks: { id: string; label: string; level: "HEALTHY" | "WARNING" | "CRITICAL"; detail: string }[]; broken: string[] }>("/api/admin/cms/health");
  const s = q.data?.summary;
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Contenido" title="Gestión de contenido" description="Todo lo que se añade al juego sin tocar código: agentes, cartas, jugadores, sobres, eventos y assets. Lo que es regla de juego o de seguridad se enseña, no se edita." />
      {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
      {!s ? <Loading rows={4} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7" data-testid="content-stats">
            <Stat label="Agentes" value={s.agents.published} hint={`${s.agents.draft} borradores · ${s.agents.retired} retirados`} href="/admin/agents" accent="cyan" />
            <Stat label="Cartas" value={s.cards.published} hint={`${s.cards.cms} del panel · ${s.cards.draft} borradores`} href="/admin/cards" />
            <Stat label="Jugadores" value={s.players.total} hint={`${s.players.active} activos`} href="/admin/players" />
            <Stat label="Equipos" value={s.teams} hint="identidades (código)" href="/admin/teams" />
            <Stat label="Sobres" value={s.packs.code + s.packs.cmsActive} hint={`${s.packs.code} de código · ${s.packs.cms} del panel`} href="/admin/packs" accent="gold" />
            <Stat label="Eventos" value={s.events} href="/admin/events" />
            <Stat label="Assets" value={s.assets.total} hint={`${s.assets.orphans} huérfanos`} href="/admin/assets" />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Borradores pendientes" value={s.drafts} accent="gold" />
            <Stat label="Referencias rotas" value={s.brokenReferences} accent={s.brokenReferences ? "drl" : "default"} href="/admin/system" />
            <Stat label="Arte pendiente" value={s.missingArtwork} />
            <Stat label="Retirados" value={s.retired} />
          </div>
          <Panel title="Salud del contenido" subtitle="Medida contra las tablas reales (no por existir una migración).">
            <ul className="space-y-2">{q.data!.checks.map((c) => <li key={c.id} className="flex flex-wrap items-start gap-2 text-[13px]"><LevelBadge level={c.level} /><b className="text-ink-primary">{c.label}</b><span className="text-ink-muted">{c.detail}</span></li>)}</ul>
          </Panel>
        </>
      )}
      <Panel title="Fuentes de verdad" subtitle="Qué es cada dato, dónde vive, qué lee el juego y qué permite el panel.">
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[860px] text-[12px]" data-testid="source-matrix">
            <caption className="sr-only">Matriz de fuentes de verdad</caption>
            <thead><tr className="text-left text-[10px] uppercase tracking-wider text-ink-faint">
              <th className="p-2">Entidad</th><th className="p-2">Tipo</th><th className="p-2">Fuente</th><th className="p-2">Juego lee</th><th className="p-2">Panel</th><th className="p-2">Notas</th>
            </tr></thead>
            <tbody>{SOURCE_MATRIX.map((r) => (
              <tr key={r.entity} className="border-t border-white/[0.06] align-top">
                <td className="p-2 font-semibold text-ink-primary">{r.href ? <Link className="hover:underline" href={r.href}>{r.entity}</Link> : r.entity}</td>
                <td className="p-2"><Pill tone={CLASS_TONE[r.dataClass]}>{r.dataClass}</Pill></td>
                <td className="p-2 text-ink-secondary">{r.currentSource}</td>
                <td className="p-2 text-ink-muted">{r.runtimeSource}</td>
                <td className="p-2 whitespace-nowrap">{[r.adminRead && "leer", r.adminCreate && "crear", r.adminEdit && "editar", r.adminRetire && "retirar"].filter(Boolean).join(" · ") || "—"}</td>
                <td className="p-2 text-ink-faint">{r.notes}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
