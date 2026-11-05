"use client";

/** F58 · lista de actividad del registro de auditoría (dashboard, fichas de usuario/evento, /admin/audit). */
import Link from "next/link";
import { useState } from "react";
import { dateTime } from "./api";
import { Empty, Pill } from "./ui";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("admin");

export interface AuditItem { id: number; at: string; actor: string | null; actorName: string | null; action: string; entityType: string | null; entityId: string | null; detail: Record<string, unknown> }

export const ACTION_LABEL: Record<string, string> = {
  create_card: "Carta creada", update_draft: "Borrador de carta editado", publish_version: "Versión publicada", set_lifecycle: "Estado de carta cambiado",
  pool_create: "Pool creado", pool_update: "Pool editado", pool_set_entries: "Entradas de pool", pool_bind: "Pool vinculado", pool_unbind: "Pool desvinculado",
  user_sanction: "Sanción emitida", user_sanction_revoke: "Sanción revocada", user_credits_adjust: "Créditos ajustados",
  user_grant_pack: "Sobre concedido", user_grant_card: "Carta concedida",
  event_create_draft: "Borrador de evento", event_update_draft: "Evento editado", event_cancel_draft: "Evento cancelado", event_publish: "Evento publicado",
};
const TONE: Record<string, "bad" | "gold" | "cyan" | "ok" | "default"> = { user_sanction: "bad", user_sanction_revoke: "ok", user_credits_adjust: "gold", user_grant_pack: "gold", user_grant_card: "gold", event_publish: "cyan", publish_version: "cyan" };

export function entityHref(t: string | null, id: string | null): string | null {
  if (!t || !id) return null;
  if (t === "user") return `/admin/users/${id}`;
  if (t === "card") return `/admin/cartas/${encodeURIComponent(id)}`;
  if (t === "pool") return `/admin/pools/${encodeURIComponent(id)}`;
  if (t === "event") return `/admin/events/${encodeURIComponent(id)}`;
  return null;
}

export function ActivityList({ items, empty }: { items: AuditItem[]; empty: string }) {
  useLocale();
  const [open, setOpen] = useState<number | null>(null);
  if (!items.length) return <Empty title={td(empty)} />;
  return (
    <ol className="relative space-y-1 border-l border-white/[0.08] pl-4">
      {items.map((a) => {
        const href = entityHref(a.entityType, a.entityId);
        const reason = typeof a.detail?.reason === "string" ? a.detail.reason : null;
        return (
          <li key={a.id} className="relative">
            <span aria-hidden className="absolute -left-[21px] top-3 h-2 w-2 rounded-full bg-drl-cyan/70" />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control px-2 py-1.5 hover:bg-white/[0.025]">
              <Pill tone={TONE[a.action] ?? "default"}>{td(ACTION_LABEL[a.action]) ?? td(a.action)}</Pill>
              {href ? <Link href={href} className="nx-focus text-[13px] text-ink-primary underline-offset-2 hover:underline">{a.entityId}</Link> : <span className="text-[13px] text-ink-secondary">{a.entityId ?? "—"}</span>}
              <span className="text-[12px] text-ink-faint">{tr("por {autor} · {fecha}", { autor: td(a.actorName) ?? (a.actor ? a.actor.slice(0, 8) : tr("sistema")), fecha: dateTime(a.at) })}</span>
              {reason && <span className="w-full truncate text-[12px] text-ink-muted">«{td(reason)}»</span>}
              <button type="button" onClick={() => setOpen(open === a.id ? null : a.id)} className="nx-focus ml-auto text-[11px] text-ink-faint hover:text-ink-secondary" aria-expanded={open === a.id}>{open === a.id ? tr("Ocultar detalle") : tr("Detalle")}</button>
            </div>
            {open === a.id && <pre className="mb-2 ml-2 max-h-64 overflow-auto rounded-control bg-black/40 p-3 text-[11px] leading-relaxed text-ink-muted">{JSON.stringify(a.detail, null, 2)}</pre>}
          </li>
        );
      })}
    </ol>
  );
}
