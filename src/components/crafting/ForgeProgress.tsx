"use client";

/**
 * F79 · NEXUS FORGE 2.0 — piezas de PROGRESIÓN y de FORJA SEGURA. Solo presentación: nivel, XP, maestría, qué se puede
 * entregar y qué sale lo decide el servidor (`/api/game/forge`); aquí se pinta y se elige, y el servidor lo revalida todo.
 *
 *   LevelCore         núcleo hexagonal que EVOLUCIONA con el nivel real (anillos, brillo, ritmo). Reducido: estático.
 *   XpBar · Mastery   progreso al siguiente nivel y rangos por rama (texto + barras: nunca solo color).
 *   useMaterialPick   estado del selector: copias por carta y hueco, protegidas solo si se piden expresamente.
 *   MaterialSelector  cartas elegibles por hueco: jugador, OVR, edición, copias, entregables, protección.
 *   ForgeConfirm      «VAS A ENTREGAR / RECIBIRÁS»: lo que desaparece, lo que se conserva y lo que sale.
 *   forgeErrorText    errores del servidor → frases (nunca JSON crudo).
 */
import { useCallback, useMemo, useState } from "react";
import { getCard } from "@/data/catalog";
import { VARIANTS } from "@/domain/cards/variants";
import { autoFill, type SlotMaterials } from "@/domain/forge/selector";
import type { RecipeOutput } from "@/domain/forge/types";
import type { MasteryView } from "@/domain/forge/progression";
import { NxButton } from "@/components/ui/NxButton";
import { cn } from "@/lib/format";
import { CardImage, cardName, classLabel } from "./CraftingUi";
import { MysteryCard } from "./Forge";
import p from "./forgeProgress.module.css";

/* ═══════════════════ errores ═══════════════════ */

const ERRORS: Record<string, string> = {
  RECIPE_LOCKED: "Esta receta aún está bloqueada. Cumple sus condiciones para descubrirla.",
  RECIPE_COMPLETED: "Ya completaste esta receta: es un paso único de su cadena.",
  RECIPE_UNAVAILABLE: "Esta receta ya no está disponible.",
  RECIPE_NOT_FOUND: "Esta receta ya no está disponible.",
  RECIPE_DISABLED: "Esta receta no está activa ahora mismo.",
  OWN_UNMET: "Te falta POSEER lo que pide la receta (no se consume, solo se comprueba).",
  PROTECTED_COPY: "Has elegido una carta protegida (favorita o en tu vitrina). Confírmala antes de forjar.",
  LAST_COPY: "No puedes entregar tu última copia de una carta.",
  NOT_ELIGIBLE: "Alguna carta ya no está disponible (cambió, está en un equipo o en venta). Recargamos tus materiales.",
  IN_DECK: "Alguna carta está en uno de tus equipos.",
  WRONG_COUNT: "Faltan o sobran cartas para esta receta.",
  DUPLICATE_INPUT: "Una carta no puede entregarse dos veces.",
  SLOT_MISMATCH: "Alguna carta no encaja en los huecos de la receta.",
  EMPTY_POOL: "No hay cartas disponibles para esta forja ahora mismo.",
  RATE_LIMITED: "Vas muy rápido. Espera un momento y vuelve a intentarlo.",
  MIGRATION_PENDING: "La forja aún no está disponible.",
  NO_REWARD: "Esto no tiene recompensa que reclamar.",
  NOT_COMPLETED: "Todavía no está completado.",
  PROJECT_REQUIREMENTS: "Te faltan etapas del proyecto (reunir o fabricar).",
};
export function forgeErrorText(e: unknown): string {
  const code = (e as { code?: string | null })?.code ?? null;
  const status = (e as { status?: number })?.status ?? 0;
  if (code && ERRORS[code]) return ERRORS[code];
  if (status === 401) return "Tu sesión caducó. Vuelve a entrar.";
  if (status === 0 || status >= 500 || e instanceof TypeError) return "No hemos podido hablar con el servidor. Comprueba tu conexión y vuelve a intentarlo: si la forja ya se hizo, no se repetirá ni se entregará nada dos veces.";
  const msg = e instanceof Error ? e.message : "";
  return msg && !/^\s*[{[]/.test(msg) ? msg : "No se pudo completar la forja.";
}

export const variantLabel = (v: string) => (VARIANTS as Record<string, { label?: string }>)[v]?.label ?? v;

/* ═══════════════════ núcleo, XP, maestría ═══════════════════ */

const TIER_GLOW = ["#ff2e63", "#19e3ff", "#a970ff", "#ffce4f", "#fff1b8"];
export const coreTier = (level: number) => Math.min(4, Math.floor((Math.max(1, level) - 1) / 8));

export function LevelCore({ level, maxLevel, size = 180, label = true }: { level: number; maxLevel: number; size?: number; label?: boolean }) {
  const tier = coreTier(level);
  const power = Math.min(1, 0.15 + (level - 1) / Math.max(1, maxLevel - 1));
  const rings = 1 + tier;
  return (
    <span className={p.core} style={{ width: size, height: size, ["--core-power" as string]: String(power), ["--core-glow" as string]: TIER_GLOW[tier] }} data-testid="forge-level-core" data-tier={tier} aria-hidden={!label}>
      <svg viewBox="0 0 200 200" aria-hidden>
        <polygon points="100,8 180,54 180,146 100,192 20,146 20,54" fill="rgba(10,11,19,0.92)" stroke="currentColor" strokeWidth="2.5" />
        {Array.from({ length: rings }, (_, i) => {
          const r = 70 - i * 11;
          const pts = [0, 1, 2, 3, 4, 5].map((k) => { const a = (Math.PI / 3) * k - Math.PI / 2; return `${100 + r * Math.cos(a)},${100 + r * Math.sin(a)}`; }).join(" ");
          return <g key={i} className={p.ring}><polygon points={pts} fill="none" stroke="currentColor" strokeWidth={1.4} strokeDasharray={i % 2 ? "3 6" : "10 5"} opacity={0.85 - i * 0.12} /></g>;
        })}
        <circle cx="100" cy="100" r={18 + tier * 3} fill="currentColor" opacity="0.18" className={p.pulse} />
      </svg>
      {label && (
        <span className={p.level}>
          <span className="font-display text-[11px] font-bold uppercase tracking-[0.3em] text-white/60">Nivel</span>
          <span className="nx-readout text-white" style={{ fontSize: Math.round(size * 0.3), lineHeight: 1 }} data-testid="forge-level">{level}</span>
        </span>
      )}
    </span>
  );
}

export function XpBar({ into, need, total, maxed }: { into: number; need: number; total: number; maxed: boolean }) {
  const pct = maxed ? 100 : need > 0 ? Math.min(100, Math.round((into / need) * 100)) : 0;
  return (
    <div className="w-full space-y-1.5">
      <div className={p.xp} role="progressbar" aria-label="Experiencia de Forja" aria-valuemin={0} aria-valuemax={maxed ? 1 : need} aria-valuenow={maxed ? 1 : into} data-testid="forge-xp">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="flex justify-between text-[12px] font-bold uppercase tracking-[0.14em] text-white/60">
        <span>{maxed ? "Nivel máximo" : <><b className="nx-readout text-white">{into.toLocaleString("es-ES")}</b> / {need.toLocaleString("es-ES")} XP</>}</span>
        <span>Total {total.toLocaleString("es-ES")} XP</span>
      </p>
    </div>
  );
}

const BRANCH_GLOW: Record<string, string> = { SOBRES: "#ffce4f", INTERCAMBIO: "#19e3ff", PROYECTOS: "#a970ff", COLECCION: "#3ee08f" };
export function MasteryGrid({ mastery }: { mastery: MasteryView[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Maestría de Forja" data-testid="forge-mastery">
      {mastery.map((m) => (
        <li key={m.branch} className="border border-white/10 bg-white/[0.03] px-3 py-3" data-branch={m.branch} data-rank={m.rank} style={{ ["--pip" as string]: BRANCH_GLOW[m.branch] ?? "#19e3ff" }}>
          <p className="font-display text-[12px] font-bold uppercase tracking-[0.14em] text-white/70">{m.label}</p>
          <p className="mt-1 flex items-baseline gap-2"><b className="nx-readout text-[24px] leading-none text-white">R{m.rank}</b><span className="text-[11px] uppercase tracking-[0.1em] text-white/45">de {m.maxRank}</span></p>
          <div className={cn(p.pips, "mt-2")} aria-hidden>{Array.from({ length: m.maxRank }, (_, i) => <i key={i} className={i < m.rank ? p.on : undefined} />)}</div>
          <p className="mt-2 text-[11px] text-white/55">{m.next === null ? "Rama completada" : <>{m.value} / {m.next} para el rango {m.rank + 1}</>}</p>
        </li>
      ))}
    </ul>
  );
}

/* ═══════════════════ selección de materiales ═══════════════════ */

type PickKey = `${number}:${string}`;
export interface MaterialPick {
  counts: Record<PickKey, number>;
  allowProtected: Record<string, boolean>;
  add: (slot: number, cardId: string) => void;
  remove: (slot: number, cardId: string) => void;
  toggleProtected: (cardId: string) => void;
  clear: () => void;
  auto: () => number;
  /** uids en el orden de los huecos (lo que se manda al servidor). */
  uids: string[];
  /** De esos, los protegidos (se mandan como confirmación expresa). */
  protectedUids: string[];
  pickedInSlot: (slot: number) => number;
  complete: boolean;
}

/** Copias que se pueden usar de una carta según el modo (protegidas solo si se permiten), respetando su tope. */
function freeFor(c: SlotMaterials["candidates"][number], allow: boolean) {
  const unprot = c.free.filter((f) => f.protectedBy.length === 0);
  const prot = allow ? c.free.filter((f) => f.protectedBy.length > 0) : [];
  return [...unprot, ...prot].slice(0, c.usable);
}

export function useMaterialPick(materials: SlotMaterials[] | null): MaterialPick {
  const [counts, setCounts] = useState<Record<PickKey, number>>({});
  const [allowProtected, setAllow] = useState<Record<string, boolean>>({});
  const mats = useMemo(() => materials ?? [], [materials]);
  const usedOfCard = useCallback((cardId: string, c = counts) => Object.entries(c).filter(([k]) => k.endsWith(`:${cardId}`)).reduce((s, [, n]) => s + n, 0), [counts]);
  const pickedInSlot = useCallback((slot: number) => Object.entries(counts).filter(([k]) => k.startsWith(`${slot}:`)).reduce((s, [, n]) => s + n, 0), [counts]);
  const add = (slot: number, cardId: string) => {
    const m = mats[slot]; const c = m?.candidates.find((x) => x.cardId === cardId);
    if (!m || !c || pickedInSlot(slot) >= m.need || usedOfCard(cardId) >= freeFor(c, !!allowProtected[cardId]).length) return;
    setCounts((s) => ({ ...s, [`${slot}:${cardId}`]: (s[`${slot}:${cardId}` as PickKey] ?? 0) + 1 }));
  };
  const remove = (slot: number, cardId: string) => setCounts((s) => { const k = `${slot}:${cardId}` as PickKey; const n = (s[k] ?? 0) - 1; const q = { ...s }; if (n <= 0) delete q[k]; else q[k] = n; return q; });
  const toggleProtected = (cardId: string) => {
    const next = !allowProtected[cardId];
    setAllow((a) => ({ ...a, [cardId]: next }));
    if (!next) setCounts((s) => { // al retirar el permiso, se quitan las copias que ya no caben
      const c = mats.flatMap((m) => m.candidates).find((x) => x.cardId === cardId); if (!c) return s;
      const cap = freeFor(c, false).length; let used = 0; const q = { ...s };
      for (const k of Object.keys(q) as PickKey[]) if (k.endsWith(`:${cardId}`)) { const keep = Math.max(0, Math.min(q[k], cap - used)); used += keep; if (keep) q[k] = keep; else delete q[k]; }
      return q;
    });
  };
  const clear = () => { setCounts({}); };
  const auto = () => {
    const a = autoFill(mats);
    const next: Record<PickKey, number> = {};
    a.bySlot.forEach((uids, slot) => { for (const u of uids) { const c = mats[slot].candidates.find((x) => x.free.some((f) => f.uid === u)); if (c) next[`${slot}:${c.cardId}`] = (next[`${slot}:${c.cardId}`] ?? 0) + 1; } });
    setCounts(next);
    return a.missing;
  };
  // Reparto de uids: por carta, primero las no protegidas y, si se permitió, las protegidas; nunca más de su tope.
  const { uids, protectedUids } = useMemo(() => {
    const taken = new Map<string, number>();
    const out: string[] = []; const prot: string[] = [];
    mats.forEach((m) => {
      for (const c of m.candidates) {
        const n = counts[`${m.index}:${c.cardId}` as PickKey] ?? 0; if (!n) continue;
        const list = freeFor(c, !!allowProtected[c.cardId]);
        const start = taken.get(c.cardId) ?? 0;
        for (const f of list.slice(start, start + n)) { out.push(f.uid); if (f.protectedBy.length) prot.push(f.uid); }
        taken.set(c.cardId, start + n);
      }
    });
    return { uids: out, protectedUids: prot };
  }, [mats, counts, allowProtected]);
  const complete = mats.length > 0 && mats.every((m) => pickedInSlot(m.index) === m.need) && uids.length === mats.reduce((s, m) => s + m.need, 0);
  return { counts, allowProtected, add, remove, toggleProtected, clear, auto, uids, protectedUids, pickedInSlot, complete };
}

export function MaterialSelector({ materials, pick, testId = "material-selector" }: { materials: SlotMaterials[]; pick: MaterialPick; testId?: string }) {
  return (
    <div className="space-y-5" data-testid={testId}>
      {materials.map((m) => {
        const picked = pick.pickedInSlot(m.index);
        return (
          <section key={m.index} aria-label={`Hueco ${m.index + 1}`} className="space-y-2" data-testid="material-slot" data-slot={m.index}>
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-display text-[14px] font-bold uppercase tracking-[0.12em] text-white">
                Entregas {m.need} × {classLabel(m.slot.class)}{m.slot.variantId ? ` · ${variantLabel(m.slot.variantId)}` : ""}{m.slot.team ? ` · ${m.slot.team}` : ""}
              </p>
              <p className="nx-readout text-[18px] tabular-nums" aria-live="polite"><span className={picked === m.need ? "text-[#3ee08f]" : "text-white"}>{picked}</span><span className="text-white/40"> / {m.need}</span></p>
            </header>
            {m.candidates.length === 0 ? (
              <p className="border border-white/10 bg-white/[0.02] px-4 py-3 text-[14px] text-white/65">No tienes duplicados que encajen. Solo cuentan copias repetidas fuera de tus equipos y sin contar tu última copia.</p>
            ) : (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {m.candidates.map((c) => {
                  const n = pick.counts[`${m.index}:${c.cardId}` as PickKey] ?? 0;
                  const protectedOnly = c.free.every((f) => f.protectedBy.length > 0);
                  const anyProtected = c.free.some((f) => f.protectedBy.length > 0);
                  const allow = !!pick.allowProtected[c.cardId];
                  const def = getCard(c.cardId);
                  const reason = c.free.find((f) => f.protectedBy.length)?.protectedBy.includes("SHOWCASE") ? "Vitrina" : "Favorita";
                  return (
                    <li key={c.cardId} className={cn(p.cand, "flex flex-col gap-1.5 p-1.5")} data-testid="material-candidate" data-card={c.cardId} data-picked={n > 0} data-protected={anyProtected}>
                      {anyProtected && <span className={p.lockMark}>★ {reason}</span>}
                      <button type="button" onClick={() => pick.add(m.index, c.cardId)} disabled={(protectedOnly && !allow) || picked >= m.need}
                        aria-label={`Añadir ${cardName(c.cardId)} (${c.ovr}), ${n} elegidas de ${c.usable} entregables`} className="nx-focus relative block w-full disabled:cursor-not-allowed" data-testid="material-add">
                        <CardImage cardId={c.cardId} width={160} className={cn("!w-full", protectedOnly && !allow && "opacity-55")} />
                        {n > 0 && <span aria-hidden className="absolute right-1 top-1 grid h-7 min-w-7 place-items-center rounded-full bg-drl-cyan px-1 font-display text-[14px] font-extrabold text-black">✓{n > 1 ? n : ""}</span>}
                      </button>
                      <p className="truncate text-[11px] font-bold uppercase tracking-[0.06em] text-white/80" title={cardName(c.cardId)}>{def ? cardName(c.cardId) : c.cardId}</p>
                      <p className="text-[10px] uppercase tracking-[0.08em] text-white/50">OVR {c.ovr} · {variantLabel(c.variantId)}</p>
                      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-white/55">×{c.copies} · {c.usable} entregable{c.usable === 1 ? "" : "s"}</p>
                      <div className="flex gap-1">
                        {n > 0 && <button type="button" onClick={() => pick.remove(m.index, c.cardId)} className="nx-focus flex-1 border border-white/20 py-1 text-[12px] font-bold text-white hover:bg-white/10" aria-label={`Quitar una copia de ${cardName(c.cardId)}`} data-testid="material-remove">−</button>}
                        {anyProtected && <button type="button" onClick={() => pick.toggleProtected(c.cardId)} aria-pressed={allow} className={cn("nx-focus flex-1 border py-1 text-[10px] font-bold uppercase tracking-[0.06em]", allow ? "border-drl-gold bg-drl-gold/15 text-drl-gold" : "border-white/15 text-white/60")} data-testid="material-allow-protected">{allow ? "Protegida: usar" : "Usar protegida"}</button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function AutoSelectBar({ pick, onAuto }: { pick: MaterialPick; onAuto?: (missing: number) => void }) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NxButton variant="ghost" size="sm" onClick={() => { const missing = pick.auto(); setNote(missing > 0 ? `Faltan ${missing} carta${missing === 1 ? "" : "s"}: sin protegidas ni últimas copias no llega.` : "Selección propuesta: duplicados primero y de menor valor. Revísala antes de forjar."); onAuto?.(missing); }} data-testid="forge-autoselect">Auto-seleccionar</NxButton>
      <NxButton variant="ghost" size="sm" onClick={() => { pick.clear(); setNote(null); }}>Vaciar</NxButton>
      {note && <p className="text-[12px] text-white/65" role="status">{note}</p>}
    </div>
  );
}

/* ═══════════════════ confirmación ═══════════════════ */

export function ForgeConfirm({ uids, protectedUids, materials, output, ownNote }: { uids: string[]; protectedUids: string[]; materials: SlotMaterials[]; output: RecipeOutput; ownNote?: string[] }) {
  const cardByUid = new Map(materials.flatMap((m) => m.candidates.flatMap((c) => c.free.map((f) => [f.uid, c.cardId] as const))));
  const grouped = new Map<string, { n: number; prot: number }>();
  for (const u of uids) { const id = cardByUid.get(u) ?? "?"; const g = grouped.get(id) ?? { n: 0, prot: 0 }; g.n++; if (protectedUids.includes(u)) g.prot++; grouped.set(id, g); }
  return (
    <div className="space-y-4" data-testid="forge-confirm">
      <section aria-label="Vas a entregar">
        <p className="font-display text-[13px] font-bold uppercase tracking-[0.2em] text-drl">Vas a entregar · desaparecen</p>
        <ul className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
          {[...grouped.entries()].map(([id, g]) => (
            <li key={id} className="relative text-center" data-testid="forge-confirm-item" data-card={id} data-qty={g.n}>
              <CardImage cardId={id} width={72} className="!w-full" />
              <span className="absolute right-0.5 top-0.5 rounded bg-black/80 px-1 text-[11px] font-bold text-white">×{g.n}</span>
              {g.prot > 0 && <span className="mt-0.5 block text-[10px] font-bold uppercase text-drl-gold">★ {g.prot} protegida{g.prot > 1 ? "s" : ""}</span>}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-white/60">De cada carta conservas al menos una copia. {protectedUids.length > 0 && <b className="text-drl-gold">Incluye {protectedUids.length} copia{protectedUids.length > 1 ? "s" : ""} protegida{protectedUids.length > 1 ? "s" : ""} que has confirmado.</b>}</p>
      </section>
      {ownNote && ownNote.length > 0 && (
        <section aria-label="Se comprueba, no se consume">
          <p className="font-display text-[12px] font-bold uppercase tracking-[0.2em] text-[#3ee08f]">Se comprueba · NO se consume</p>
          <ul className="mt-1 space-y-0.5 text-[12px] text-white/70">{ownNote.map((t) => <li key={t}>✓ {t}</li>)}</ul>
        </section>
      )}
      <section aria-label="Recibirás" className="flex flex-col items-center gap-2">
        <p className="font-display text-[13px] font-bold uppercase tracking-[0.2em] text-[#3ee08f]">Recibirás</p>
        {output.type === "CARD" ? <CardImage cardId={output.cardId} width={120} /> : <MysteryCard cls={output.class} width={110} />}
        <p className="text-[12px] text-white/60">{output.type === "CARD" ? cardName(output.cardId) : `Una carta ${classLabel(output.class)} al azar entre las publicadas (la decide el servidor).`}</p>
      </section>
    </div>
  );
}

