"use client";

/**
 * F60 · CARTAS DEL PANEL — asistente de alta (/admin/cards/new) y ficha (/admin/cards/[id]).
 *
 * LA CARTA ES EL ASSET: la vista previa usa `CardFace` → `CardArt` (el MISMO camino que `PlayerCard` en el juego para
 * una carta con imagen), no un renderizador de panel. Nunca se publica mientras se rellena: el asistente termina en
 * BORRADOR; publicar es otra decisión, en la ficha, con confirmación escrita. La clase económica (clase de sobre,
 * valor, desguace) se DERIVA en el servidor con las funciones de siempre; no es un campo.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, ErrorBox, Field, Input, KV, LinkButton, Loading, Panel, Pill, Select, Textarea, SearchBox, Empty } from "@/components/admin/cc/ui";
import { adminPost, useAdminQuery, useDebounced, fmt } from "@/components/admin/cc/api";
import { ActivityList, type AuditItem } from "@/components/admin/cc/Activity";
import { CardFace } from "@/components/cards/CardVisual";
import { AssetUploader, Checklist, DependencyList, LifecycleBadge, Section, useUnsavedGuard, type UploadedAsset } from "./cms";
import { CARD_ROLES, PRINTED_KEYS, PRINTED_LABEL, cardIdOf, validateCardDraft } from "@/domain/cms/cards";
import { DESIGNED_EDITIONS, getVariant } from "@/domain/cards/variants";
import type { CardDef, VariantId } from "@/domain/cards/types";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("admin");

interface WizardPlayer { id: string; nick: string; team: string; region: string; role: string; status: string; derivable: boolean; existing: string[] }
interface Economy { packClass: string | null; packClassLabel: string; marketValue: number; salvageValue: number; editionLabel: string }
type Stats = Record<(typeof PRINTED_KEYS)[number], string>;

const STEPS = ["Jugador", "Edición", "Rol", "OVR y stats", "Equipo impreso", "Arte", "Vista previa", "Validación", "Borrador"] as const;
const EDITIONS = [...DESIGNED_EDITIONS];

function CardPreview({ card }: { card: CardDef | null }) {
  useLocale();
  if (!card?.image) return <div className="grid aspect-[750/1048] w-full place-items-center rounded-[10px] border border-dashed border-white/15 text-[12px] text-ink-faint">{t("Sin arte todavía")}</div>;
  return (
    <div data-testid="card-preview" className="w-full">
      <CardFace artwork={{ url: card.image, cardId: card.id, cardVersion: 1, format: "webp" }} alt={`${card.playerId} · ${getVariant(card.variantId).label}`}>
        <div className="grid aspect-[750/1048] place-items-center text-ink-faint">{t("no se pudo cargar el arte")}</div>
      </CardFace>
    </div>
  );
}

export function NewCardWizard() {
  useLocale();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [q, setQ] = useState(""); const dq = useDebounced(q.trim(), 300);
  const players = useAdminQuery<{ players: WizardPlayer[] }>(`/api/admin/cms/cards${dq ? `?q=${encodeURIComponent(dq)}` : ""}`);
  const [player, setPlayer] = useState<WizardPlayer | null>(null);
  const [variant, setVariant] = useState<string>("");
  const [role, setRole] = useState("");
  const [ovr, setOvr] = useState("");
  const [stats, setStats] = useState<Stats>({ dmg: "", scr: "", fks: "", hs: "", ast: "", clu: "" });
  const [team, setTeam] = useState("");
  const [art, setArt] = useState<UploadedAsset | null>(null);
  const [editorial, setEditorial] = useState({ stronghold: "", gamesense: "", entryfrag: "", reason: "" });
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ valid: boolean; errors: Record<string, string>; card: CardDef | null; economy?: Economy; pools?: { note: string } } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const cardId = player && variant ? cardIdOf(player.id, variant) : "";
  const body = useMemo(() => ({
    playerId: player?.id, variantId: variant, role, ovr: Number(ovr), team,
    stats: Object.fromEntries(PRINTED_KEYS.map((k) => [k, Number(stats[k])])), imageAssetId: art?.id ?? null,
    ...(player && !player.derivable ? { editorial: { combat: { stronghold: Number(editorial.stronghold), gamesense: Number(editorial.gamesense), entryfrag: Number(editorial.entryfrag) }, reason: editorial.reason } } : {}),
  }), [player, variant, role, ovr, team, stats, art, editorial]);
  const errs = validateCardDraft({ ...body, ovr: Number(ovr) || undefined, stats: body.stats as never }, { requireArt: true });
  useUnsavedGuard(!!player && !busy);
  const exists = !!player && player.existing.includes(cardId);
  const stepOk = [!!player, !!variant && !exists, !!role, !errs.ovr && !errs.stats, !errs.team, !!art, !!preview?.valid, !!preview?.valid, reason.trim().length >= 4];

  useEffect(() => { setPreview(null); }, [body]);
  const runPreview = async () => {
    setBusy(true); setError(null);
    try { setPreview(await adminPost("/api/admin/cms/cards", { action: "preview", ...body })); } catch (e) { setError(e instanceof Error ? e.message : t("No se pudo previsualizar")); } finally { setBusy(false); }
  };
  const create = async () => {
    setBusy(true); setError(null);
    try { await adminPost("/api/admin/cms/cards", { action: "create", ...body, reason }); router.push(`/admin/cards/${encodeURIComponent(cardId)}`); }
    catch (e) { setError(e instanceof Error ? e.message : t("No se pudo crear")); setBusy(false); }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <ol className="flex flex-wrap gap-1.5" aria-label={t("Pasos")}>
          {STEPS.map((s, i) => (
            <li key={s}><button type="button" onClick={() => i <= step && setStep(i)} aria-current={i === step ? "step" : undefined}
              className={cn("nx-focus rounded-control border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider", i === step ? "border-drl-cyan text-drl-cyan" : i < step ? "border-white/20 text-ink-secondary" : "border-white/10 text-ink-faint")}>{i + 1}. {td(s)}</button></li>
          ))}
        </ol>
        <Section title={`${step + 1} · ${STEPS[step]}`}>
          {step === 0 && (
            <div className="space-y-3">
              <SearchBox value={q} onChange={setQ} placeholder={t("Nick del jugador")} />
              {players.loading && !players.data ? <Loading rows={3} /> : (
                <ul className="grid gap-1.5 sm:grid-cols-2" data-testid="wizard-players">
                  {(players.data?.players ?? []).map((p) => (
                    <li key={p.id}><button type="button" onClick={() => { setPlayer(p); setRole(p.role); setTeam(p.team ? p.team.slice(0, 12) : ""); setStep(1); }}
                      className={cn("nx-focus w-full rounded-control border px-3 py-2 text-left text-[13px]", player?.id === p.id ? "border-drl-cyan" : "border-white/10 hover:border-white/25")}>
                      <b className="text-ink-primary">{p.nick}</b> <span className="text-ink-faint">{p.team} · {td(p.region)} · {td(p.role)}</span>
                      {!p.derivable && <Pill tone="gold">{t("sin métricas: trío editorial")}</Pill>} {p.status === "inactive" && <Pill>{t("inactivo")}</Pill>}
                    </button></li>
                  ))}
                </ul>
              )}
              <p className="text-[12px] text-ink-faint">{fill(t("¿No está? {enlace} primero.", slots("enlace")), { enlace: <Link className="text-drl-cyan" href="/admin/players/new">{t("Crea el jugador")}</Link> })}</p>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-2">
              <Field label={t("Edición")} htmlFor="cw-ed" hint={t("Sólo las ediciones diseñadas. Su clasificación económica está protegida (no se edita).")} error={exists ? t("Ya existe {cardId}", { cardId: td(cardId) }) : null}>
                <Select id="cw-ed" value={variant} onChange={(e) => setVariant(e.target.value)}>
                  <option value="">{t("Elige…")}</option>
                  {EDITIONS.map((v) => <option key={v} value={v} disabled={player?.existing.includes(cardIdOf(player.id, v))}>{td(getVariant(v as VariantId).label)}{player?.existing.includes(cardIdOf(player.id, v)) ? (" " + t("(ya existe)")) : ""}</option>)}
                </Select>
              </Field>
            </div>
          )}
          {step === 2 && (
            <Field label={t("Rol de LA CARTA")} htmlFor="cw-role" hint={t("El del jugador es {v}; el de la carta puede ser otro (lo impreso manda).", { v: td(player?.role) ?? "—" })} error={td(errs.role)}>
              <Select id="cw-role" value={role} onChange={(e) => setRole(e.target.value)}>{CARD_ROLES.map((r) => <option key={r} value={r}>{td(r)}</option>)}</Select>
            </Field>
          )}
          {step === 3 && (
            <div className="space-y-3">
              <Field label={t("OVR impreso")} htmlFor="cw-ovr" hint={t("40–99. Es también el OVR de juego (como en el catálogo diseñado).")} error={ovr ? td(errs.ovr) : null}><Input id="cw-ovr" inputMode="numeric" value={ovr} onChange={(e) => setOvr(e.target.value.replace(/\D/g, "").slice(0, 2))} /></Field>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {PRINTED_KEYS.map((k) => <Field key={k} label={td(PRINTED_LABEL[k])} htmlFor={`cw-${k}`}><Input id={`cw-${k}`} inputMode="numeric" value={stats[k]} onChange={(e) => setStats({ ...stats, [k]: e.target.value.replace(/\D/g, "").slice(0, 2) })} /></Field>)}
              </div>
              {errs.stats && Object.values(stats).some(Boolean) && <p className="text-[12px] text-warn">{td(errs.stats)}</p>}
              {player && !player.derivable && (
                <div className="rounded-control border border-drl-gold/30 p-3">
                  <p className="mb-2 text-[12px] text-drl-gold">{t("{nick} no tiene métricas: el trío de combate (no impreso) se autoriza a mano, con justificación.", { nick: player.nick })}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(["stronghold", "gamesense", "entryfrag"] as const).map((k) => <Field key={k} label={k} htmlFor={`cw-e-${k}`}><Input id={`cw-e-${k}`} inputMode="numeric" value={editorial[k]} onChange={(e) => setEditorial({ ...editorial, [k]: e.target.value.replace(/\D/g, "").slice(0, 2) })} /></Field>)}
                  </div>
                  <Field label={t("Justificación")} htmlFor="cw-e-r"><Input id="cw-e-r" value={editorial.reason} maxLength={200} onChange={(e) => setEditorial({ ...editorial, reason: e.target.value })} /></Field>
                </div>
              )}
            </div>
          )}
          {step === 4 && (
            <Field label={t("Equipo impreso")} htmlFor="cw-team" hint={t("El que aparece EN la carta. Si el jugador cambia de equipo, esta carta no cambia.")} error={team ? errs.team : null}>
              <Input id="cw-team" value={team} maxLength={12} onChange={(e) => setTeam(e.target.value)} />
            </Field>
          )}
          {step === 5 && (cardId ? <AssetUploader kind="card_artwork" subjectId={cardId} current={art ? { url: art.url } : null} onUploaded={setArt} label={t("Arte final de la carta (la carta ES el asset)")} /> : <p>{t("Elige jugador y edición.")}</p>)}
          {(step === 6 || step === 7) && (
            <div className="space-y-3">
              <Button onClick={runPreview} disabled={busy}>{busy ? t("Calculando…") : t("Previsualizar (no guarda nada)")}</Button>
              {preview && !preview.valid && <ul className="space-y-1 text-[13px] text-warn">{Object.values(preview.errors).map((e) => <li key={e}>○ {td(e)}</li>)}</ul>}
              {preview?.valid && step === 7 && (
                <Checklist items={[
                  { key: "p", label: t("Jugador válido"), ok: true }, { key: "id", label: t("Id único: {cardId}", { cardId: td(cardId) }), ok: true }, { key: "ed", label: t("Edición diseñada"), ok: true },
                  { key: "r", label: t("Rol válido"), ok: true }, { key: "o", label: t("OVR y seis stats válidos"), ok: true }, { key: "a", label: t("Arte subido y aprobado"), ok: !!art },
                  { key: "e", label: t("Clase económica derivable: {packClassLabel}", { packClassLabel: td(preview.economy?.packClassLabel) }), ok: !!preview.economy?.packClass },
                  { key: "pl", label: preview.pools?.note ?? t("Sin impacto en pools"), ok: true },
                ]} />
              )}
            </div>
          )}
          {step === 8 && (
            <div className="space-y-3">
              <p className="text-[13px] text-ink-muted">{t("Se crea como BORRADOR (definición + presentación en una sola transacción). No entra en el catálogo público ni en sobres hasta publicarla.")}</p>
              <Field label={t("Motivo (auditoría)")} htmlFor="cw-reason"><Textarea id="cw-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>
              <Button onClick={create} disabled={busy || !preview?.valid || reason.trim().length < 4}>{busy ? t("Creando…") : t("Guardar borrador")}</Button>
            </div>
          )}
          {error && <div className="mt-3"><ErrorBox error={td(error)} /></div>}
          <div className="mt-4 flex justify-between">
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>{t("← Anterior")}</Button>
            {step < STEPS.length - 1 && <Button onClick={() => { if (step === 5) void runPreview(); setStep((s) => s + 1); }} disabled={!stepOk[step]}>{t("Siguiente →")}</Button>}
          </div>
        </Section>
      </div>
      <aside className="space-y-4">
        <Panel title={t("Vista previa exacta")}>
          <CardPreview card={preview?.card ?? (art && player && variant ? { id: cardId, playerId: player.id, variantId: variant as VariantId, ovr: Number(ovr) || 0, image: art.url ?? undefined } as unknown as CardDef : null)} />
          {preview?.economy && <KV cols={1} items={[[t("Edición"), preview.economy.editionLabel], [t("Clase de sobre"), preview.economy.packClassLabel], [t("Valor de mercado"), `${fmt(preview.economy.marketValue)} cr`], [t("Desguace"), `${fmt(preview.economy.salvageValue)} cr`]]} />}
          <p className="mt-2 text-[11px] text-ink-faint">{t("La clasificación económica se deriva (edición + OVR) con las funciones congeladas de F57.5B/F57.6.")}</p>
        </Panel>
      </aside>
    </div>
  );
}

interface CardDetailData {
  cardId: string; lifecycle: string; origin: string; presentationRev: number; definitionVersion: number;
  presentation: { role: string; printed: { ovr: number; stats: Record<string, number> }; team: string; imageAssetId?: string } | null;
  card: CardDef | null; economy: Economy | null; art: { id: string; url: string | null } | null;
  references: Record<string, number>; checklist: { key: string; label: string; ok: boolean }[]; history: AuditItem[];
}

export function CardDetailView({ id }: { id: string }) {
  useLocale();
  const router = useRouter();
  const q = useAdminQuery<CardDetailData>(`/api/admin/cms/cards?id=${encodeURIComponent(id)}`);
  const [dialog, setDialog] = useState<null | "publish" | "retire" | "delete">(null);
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  if (q.error) return <ErrorBox error={td(q.error)} onRetry={q.reload} />;
  if (!q.data) return <Loading rows={6} />;
  const d = q.data;
  const isDraft = ["DRAFT", "REVIEW", "APPROVED"].includes(d.lifecycle);
  const act = async () => {
    setBusy(true); setErr(null);
    try {
      const action = dialog === "delete" ? "deleteDraft" : dialog === "retire" ? "retire" : "publish";
      await adminPost("/api/admin/cms/cards", { action, cardId: d.cardId, reason, confirm: d.cardId, expectedRev: d.presentationRev });
      if (dialog === "delete") { router.push("/admin/cards"); return; }
      setDialog(null); setReason(""); q.reload();
    } catch (e) { setErr(e instanceof Error ? e.message : t("No se pudo completar")); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <Section title={t("Carta")} aside={<span className="flex gap-2"><LifecycleBadge state={d.lifecycle} /><Pill>{d.origin === "admin" ? t("creada en el panel") : t("catálogo diseñado")}</Pill></span>}>
          <KV cols={2} items={[
            ["Id", <span key="i" className="font-mono">{d.cardId}</span>], [t("Versión de definición"), `v${d.definitionVersion}`],
            [t("Rol de la carta"), d.presentation?.role ?? d.card?.role ?? "—"], ["OVR impreso", String(d.presentation?.printed.ovr ?? d.card?.printed?.ovr ?? d.card?.ovr ?? "—")],
            [t("Equipo impreso"), d.presentation?.team ?? d.card?.team ?? "—"], [t("Stats impresas"), d.presentation ? Object.entries(d.presentation.printed.stats).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(" · ") : d.card?.printed ? Object.entries(d.card.printed.stats).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(" · ") : "—"],
          ]} />
          {d.origin !== "admin" && <p className="mt-2 text-[12px] text-ink-faint">{fill(t("Lo impreso de las cartas del catálogo diseñado sale de su propia imagen (manifiesto) y no se edita aquí. Para versiones de combate: {enlace}.", slots("enlace")), { enlace: <a className="text-drl-cyan" href={`/admin/cartas/${encodeURIComponent(d.cardId)}`}>{t("editor avanzado")}</a> })}</p>}
        </Section>
        {d.economy && <Section title={t("Clasificación económica (derivada, protegida)")}><KV cols={2} items={[[t("Edición"), d.economy.editionLabel], [t("Clase de sobre"), d.economy.packClassLabel], [t("Valor de mercado"), `${fmt(d.economy.marketValue)} cr`], [t("Desguace"), `${fmt(d.economy.salvageValue)} cr`]]} /></Section>}
        <Section title={t("Usado por")}><DependencyList refs={d.references} labels={{ copies: t("Ejemplares"), owners: t("Dueños"), decks: t("Mazos"), pools: t("Pools"), favorites: t("Favoritos"), listings: t("Mercado"), versions: t("Versiones") }} /></Section>
        <Section title={t("Historial")}><ActivityList items={d.history} empty={t("Sin cambios registrados")} /></Section>
      </div>
      <aside className="space-y-5">
        <Panel title={t("Vista previa (CardArt)")}><CardPreview card={d.card} /></Panel>
        <Panel title={t("Acciones")}>
          {d.origin === "admin" && isDraft && <Checklist items={d.checklist} />}
          <div className="mt-3 flex flex-wrap gap-2">
            {d.origin === "admin" && isDraft && <Button onClick={() => setDialog("publish")} disabled={!d.checklist.every((c) => c.ok)}>{t("Publicar")}</Button>}
            {d.lifecycle === "PUBLISHED" && <Button variant="danger" onClick={() => setDialog("retire")}>{t("Retirar")}</Button>}
            {d.origin === "admin" && isDraft && <Button variant="danger" onClick={() => setDialog("delete")}>{t("Borrar borrador")}</Button>}
            <LinkButton href={`/admin/cartas/${encodeURIComponent(d.cardId)}`}>{t("Editor avanzado")}</LinkButton>
          </div>
          {d.lifecycle === "RETIRED" && <p className="mt-2 text-[12px] text-ink-faint">{t("Retirada: no sale en sobres; sus ejemplares siguen en manos de sus dueños y se siguen pintando.")}</p>}
        </Panel>
      </aside>
      <ConfirmDialog open={dialog !== null} onClose={() => { if (!busy) { setDialog(null); setErr(null); } }} onConfirm={act} busy={busy} error={td(err)}
        risk={dialog === "delete" ? "CRITICAL" : "HIGH"} title={dialog === "publish" ? t("Publicar carta") : dialog === "retire" ? t("Retirar carta") : t("Borrar borrador")}
        confirmLabel={dialog === "delete" ? t("Borrar definitivamente") : dialog === "retire" ? t("Retirar") : t("Publicar")} typeToConfirm={d.cardId} canConfirm={reason.trim().length >= (dialog === "retire" ? 8 : 4)}>
        <p>{dialog === "publish" ? t("Entra en el catálogo del juego. No sale en ningún sobre hasta que un pool la incluya.") : dialog === "retire" ? t("Deja de salir en sobres. Nadie pierde sus ejemplares; la carta sigue pintándose.") : t("Borrado DURO del borrador (sin historia). Irreversible.")}</p>
        <Field label={t("Motivo (auditoría)")} htmlFor="cd-reason"><Textarea id="cd-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </div>
  );
}

export function EmptyCardsHint() {
  useLocale();
  return <Empty title={t("Sin cartas del panel")}>{t("Crea una con el asistente.")}</Empty>;
}
