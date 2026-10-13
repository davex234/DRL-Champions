"use client";

/**
 * /admin/cartas/nueva — ALTA DE CARTA (Bloque 8.4.1).
 *
 * ────────────────────────── AQUÍ NO SE INVENTA UNA ESTADÍSTICA ──────────────────────────
 *
 * Crear una carta es **elegir un jugador y una variante**. El OVR, el trío de combate, las
 * seis estadísticas heredadas y la rareza los deriva el servidor con `playerCombatBase()` +
 * `deriveCard()`, que son las mismas funciones que construyen el catálogo desde el bloque 1.
 *
 * No hay un campo para escribir «OVR 95», y es a propósito: un panel que lo permitiera
 * convertiría el catálogo en opinión. La trazabilidad del OVR hasta métricas reales de VLR
 * costó varios bloques y no se rompe desde un formulario.
 *
 * ────────────────────────── LA VÍA EDITORIAL, Y CUÁNDO APARECE ──────────────────────────
 *
 * El dominio ya tiene una excepción para jugadores sin métricas derivables — retirados,
 * históricos, circuitos con pocas rondas—: `Player.editorial`, con motivo y autoría
 * obligatorios. El formulario la expone tal cual, y **solo cuando toca**:
 *
 *   · jugador derivable    → se deriva. No aparece ningún campo de estadísticas.
 *   · jugador NO derivable → aparece el trío editorial, y exige justificación.
 *
 * La carta queda marcada `source: "editorial"`, así que en la ficha y en el histórico se ve
 * que ese trío lo puso una persona. No es un atajo: es la única vía para un jugador que el
 * generador rechaza, y deja rastro.
 *
 * ────────────────────────── SIEMPRE NACE EN DRAFT ──────────────────────────
 *
 * No hay casilla de «publicar al crear». Una carta recién creada existe en la base de datos,
 * no está en el catálogo jugable, no está en pools activos y no puede salir en sobres.
 * Publicar es una segunda decisión, en la ficha, con su confirmación.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Stage, Plate, Recessed, Rail } from "@/components/ui/Surface";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { Loading } from "@/components/ui/States";
import { adminApi, useAsync, ErrorBar, BucketBadge, Field, FieldGrid } from "@/components/admin/cards/shared";
import { CardPreview } from "@/components/admin/cards/CardPreview";
import { VARIANTS, getVariant } from "@/domain/cards/variants";
import { bucketForRank } from "@/domain/packs/types";
import { deriveCard, type CombatStats } from "@/domain/cards/combat";
import { applyStatBoost } from "@/domain/cards/ovr";
import { marketValue } from "@/domain/economy/pricing";
import type { Player, VariantId, CardDef } from "@/domain/cards/types";

interface PlayerRow {
  id: string; nick: string; team: string; region: string; role: string; country: string;
  derivable: boolean; reason?: string; existing: string[];
  /** El jugador completo y su trío derivado: los necesita la previsualización. */
  player: Player;
  baseCombat: CombatStats | null;
}

export default function NuevaCartaPage() {
  const router = useRouter();
  const { running, error, clear, run } = useAsync<unknown>();

  const [q, setQ] = useState("");
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [sel, setSel] = useState<PlayerRow | null>(null);
  const [variantId, setVariantId] = useState("");
  const [reason, setReason] = useState("");
  const [editorial, setEditorial] = useState({ stronghold: "", gamesense: "", entryfrag: "", reason: "" });

  const buscar = useCallback(async (texto: string) => {
    const r = await run(async () => adminApi<{ players: PlayerRow[] }>("players", { q: texto || undefined }));
    if (r) setPlayers((r as { players: PlayerRow[] }).players);
  }, [run]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void buscar(q); }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, buscar]);

  /** Variantes ordenadas por rareza. Las que ya tiene el jugador se marcan y no se pueden elegir. */
  const variantes = useMemo(() => {
    const ya = new Set((sel?.existing ?? []).map((id) => id.split("__")[1]));
    return Object.values(VARIANTS)
      .map((v) => ({ id: v.id, label: v.label, rank: v.rank, bucket: bucketForRank(v.rank), yaExiste: ya.has(v.id) }))
      .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
  }, [sel]);

  const necesitaEditorial = sel !== null && !sel.derivable;

  /*
   * LA CARTA QUE SE VA A CREAR, derivada aquí con el dominio.
   *
   * `deriveCard()` es la misma función que compone el catálogo y la misma que llamará el
   * servidor. Lo de aquí es una PREDICCIÓN exacta, no una segunda fórmula: al crear se envían
   * jugador, variante y —si toca— el trío editorial, y el servidor lo vuelve a derivar todo.
   *
   * Para un jugador derivable el trío sale de sus métricas; para uno que el generador rechaza,
   * de lo que se esté tecleando en el trío editorial. Mientras ese trío esté incompleto no hay
   * previsualización que enseñar, y se dice en vez de dibujar una carta con ceros.
   */
  const previsualizacion = useMemo(() => {
    if (!sel || !variantId) return null;
    let variant;
    try { variant = getVariant(variantId as VariantId); } catch { return null; }

    let base: CombatStats | null = sel.baseCombat;
    if (necesitaEditorial) {
      const n = (v: string): number | null => {
        const x = Number(v);
        return v !== "" && Number.isInteger(x) && x >= 0 && x <= 99 ? x : null;
      };
      const sh = n(editorial.stronghold), gs = n(editorial.gamesense), ef = n(editorial.entryfrag);
      base = sh !== null && gs !== null && ef !== null
        ? { stronghold: sh, gamesense: gs, entryfrag: ef }
        : null;
    }
    if (!base) return null;

    const { combat, ovr } = deriveCard(base, variant.statBoost);
    const stats = applyStatBoost(sel.player.stats, variant.statBoost);
    const card: CardDef = {
      id: `${sel.id}__${variant.id}`, playerId: sel.id, variantId: variant.id,
      stats, ovr, combat, statBoost: variant.statBoost,
    };
    return { variant, combat, ovr, stats, card };
  }, [sel, variantId, necesitaEditorial, editorial]);

  const editorialCompleto =
    !necesitaEditorial ||
    (["stronghold", "gamesense", "entryfrag"] as const).every((k) => {
      const n = Number(editorial[k]);
      return Number.isFinite(n) && n >= 1 && n <= 99;
    }) && editorial.reason.trim().length > 0;

  const puedeCrear = !!sel && !!variantId && reason.trim().length > 0 && editorialCompleto && !running;

  const crear = async () => {
    const body: Record<string, unknown> = {
      playerId: sel!.id, variantId, reason: reason.trim(),
    };
    if (necesitaEditorial) {
      body.editorial = {
        combat: {
          stronghold: Number(editorial.stronghold),
          gamesense: Number(editorial.gamesense),
          entryfrag: Number(editorial.entryfrag),
        },
        reason: editorial.reason.trim(),
      };
    }
    const r = await run(async () => adminApi<{ cardId: string }>("create", body));
    if (r) router.push(`/admin/cartas/${encodeURIComponent((r as { cardId: string }).cardId)}`);
  };

  return (
    <Stage data-admin-panel="nueva" className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionTitle>Nueva carta</SectionTitle>
          <p className="mt-1 max-w-2xl text-sm text-white/50">
            Elige un jugador y una variante. Las estadísticas las deriva el servidor con las
            mismas funciones que generan el catálogo — aquí no se escribe un OVR a mano.
          </p>
        </div>
        <NxButton href="/admin/cartas" variant="ghost">← Listado</NxButton>
      </header>

      <ErrorBar error={error} onClose={clear} />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── 1. Jugador ── */}
        <section aria-labelledby="h-jugador" className="min-w-0">
          <h2 id="h-jugador" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
            1 · Jugador
          </h2>
          <Plate className="p-4">
            <label className="block">
              <span className="font-display text-label uppercase tracking-wider text-white/50">Buscar</span>
              <input
                value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="nick del jugador…" aria-label="Buscar jugador por nick"
                className="mt-1 min-h-[44px] w-full border border-white/15 bg-base-800 px-3 text-sm text-white outline-none focus-visible:border-drl"
              />
            </label>

            <div className="mt-3 max-h-72 space-y-1 overflow-y-auto" role="listbox" aria-label="Jugadores">
              {running && players.length === 0 && <Loading label="Buscando…" />}
              {players.map((p) => (
                <button
                  key={p.id} type="button" role="option" aria-selected={sel?.id === p.id}
                  onClick={() => { setSel(p); setVariantId(""); }}
                  className={`flex min-h-[44px] w-full items-center justify-between gap-2 border px-3 py-2 text-left transition
                    ${sel?.id === p.id ? "border-drl bg-drl/10" : "border-white/10 hover:bg-white/5"}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-white/90">{p.nick}</span>
                    <span className="block truncate text-[11px] text-white/40">
                      {p.team || "sin equipo"} · {p.region} · {p.role} · {p.existing.length} cartas
                    </span>
                  </span>
                  <Badge tone={p.derivable ? "ok" : "warn"}>
                    {p.derivable ? "derivable" : (p.reason ?? "sin métricas")}
                  </Badge>
                </button>
              ))}
              {!running && players.length === 0 && (
                <p className="px-1 py-3 text-sm text-white/40">Ningún jugador con ese nick.</p>
              )}
            </div>
          </Plate>
        </section>

        {/* ── 2. Variante ── */}
        <section aria-labelledby="h-variante" className="min-w-0">
          <h2 id="h-variante" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
            2 · Variante
          </h2>
          <Plate className="p-4">
            {!sel ? (
              <p className="text-sm text-white/40">Elige antes un jugador.</p>
            ) : (
              <div className="max-h-72 space-y-1 overflow-y-auto" role="listbox" aria-label="Variantes">
                {variantes.map((v) => (
                  <button
                    key={v.id} type="button" role="option" aria-selected={variantId === v.id}
                    disabled={v.yaExiste}
                    onClick={() => setVariantId(v.id)}
                    className={`flex min-h-[44px] w-full items-center justify-between gap-2 border px-3 py-2 text-left transition
                      ${variantId === v.id ? "border-drl bg-drl/10" : "border-white/10 hover:bg-white/5"}
                      ${v.yaExiste ? "cursor-not-allowed opacity-35" : ""}`}
                  >
                    <span className="min-w-0 truncate text-sm text-white/90">{v.label}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <BucketBadge bucket={v.bucket} rank={v.rank} />
                      {v.yaExiste && <Badge tone="muted">ya existe</Badge>}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {sel && variantId && (
              <Recessed className="mt-3 p-3">
                <p className="font-display text-label uppercase tracking-wider text-white/40">Card ID que se creará</p>
                <p className="font-mono text-[13px] text-drl-cyan">{sel.id}__{variantId}</p>
              </Recessed>
            )}
          </Plate>
        </section>
      </div>

      {/* ── Previsualización: la carta de verdad, mientras se elige ── */}
      {sel && variantId && (
        <section aria-labelledby="h-preview">
          <h2 id="h-preview" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
            Cómo va a quedar
          </h2>
          <Plate className="p-4">
            {previsualizacion ? (
              <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start">
                <CardPreview
                  player={sel.player}
                  variant={previsualizacion.variant}
                  stats={previsualizacion.stats}
                  ovr={previsualizacion.ovr}
                  combat={previsualizacion.combat}
                  size="lg"
                  nota="Todavía no existe: se creará como borrador."
                />
                <div className="min-w-0 space-y-4">
                  <div className="flex flex-wrap items-end gap-6">
                    <div>
                      <p className="font-display text-label uppercase tracking-wider text-white/40">OVR</p>
                      <p className="font-display text-4xl font-bold tabular-nums text-white">
                        {previsualizacion.ovr}
                      </p>
                    </div>
                    <p className="max-w-sm text-[12px] leading-relaxed text-white/40">
                      Derivado con <code className="text-white/60">deriveCard()</code>: el trío
                      base más el <strong className="text-white/70">+{previsualizacion.variant.statBoost}</strong>{" "}
                      de la variante, y de ahí el OVR. Es la misma función que usará el
                      servidor al guardar, así que esta cifra es la que se va a persistir.
                    </p>
                  </div>
                  <FieldGrid cols={4}>
                    <Field label="Jugador">{sel.nick}</Field>
                    <Field label="Equipo">{sel.team || "—"}</Field>
                    <Field label="Rol">{sel.role}</Field>
                    <Field label="Región / País">{sel.region} · {sel.country || "—"}</Field>
                    <Field label="Variante">{previsualizacion.variant.label}</Field>
                    <Field label="Rank / Bucket">
                      {previsualizacion.variant.rank} · {bucketForRank(previsualizacion.variant.rank)}
                    </Field>
                    <Field label="Serializada">
                      {previsualizacion.variant.serialized
                        ? `sí · /${previsualizacion.variant.serialLimit ?? "?"}`
                        : "no"}
                    </Field>
                    <Field label="Valor de mercado">
                      {marketValue(previsualizacion.card).toLocaleString("es-ES")} cr
                    </Field>
                  </FieldGrid>
                </div>
              </div>
            ) : (
              <p className="text-sm text-white/40">
                {necesitaEditorial
                  ? "Completa el trío editorial (tres enteros de 0 a 99) para ver la carta."
                  : "Sin trío derivable para este jugador."}
              </p>
            )}
          </Plate>
        </section>
      )}

      {/* ── 3. Trío editorial, SOLO si hace falta ── */}
      {necesitaEditorial && (
        <section aria-labelledby="h-editorial">
          <h2 id="h-editorial" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
            3 · Trío editorial
          </h2>
          <Plate tone="gold" className="space-y-3 p-4">
            <p className="text-sm text-white/70">
              <strong>{sel!.nick}</strong> no genera carta automáticamente ({sel!.reason}). El generador se
              niega a inventar estadísticas cuando no hay métricas, así que la única vía es que una
              persona las autorice y explique por qué. La carta quedará marcada como{" "}
              <code className="text-drl-gold">editorial</code>.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["stronghold", "gamesense", "entryfrag"] as const).map((k) => (
                <label key={k} className="min-w-0">
                  <span className="font-display text-label uppercase tracking-wider text-white/50">{k}</span>
                  <input
                    type="number" inputMode="numeric" min={1} max={99}
                    value={editorial[k]}
                    onChange={(e) => setEditorial({ ...editorial, [k]: e.target.value })}
                    aria-label={k}
                    className="mt-1 min-h-[44px] w-full border border-white/15 bg-base-800 px-3 text-sm text-white outline-none focus-visible:border-drl"
                  />
                </label>
              ))}
            </div>
            <label className="block">
              <span className="font-display text-label uppercase tracking-wider text-white/50">
                Justificación del trío (obligatoria)
              </span>
              <textarea
                rows={2} value={editorial.reason}
                onChange={(e) => setEditorial({ ...editorial, reason: e.target.value })}
                placeholder="De dónde salen estos números y quién los autoriza"
                className="mt-1 w-full resize-y border border-white/15 bg-base-800 px-3 py-2 text-sm text-white outline-none focus-visible:border-drl"
              />
            </label>
          </Plate>
        </section>
      )}

      {/* ── Motivo y alta ── */}
      <section aria-labelledby="h-alta">
        <h2 id="h-alta" className="mb-2 font-display text-label uppercase tracking-widest text-white/40">
          {necesitaEditorial ? "4" : "3"} · Crear
        </h2>
        <Plate className="space-y-3 p-4">
          <label className="block">
            <span className="font-display text-label uppercase tracking-wider text-white/50">
              Motivo del alta (queda registrado)
            </span>
            <textarea
              rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Por qué se crea esta carta"
              className="mt-1 w-full resize-y border border-white/15 bg-base-800 px-3 py-2 text-sm text-white outline-none focus-visible:border-drl"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <NxButton variant="primary" disabled={!puedeCrear} onClick={() => void crear()}>
              {running ? "Creando…" : "Crear como borrador"}
            </NxButton>
            <p className="text-[12px] text-white/40">
              Nace en <strong>DRAFT</strong>: existe en la base de datos, pero no está en el catálogo
              jugable, no entra en pools activos y no puede salir en sobres. Publicar es el paso
              siguiente, desde su ficha.
            </p>
          </div>
        </Plate>
      </section>

      <Rail label="Las estadísticas las deriva el dominio; el panel solo elige jugador y variante" />
    </Stage>
  );
}
