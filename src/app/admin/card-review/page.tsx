"use client";

/**
 * REVIEW DASHBOARD (/admin/card-review) — SOLO LECTURA. Muestra la ÚLTIMA generación publicada
 * (ReviewModel grabado por el pipeline) con filtros por faceta y orden. No edita, no aprueba,
 * no publica, no toca catálogo ni stores de juego: pura visualización de lo ya decidido por
 * los motores F4→F7.
 */
import { useEffect, useMemo, useState } from "react";
import { runtimeGenerationId, runtimeVersion } from "@/publisher/runtime";
import {
  applyReviewFilter, reviewFacets, sortReviewRows,
  type ReviewCardRow, type ReviewFilter, type ReviewSortKey,
} from "@/review";
import { useReviewStore } from "@/review/store";
import { availableActions, type EditorialAction, type EditorialCase, type EditorialState } from "@/editorial";
import { useEditorialStore } from "@/editorial/store";
import { cn } from "@/lib/format";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("admin");

const SORTS: { key: ReviewSortKey; label: string }[] = [
  { key: "ovr", label: "OVR" },
  { key: "rarity", label: "Rareza" },
  { key: "player", label: "Jugador" },
  { key: "date", label: "Fecha" },
];

// ── Circuito editorial (Fase 4): etiquetas y colores de estado/acción ──
const ACTION_LABEL: Partial<Record<EditorialAction, string>> = {
  approve: "✓ Aprobar", reject: "✗ Rechazar", hide: "◌ Ocultar", block: "⛔ Bloquear",
  to_review: "↩ A review", archive: "🗄 Archivar",
};
const STATE_COLOR: Record<EditorialState, string> = {
  draft: "border-white/20 text-white/50",
  review: "border-sky-400/40 text-sky-300",
  approved: "border-emerald-400/40 text-emerald-300",
  published: "border-drl/60 text-drl",
  archived: "border-white/15 text-white/35",
  rejected: "border-red-400/40 text-red-300",
  hidden: "border-white/25 text-white/40",
  blocked: "border-orange-400/40 text-orange-300",
};

const RARITY_COLOR: Record<string, string> = {
  common: "text-white/60 border-white/20",
  uncommon: "text-emerald-300 border-emerald-400/40",
  rare: "text-sky-300 border-sky-400/40",
  epic: "text-fuchsia-300 border-fuchsia-400/40",
  legendary: "text-amber-300 border-amber-400/40",
};

export default function CardReviewPage() {
  useLocale();
  const model = useReviewStore((s) => s.model);
  const editorialCase = useEditorialStore((s) => (model ? s.cases[model.generationId] : undefined));
  const decideCards = useEditorialStore((s) => s.decideCards);
  const approveAll = useEditorialStore((s) => s.approveAll);
  const [mounted, setMounted] = useState(false);
  const [filter, setFilter] = useState<ReviewFilter>({});
  const [sort, setSort] = useState<ReviewSortKey>("ovr");
  const [search, setSearch] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => setMounted(true), []);

  const facets = useMemo(() => reviewFacets(model?.rows ?? []), [model]);
  const rows = useMemo(() => {
    if (!model) return [];
    let out = applyReviewFilter(model.rows, filter);
    const q = search.trim().toLowerCase();
    if (q) out = out.filter((r) => r.cardId.toLowerCase().includes(q) || r.player.toLowerCase().includes(q) || r.team.toLowerCase().includes(q));
    return sortReviewRows(out, sort);
  }, [model, filter, sort, search]);

  const act = (cardIds: string[], action: EditorialAction) => {
    if (!model) return;
    decideCards(model.generationId, cardIds, action, { actor: "admin", at: Date.now() });
  };

  if (!mounted) return null;

  const liveGen = runtimeGenerationId();
  const inRuntime = !!model && liveGen === model.generationId;

  return (
    <section className="animate-rise space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
            {t("Card")} <span className="text-drl">{t("Review")}</span>
          </h1>
          <p className="mt-1 text-white/50">{t("Última generación publicada — solo lectura.")}</p>
        </div>
        {model && (
          <div className="text-right text-[11px] text-white/45">
            <p className="font-mono text-white/70">{model.generationId}</p>
            <p>
              {t("{torneo} · catálogo v{catalogo} · runtime v{runtime}", { torneo: td(model.tournamentName), catalogo: model.catalogVersion, runtime: model.runtimeVersion })}
              <span className={cn("ml-2 rounded-full border px-2 py-0.5 font-display uppercase tracking-wide",
                inRuntime ? "border-emerald-400/40 text-emerald-300" : "border-white/20 text-white/50")}>
                {inRuntime ? t("en runtime") : t("grabada (runtime v{v} de esta sesión)", { v: runtimeVersion() })}
              </span>
            </p>
          </div>
        )}
      </header>

      {!model ? (
        <div className="rounded-2xl border border-white/10 bg-base-700/40 p-10 text-center text-white/55">
          <p className="font-display text-lg font-bold text-white/80">{t("Sin generación publicada")}</p>
          <p className="mt-2 text-sm">
            {fill(t("Ejecuta {comando} — la próxima publicación quedará registrada aquí.", slots("comando")), { comando: <code className="rounded bg-white/10 px-1.5 py-0.5 text-drl-cyan">npm run tournament:generate &lt;url&gt;</code> })}
          </p>
        </div>
      ) : (
        <>
          {/* Resumen */}
          <div className="grid gap-3 sm:grid-cols-5">
            <Stat label={t("Cartas")} value={model.counts.cards} />
            <Stat label={t("Jugadores")} value={model.counts.players} />
            <Stat label={t("Colecciones")} value={model.counts.collections} />
            <Stat label={t("Elegibles en sobres")} value={model.counts.packsEligible} />
            <Stat label={t("Elegibles en mercado")} value={model.counts.marketEligible} />
          </div>

          {/* Filtros + orden */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-base-700/40 p-3">
            <Select label={t("Equipo")} value={filter.team ?? ""} options={facets.teams}
              onChange={(v) => setFilter((f) => ({ ...f, team: v || undefined }))} />
            <Select label={t("Jugador")} value={filter.player ?? ""} options={facets.players}
              onChange={(v) => setFilter((f) => ({ ...f, player: v || undefined }))} />
            <Select label={t("Rareza")} value={filter.rarity ?? ""} options={facets.rarities}
              onChange={(v) => setFilter((f) => ({ ...f, rarity: (v || undefined) as ReviewFilter["rarity"] }))} />
            <Select label={t("Colección")} value={filter.collection ?? ""} options={facets.collections.map((c) => c.id)}
              labels={Object.fromEntries(facets.collections.map((c) => [c.id, c.name]))}
              onChange={(v) => setFilter((f) => ({ ...f, collection: v || undefined }))} />
            <Select label={t("Torneo")} value={filter.tournament ?? ""} options={facets.tournaments}
              onChange={(v) => setFilter((f) => ({ ...f, tournament: v || undefined }))} />
            <Select label={t("Estado")} value={filter.status ?? ""} options={facets.statuses}
              onChange={(v) => setFilter((f) => ({ ...f, status: (v || undefined) as ReviewFilter["status"] }))} />
            <Select label={t("Variante")} value={filter.variant ?? ""} options={facets.variants}
              onChange={(v) => setFilter((f) => ({ ...f, variant: v || undefined }))} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Buscar carta / jugador / equipo…")}
              className="w-48 rounded-lg border border-white/15 bg-base-800 px-2.5 py-1.5 text-[12px] text-white/80 outline-none placeholder:text-white/30" />
            <div className="ml-auto flex items-center gap-1">
              <span className="text-[10px] uppercase tracking-widest text-white/40">{t("Orden")}</span>
              {SORTS.map((s) => (
                <button key={s.key} onClick={() => setSort(s.key)}
                  className={cn("rounded-lg px-2.5 py-1.5 font-display text-[11px] uppercase tracking-wide",
                    sort === s.key ? "bg-drl text-white" : "text-white/50 hover:bg-white/10")}>
                  {td(s.label)}
                </button>
              ))}
            </div>
          </div>

          {/* Circuito editorial (Fase 4): lote, torneo completo e historial — solo si la generación está en revisión */}
          {editorialCase ? (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-base-700/40 p-3">
              <span className="text-[10px] uppercase tracking-widest text-white/40">{t("Editorial")}</span>
              <button onClick={() => act(rows.filter((r) => editorialCase.states[r.cardId] === "review").map((r) => r.cardId), "approve")}
                className="rounded-lg border border-emerald-400/40 px-3 py-1.5 font-display text-[11px] uppercase tracking-wide text-emerald-300 hover:bg-emerald-400/10">
                {t("✓ Aprobar lote ({n} filtradas)", { n: rows.filter((r) => editorialCase.states[r.cardId] === "review").length })}
              </button>
              <button onClick={() => model && approveAll(model.generationId, { actor: "admin", at: Date.now() })}
                className="rounded-lg border border-emerald-400/40 px-3 py-1.5 font-display text-[11px] uppercase tracking-wide text-emerald-300 hover:bg-emerald-400/10">
                {t("✓✓ Aprobar torneo completo")}
              </button>
              <button onClick={() => setShowHistory((v) => !v)}
                className={cn("rounded-lg border px-3 py-1.5 font-display text-[11px] uppercase tracking-wide",
                  showHistory ? "border-drl/60 text-drl" : "border-white/15 text-white/50 hover:bg-white/10")}>
                {t("🕘 Historial ({n})", { n: editorialCase.history.length })}
              </button>
              <span className="ml-auto text-[11px] text-white/40">
                {(["review", "approved", "published", "rejected", "hidden", "blocked"] as EditorialState[])
                  .map((st) => `${st}: ${Object.values(editorialCase.states).filter((s) => s === st).length}`)
                  .join(" · ")}
              </span>
            </div>
          ) : (
            <p className="rounded-2xl border border-white/10 bg-base-700/40 p-3 text-[11px] text-white/40">
              {fill(t("Esta generación no está en el circuito editorial (se somete con {fn} al generarla).", slots("fn")), { fn: <code className="text-drl-cyan">submitGeneration</code> })}
            </p>
          )}

          {editorialCase && showHistory && <HistoryPanel c={editorialCase} />}

          <p className="text-[11px] text-white/40">{t("{n} de {total} cartas", { n: rows.length, total: model.rows.length })}</p>

          {/* Cartas */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => (
              <ReviewCard key={r.cardId} row={r}
                editorialState={editorialCase?.states[r.cardId]}
                onAction={editorialCase ? (a) => act([r.cardId], a) : undefined} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  useLocale();
  return (
    <div className="rounded-2xl border border-white/10 bg-base-700/40 p-3">
      <p className="text-[10px] uppercase tracking-widest text-white/40">{td(label)}</p>
      <p className="font-display text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

function Select({ label, value, options, labels, onChange }: {
  label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (v: string) => void;
}) {
  useLocale();
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-white/50">
      <span className="uppercase tracking-widest text-white/40">{td(label)}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-white/15 bg-base-800 px-2 py-1.5 text-white/80 outline-none">
        <option value="">{t("Todos")}</option>
        {options.map((o) => <option key={o} value={o}>{td(labels?.[o]) ?? td(o)}</option>)}
      </select>
    </label>
  );
}

function HistoryPanel({ c }: { c: EditorialCase }) {
  useLocale();
  const events = [...c.history].reverse().slice(0, 200);
  return (
    <div className="max-h-72 overflow-y-auto rounded-2xl border border-white/10 bg-base-700/40 p-3 text-[11px] leading-5 text-white/60">
      {events.map((e) => (
        <p key={e.seq} className="truncate border-b border-white/5 py-0.5 font-mono">
          #{String(e.seq).padStart(4, "0")} · {new Date(e.at).toLocaleString(getIntlLocale())} · <b className="text-white/80">{td(e.actor)}</b> · {e.action}
          {e.cardId ? <> · <span className="text-drl-cyan">{e.cardId}</span> · {e.from} → <b className="text-white/80">{e.to}</b></> : (" " + t("· (generación)"))}
          {e.comment ? ` · "${e.comment}"` : ""}{e.reason ? t(" · motivo: {reason}", { reason: td(e.reason) }) : ""}
        </p>
      ))}
    </div>
  );
}

function ReviewCard({ row: r, editorialState, onAction }: {
  row: ReviewCardRow;
  editorialState?: EditorialState;
  onAction?: (a: EditorialAction) => void;
}) {
  useLocale();
  const hasImage = r.artwork.hasCustom && /^(\/|https?:)/.test(r.artwork.image);
  return (
    <article className="flex gap-3 rounded-2xl border border-white/10 bg-base-700/40 p-3">
      {/* Imagen (placeholder si no hay artwork aprobado) */}
      {hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.artwork.image} alt={r.player} className="h-28 w-20 shrink-0 rounded-xl object-cover" />
      ) : (
        <div className="flex h-28 w-20 shrink-0 flex-col items-center justify-center rounded-xl border border-white/10 bg-gradient-to-b from-base-600 to-base-800 text-center">
          <span className="font-display text-2xl font-bold text-white/80">{r.ovr}</span>
          <span className="px-1 text-[9px] uppercase tracking-wide text-white/40">{r.variantId}</span>
        </div>
      )}

      <div className="min-w-0 flex-1 text-[12px] leading-5 text-white/65">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-bold text-white">{r.player} <span className="font-normal text-white/40">· {r.team}</span></p>
            <p className="truncate text-[11px] text-white/45">{td(r.tournamentName)} · S{r.season}</p>
          </div>
          <span className={cn("shrink-0 rounded-full border px-2 py-0.5 font-display text-[10px] uppercase tracking-wide", RARITY_COLOR[r.rarityBucket] ?? RARITY_COLOR.common)}>
            {r.rarityBucket}
          </span>
        </div>

        <p className="mt-1 truncate font-mono text-[11px] text-drl-cyan">{r.cardId}</p>
        <p className="truncate">
          <b className="text-white/80">{t("OVR")} {r.ovr}</b> · {r.variantId}{r.serialized ? t(" · serie /{v}", { v: r.serialLimit ?? "?" }) : ""} · {td(r.decision)} · {r.status}/{r.releaseState}
        </p>
        {r.badges.length > 0 && <p className="truncate text-amber-200/80">🏅 {r.badges.join(" · ")}</p>}
        <p className="truncate text-white/45">
          {t("Colección:")} {r.collections.map((c) => c.name).join(", ") || "—"}
        </p>
        <p className="truncate text-white/45">
          {t("Sobres:")} {r.packs.length ? r.packs.join(", ") : t("no elegible")} {t("· Mercado:")} {r.market.tradable ? t("sí ({initialValue})", { initialValue: r.market.initialValue }) : t("restringida")}
        </p>
        <p className="truncate text-white/40" title={r.rules.join(", ")}>{t("Reglas:")} {r.rules.join(", ") || "—"}</p>
        {r.evidence.length > 0 && (
          <p className="truncate text-white/40" title={r.evidence.join(" · ")}>{t("Evidencia:")} {r.evidence.join(" · ")}</p>
        )}
        <p className="truncate text-[10px] text-white/30">{r.generationId}</p>

        {/* Acciones editoriales (Fase 4) — solo si la generación está en el circuito */}
        {editorialState && onAction && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 border-t border-white/5 pt-1.5">
            <span className={cn("rounded-full border px-2 py-0.5 font-display text-[9px] uppercase tracking-wide", STATE_COLOR[editorialState])}>
              {editorialState}
            </span>
            {availableActions(editorialState).filter((a) => a !== "publish").map((a) => (
              <button key={a} onClick={() => onAction(a)}
                className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/60 hover:bg-white/10">
                {td(ACTION_LABEL[a]) ?? a}
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
