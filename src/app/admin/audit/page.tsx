"use client";

/**
 * F58 · /admin/audit — registro de auditoría. SOLO LECTURA: no existe ninguna ruta que lo edite o borre, y la tabla
 * rechaza UPDATE/DELETE por trigger (0055). Filtros por acción, entidad, actor y fecha; paginado en servidor.
 */
import { useState } from "react";
import { useAdminQuery, useDebounced } from "@/components/admin/cc/api";
import { PageHeader, Panel, Field, Input, Select, Loading, ErrorBox, Pager, Button } from "@/components/admin/cc/ui";
import { ActivityList, ACTION_LABEL, type AuditItem } from "@/components/admin/cc/Activity";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

export default function Audit() {
  useLocale();
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const key = useDebounced(JSON.stringify({ action, entityType, entityId: entityId.trim(), actor: actor.trim(), from, to }), 300);
  const f = JSON.parse(key) as Record<string, string>;
  const qs = new URLSearchParams(Object.entries({ ...f, page: String(page), pageSize: "50", to: f.to ? `${f.to}T23:59:59Z` : "" }).filter(([, v]) => v !== "")).toString();
  const q = useAdminQuery<{ rows: AuditItem[]; total: number; page: number; pageSize: number }>(`/api/admin/audit?${qs}`);
  const reset = () => { setAction(""); setEntityType(""); setEntityId(""); setActor(""); setFrom(""); setTo(""); setPage(1); };
  return (
    <>
      <PageHeader eyebrow={t("Control")} title={t("Auditoría")} description={t("Quién hizo qué, sobre qué, cuándo y por qué. Inmutable: el panel solo lo lee y la base de datos impide editarlo o borrarlo.")} />
      <Panel title={t("Filtros")} dense actions={<Button size="sm" variant="ghost" onClick={reset}>{t("Limpiar")}</Button>}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field label={t("Acción")} htmlFor="au-a"><Select id="au-a" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}><option value="">{t("Todas")}</option>{Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{td(v)}</option>)}</Select></Field>
          <Field label={t("Entidad")} htmlFor="au-t"><Select id="au-t" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}><option value="">{t("Todas")}</option><option value="user">{t("Usuario")}</option><option value="card">{t("Carta")}</option><option value="pool">{t("Pool")}</option><option value="event">{t("Evento")}</option></Select></Field>
          <Field label={t("Id de entidad")} htmlFor="au-i"><Input id="au-i" value={entityId} onChange={(e) => { setEntityId(e.target.value.slice(0, 80)); setPage(1); }} /></Field>
          <Field label={t("Admin (uuid)")} htmlFor="au-ac"><Input id="au-ac" value={actor} onChange={(e) => { setActor(e.target.value.slice(0, 40)); setPage(1); }} /></Field>
          <Field label={t("Desde")} htmlFor="au-f"><Input id="au-f" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></Field>
          <Field label={t("Hasta")} htmlFor="au-to"><Input id="au-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></Field>
        </div>
      </Panel>
      <div className="mt-6">
        <Panel title={t("Registro")} subtitle={q.data ? t("{total} entradas", { total: q.data.total.toLocaleString(getIntlLocale()) }) : undefined}>
          {q.error && <ErrorBox error={td(q.error)} onRetry={q.reload} />}
          {!q.data && !q.error && <Loading rows={8} />}
          {q.data && <><ActivityList items={q.data.rows} empty={t("Ninguna entrada con estos filtros")} /><Pager page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} /></>}
        </Panel>
      </div>
    </>
  );
}
