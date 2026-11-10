"use client";

/**
 * Colecciones por equipo · ALTA DE EQUIPOS NUEVOS desde `/admin/teams` (0076).
 *
 * Solo para equipos IMPRESOS que el registro de código no conoce (una carta publicada desde el CMS con un equipo
 * nuevo). Hasta que tienen clave, nombre, etiqueta y región, sus cartas no forman colección para el jugador. La clave
 * no se puede cambiar después: es la de su primera compleción guardada. El servidor vuelve a validarlo todo.
 */
import { useId, useState } from "react";
import { adminPost, useAdminQuery, fmt } from "@/components/admin/cc/api";
import { Button, ErrorBox, Field, Input, Loading, Panel, Pill, Select } from "@/components/admin/cc/ui";
import { AssetUploader } from "./cms";
import { BADGE_REGIONS } from "@/domain/teamCollections/model";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

interface Managed { printedTeam: string; teamId: string; name: string; tag: string; region: string; rev: number; cards: number; logo: string | null; logoAssetId: string | null }
interface View { available: boolean; managed: Managed[]; pending: { printedTeam: string; cards: number }[] }

/** Clave sugerida a partir del texto impreso: minúsculas, números y guiones. El admin la puede cambiar antes de crear. */
export const suggestTeamId = (printed: string): string =>
  printed.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^raw/, "t-raw").slice(0, 32) || "equipo";
const suggestTag = (printed: string): string => printed.replace(/[^A-Za-z0-9.]/g, "").slice(0, 6).toUpperCase() || "TEAM";

function IdentityForm({ printedTeam, initial, onSaved }: { printedTeam: string; initial: Managed | null; onSaved: () => void }) {
  useLocale();
  const uid = useId();
  const [teamId, setTeamId] = useState(initial?.teamId ?? suggestTeamId(printedTeam));
  const [name, setName] = useState(initial?.name ?? printedTeam);
  const [tag, setTag] = useState(initial?.tag ?? suggestTag(printedTeam));
  const [region, setRegion] = useState(initial?.region ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    if (busy) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      await adminPost("/api/admin/cms/teams", { action: "save", printedTeam, teamId, name, tag, region, expectedRev: initial?.rev ?? 0 });
      setSaved(true); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : t("No se pudo guardar el equipo")); } finally { setBusy(false); }
  };
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-start" data-testid="team-identity-form" data-printed={printedTeam}>
      <Field label={t("Clave")} htmlFor={`${uid}-id`} hint={initial ? t("No se puede cambiar") : t("No se podrá cambiar después")}>
        <Input id={`${uid}-id`} value={teamId} onChange={(e) => setTeamId(e.target.value.toLowerCase())} disabled={!!initial} maxLength={32} autoComplete="off" />
      </Field>
      <Field label={t("Nombre")} htmlFor={`${uid}-name`}><Input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={48} /></Field>
      <Field label={t("Etiqueta")} htmlFor={`${uid}-tag`}><Input id={`${uid}-tag`} value={tag} onChange={(e) => setTag(e.target.value)} maxLength={6} /></Field>
      <Field label={t("Región")} htmlFor={`${uid}-region`}>
        <Select id={`${uid}-region`} value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">{t("Elige región…")}</option>
          {BADGE_REGIONS.map((r) => <option key={r} value={r}>{td(r)}</option>)}
        </Select>
      </Field>
      {/* Alineado con los campos (bajo sus rótulos), no con sus pistas. */}
      <div className="flex items-center gap-2 lg:pt-[22px]">
        <Button onClick={save} disabled={busy || !region}>{busy ? t("Guardando…") : initial ? t("Guardar cambios") : t("Dar de alta")}</Button>
        {saved && <span role="status" className="text-[12px] text-ok">{t("Guardado")}</span>}
      </div>
      {error && <div className="sm:col-span-2 lg:col-span-5"><ErrorBox error={td(error)} /></div>}
    </div>
  );
}

export function TeamIdentitiesPanel({ onChanged }: { onChanged?: () => void }) {
  useLocale();
  const q = useAdminQuery<View>("/api/admin/cms/teams");
  const reload = () => { q.reload(); onChanged?.(); };
  const v = q.data;
  return (
    <Panel title={t("Equipos nuevos del catálogo")} subtitle={t("Equipos impresos en cartas que el registro de código no conoce. Sin clave, nombre, etiqueta y región no forman colección para el jugador ni cuentan para ninguna insignia regional.")}>
      {q.error && <ErrorBox error={td(q.error)} onRetry={q.reload} />}
      {!v && !q.error && <Loading rows={2} />}
      {v && !v.available && <p className="text-[13px] text-amber-300" data-testid="team-identities-unavailable">{t("Falta la migración 0076: todavía no se pueden dar de alta equipos desde el panel.")}</p>}
      {v && v.available && (
        <div className="space-y-5" data-testid="team-identities">
          {v.pending.length === 0 && v.managed.length === 0 && <p className="text-[13px] text-ink-faint">{t("Todos los equipos impresos del catálogo tienen identidad.")}</p>}
          {v.pending.map((p) => (
            <div key={p.printedTeam} className="rounded-control border border-amber-300/30 bg-amber-300/[0.04] p-3" data-testid="team-identity-pending">
              <p className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
                <Pill tone="warn">{t("sin identidad")}</Pill>
                <b className="text-ink-primary">«{p.printedTeam}»</b>
                <span className="text-ink-faint">{t("{n} cartas", { n: fmt(p.cards) })}</span>
              </p>
              <IdentityForm printedTeam={p.printedTeam} initial={null} onSaved={reload} />
            </div>
          ))}
          {v.managed.map((m) => (
            <div key={m.printedTeam} className="rounded-control border border-white/10 bg-white/[0.02] p-3" data-testid="team-identity-managed" data-team={m.teamId}>
              <p className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
                <Pill tone="ok">{td(m.region)}</Pill>
                <b className="text-ink-primary">{m.name}</b>
                <span className="text-ink-faint">{t("impreso «{texto}» · {n} cartas · rev. {rev}", { texto: m.printedTeam, n: fmt(m.cards), rev: m.rev })}</span>
                {!m.logo && <Pill tone="warn">{t("sin logo")}</Pill>}
              </p>
              <IdentityForm printedTeam={m.printedTeam} initial={m} onSaved={reload} />
              <div className="mt-3 max-w-md">
                <AssetUploader kind="team_logo" subjectId={m.teamId} replaceOf={m.logoAssetId} current={m.logo ? { url: m.logo } : null} onUploaded={reload} label={t("Logo oficial del equipo")} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
