"use client";

/**
 * F58 · /admin/events — borradores del panel + eventos canónicos del juego (`public.events`, incluidos los de la
 * sincronización VLR). El estado (Borrador · Programado · Activo · Terminado) se calcula por fechas con `eventPhase`.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminQuery, dateTime } from "@/components/admin/cc/api";
import { PageHeader, Panel, Tabs, DataTable, Loading, ErrorBox, Pill, LinkButton } from "@/components/admin/cc/ui";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

type State = "DRAFT" | "SCHEDULED" | "ACTIVE" | "ENDED" | "CANCELLED";
interface Item { key: string; source: "draft" | "canonical"; id: string; name: string; type: string | null; region: string | null; startsAt: string | null; endsAt: string | null; state: State; origin: string; eventId: string | null }
const STATE: Record<State, { label: string; tone: "default" | "cyan" | "ok" | "gold" | "bad" }> = {
  DRAFT: { label: "Borrador", tone: "gold" }, SCHEDULED: { label: "Programado", tone: "cyan" }, ACTIVE: { label: "Activo", tone: "ok" }, ENDED: { label: "Terminado", tone: "default" }, CANCELLED: { label: "Cancelado", tone: "bad" },
};

export default function Events() {
  useLocale();
  const router = useRouter();
  const q = useAdminQuery<{ items: Item[] }>("/api/admin/events");
  const [tab, setTab] = useState<"ALL" | State>("ALL");
  const items = (q.data?.items ?? []).filter((i) => tab === "ALL" || i.state === tab);
  const count = (s: State) => (q.data?.items ?? []).filter((i) => i.state === s).length;
  return (
    <>
      <PageHeader eyebrow={t("Contenido")} title={t("Eventos")}
        description={<>{t("Un evento nuevo nace SIEMPRE como borrador (no lo ve ningún jugador). Al publicarlo se crea el evento canónico que consume el juego, con los desafíos y recompensas que le correspondan por tipo y región.")}</>}
        actions={<LinkButton href="/admin/events/new" variant="primary">{t("+ Nuevo evento")}</LinkButton>} />
      <Panel actions={<Tabs label={t("Estado")} value={tab} onChange={setTab} items={[{ id: "ALL", label: t("Todos"), count: q.data?.items.length }, ...(["DRAFT", "SCHEDULED", "ACTIVE", "ENDED"] as State[]).map((s) => ({ id: s, label: STATE[s].label, count: count(s) }))]} />}>
        {q.error && <ErrorBox error={td(q.error)} onRetry={q.reload} />}
        {!q.data && !q.error && <Loading />}
        {q.data && (
          <DataTable caption={t("Eventos")} rows={items} rowKey={(r) => r.key} onRowClick={(r) => router.push(`/admin/events/${encodeURIComponent(r.id)}`)} empty={t("Ningún evento en este estado")}
            initialSort={{ key: "s", dir: "desc" }}
            cols={[
              { key: "st", label: t("Estado"), render: (r) => <Pill tone={STATE[r.state].tone}>{td(STATE[r.state].label)}</Pill> },
              { key: "n", label: t("Evento"), render: (r) => <span className="font-semibold text-ink-primary">{r.name}</span>, sort: (r) => r.name.toLowerCase() },
              { key: "t", label: t("Tipo"), render: (r) => <span className="text-ink-muted">{td(r.type) ?? "—"}{r.region ? ` · ${r.region}` : ""}</span> },
              { key: "s", label: t("Inicio"), render: (r) => dateTime(r.startsAt), sort: (r) => r.startsAt ?? "" },
              { key: "e", label: t("Fin"), render: (r) => dateTime(r.endsAt), sort: (r) => r.endsAt ?? "" },
              { key: "o", label: t("Origen"), render: (r) => <span className="text-ink-faint">{td(r.origin)}</span> },
            ]} />
        )}
      </Panel>
    </>
  );
}
