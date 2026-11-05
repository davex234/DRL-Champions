/**
 * ARNÉS QA · FASE 38 — FOTOS QA SYNTHETIC de la apertura.
 *
 * Los RESULTADOS de estas escenas (uids, qué carta sale, seriales, la colección de antes) son INVENTADOS para revisar
 * estados que un sobre real rara vez da (legendaria, serial #1, set completado…). Lo real: el catálogo (cartas,
 * rarezas, stats, equipos, sobres) y el dominio que presenta (`buildRevealPlan`, el mismo de la ceremonia). Ninguna
 * escena es una apertura de un jugador y ninguna decide nada del sorteo.
 */
import type { CardDef } from "@/domain/cards/types";
import { CARDS, getPlayer } from "@/data/catalog";
import { PACKS, getPack } from "@/data/packs";
import { getVariant } from "@/domain/cards/variants";
import { rarityOf, cardTeamKeyOf, type OwnedInstanceFact } from "@/domain/collection/room";
import type { OpenedInstance } from "@/domain/packs/reveal";
import type { RarityBucket } from "@/domain/packs/types";
import type { PackStatusKind } from "@/components/packs/PackStatus";
import type { StageKind } from "@/components/packs/PackStage";
import { qaSerializedCard } from "@/app/design-system/serialFixture";
// ANTES de cualquier captura de `CARDS`: la carta de QA se da de alta y todo el proceso ve el mismo catálogo.
export const SERIALIZED = qaSerializedCard() /* catálogo diseñado sin serializadas: carta local de QA */;

let seq = 0;
const uid = () => `00000038-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const op = (c: CardDef, serial: number | null = null): OpenedInstance => ({ uid: uid(), cardId: c.id, serial, mintedVersion: 1 });
const own = (c: CardDef, serial: number | null = null): OwnedInstanceFact => ({ uid: uid(), cardId: c.id, serial, mintedVersion: 1 });

const player = (c: CardDef) => getPlayer(c.playerId)!;
const byRarity = (r: RarityBucket) => CARDS.filter((c) => rarityOf(c) === r);
const pick = (r: RarityBucket, i = 0, ...exclude: CardDef[]) => byRarity(r).filter((c) => !exclude.some((e) => e.playerId === c.playerId))[i];

export const COMMONS = byRarity("common");
export const LEGEND = pick("legendary");
export const EPIC = pick("epic", 0, LEGEND);
export const RARE = pick("rare", 0, LEGEND, EPIC);
export const UNCOMMON = pick("uncommon", 0, LEGEND, EPIC, RARE);
export const COMMON = pick("common", 0, LEGEND, EPIC, RARE, UNCOMMON);
const MULTI = (() => { const m = new Map<string, CardDef[]>(); for (const c of CARDS) m.set(c.playerId, [...(m.get(c.playerId) ?? []), c]); return [...m.values()].find((v) => v.length >= 3 && v.every((c) => ![LEGEND, EPIC, RARE, UNCOMMON, COMMON].some((x) => x.playerId === c.playerId)))!; })();
export const LONG = [...CARDS].sort((a, b) => `${player(b).nick} ${player(b).team}`.length - `${player(a).nick} ${player(a).team}`.length || a.id.localeCompare(b.id))[0];
const TEAM = (() => {
  const m = new Map<string, CardDef[]>();
  for (const c of CARDS) { const k = cardTeamKeyOf(c, player(c)).key; m.set(k, [...(m.get(k) ?? []), c]); }
  return [...m.values()].filter((v) => v.length >= 5).sort((a, b) => a.length - b.length)[0];
})();

/** La colección de «antes» de un jugador con 30 definiciones y ninguna legendaria. */
const BASE_OWNED = COMMONS.filter((c) => ![COMMON].some((x) => x.id === c.id)).slice(0, 26).map((c) => own(c));
const BEFORE: OwnedInstanceFact[] = [...BASE_OWNED, own(MULTI[0]), own(COMMON), own(COMMON), own(UNCOMMON)];

export const STD = getPack("estandar")!;
export const PREMIUM = getPack("premium")!;
export const TEAM_PACK = PACKS.find((p) => p.team && p.lifecycle === "ACTIVE") ?? PACKS.find((p) => p.team) ?? STD;

export interface PlanFixture { opened: OpenedInstance[]; before: OwnedInstanceFact[] | null }

const MIXED: PlanFixture = { before: BEFORE, opened: [op(COMMON), op(MULTI[1]), op(UNCOMMON), op(RARE), op(EPIC)] };
const ALL_NEW: PlanFixture = { before: BEFORE, opened: [op(COMMONS[40]), op(COMMONS[41]), op(pick("uncommon", 5)), op(pick("rare", 3)), op(pick("rare", 4))] };
const ALL_DUP: PlanFixture = { before: BEFORE, opened: BASE_OWNED.slice(0, 5).map((f) => op(CARDS.find((c) => c.id === f.cardId)!)) };
const SAME_TWICE: PlanFixture = { before: BEFORE, opened: [op(COMMONS[50]), op(COMMONS[50]), op(UNCOMMON), op(RARE), op(COMMON)] };
const FIRST_LEGEND: PlanFixture = { before: BEFORE, opened: [op(COMMONS[60]), op(COMMON), op(UNCOMMON), op(RARE), op(LEGEND)] };
const SERIAL_ONE: PlanFixture = { before: BEFORE, opened: [op(COMMONS[61]), op(UNCOMMON), op(RARE), op(SERIALIZED, 1)] };
const SERIALS: PlanFixture = { before: BEFORE, opened: [op(SERIALIZED, 250), op(SERIALIZED, 88), op(SERIALIZED, 7), op(SERIALIZED, 1)] };
const SET_COMPLETE: PlanFixture = { before: [...BEFORE, ...TEAM.slice(0, -1).map((c) => own(c))], opened: [op(COMMONS[70]), op(TEAM[TEAM.length - 1]), op(UNCOMMON)] };
const NO_BEFORE: PlanFixture = { before: null, opened: [op(COMMON), op(UNCOMMON), op(RARE), op(EPIC), op(COMMONS[80])] };
const LONG_NAMES: PlanFixture = { before: BEFORE, opened: [op(LONG), op(COMMON), op(UNCOMMON)] };

export type Scene =
  | { kind: "stage"; note: string; stage: StageKind; pack: "std" | "premium" | "team"; plan?: PlanFixture; reduced?: boolean }
  | { kind: "reveal"; note: string; plan: PlanFixture; index: number; revealed: boolean; reduced?: boolean }
  | { kind: "summary"; note: string; plan: PlanFixture; available: number; packsLeft: number; recovered?: boolean; repeated?: boolean; reduced?: boolean }
  | { kind: "status"; note: string; status: PackStatusKind; title: string; message: string; packsLeft: number; retry?: boolean };

const stage = (note: string, s: StageKind, o: Partial<Extract<Scene, { kind: "stage" }>> = {}): Scene => ({ kind: "stage", note, stage: s, pack: "std", ...o });
const reveal = (note: string, plan: PlanFixture, index: number, revealed = true, reduced = false): Scene => ({ kind: "reveal", note, plan, index, revealed, reduced });
const summary = (note: string, plan: PlanFixture, o: Partial<Extract<Scene, { kind: "summary" }>> = {}): Scene => ({ kind: "summary", note, plan, available: 0, packsLeft: 0, ...o });
const single = (c: CardDef, before: OwnedInstanceFact[] = BEFORE, serial: number | null = null): PlanFixture => ({ before, opened: [op(c, serial)] });

export const SCENES: Record<string, Scene> = {
  "stage-ready": stage("sobre estándar antes de abrir", "ready"),
  "stage-ready-premium": stage("sobre premium antes de abrir", "ready", { pack: "premium" }),
  "stage-ready-team": stage("sobre de equipo (probabilidad aumentada, sin garantía)", "ready", { pack: "team" }),
  "stage-requesting": stage("petición enviada, esperando al servidor (sin rareza)", "requesting"),
  "stage-opening": stage("resultado recibido: rotura del sello", "opening", { plan: MIXED }),
  "stage-hand-low": stage("cartas boca abajo · mejor rareza común/poco común", "hand", { plan: ALL_DUP }),
  "stage-hand-mid": stage("cartas boca abajo · mejor rareza rara", "hand", { plan: SAME_TWICE }),
  "stage-hand-high": stage("cartas boca abajo · mejor rareza épica", "hand", { plan: MIXED }),
  "stage-hand-legendary": stage("cartas boca abajo · legendaria dentro (corona)", "hand", { plan: FIRST_LEGEND }),
  "stage-reduced-ready": stage("movimiento reducido · antes de abrir", "ready", { reduced: true }),
  "stage-reduced-hand": stage("movimiento reducido · mano", "hand", { plan: FIRST_LEGEND, reduced: true }),
  "reveal-back-common": reveal("anticipación de una común (rápida)", single(COMMONS[90]), 0, false),
  "reveal-back-legendary": reveal("anticipación de una legendaria (heraldo real)", single(LEGEND), 0, false),
  "reveal-back-serial-one": reveal("anticipación del serial #1", single(SERIALIZED, BEFORE, 1), 0, false),
  "reveal-common": reveal("común revelada", single(COMMONS[91]), 0),
  "reveal-uncommon": reveal("poco común revelada", single(pick("uncommon", 7)), 0),
  "reveal-rare": reveal("rara revelada", single(RARE), 0),
  "reveal-epic": reveal("épica revelada", single(EPIC), 0),
  "reveal-legendary": reveal("legendaria revelada", single(LEGEND), 0),
  "reveal-new": reveal("nueva en tu colección", MIXED, 3),
  "reveal-duplicate": reveal("duplicada ×3", MIXED, 0),
  "reveal-new-variant": reveal("nueva variante (jugador ya poseído)", MIXED, 1),
  "reveal-same-twice-first": reveal("misma carta dos veces · la primera es nueva", SAME_TWICE, 0),
  "reveal-same-twice-second": reveal("misma carta dos veces · la segunda es duplicada ×2", SAME_TWICE, 1),
  "reveal-serial-normal": reveal("serial normal (#250)", SERIALS, 0),
  "reveal-serial-top100": reveal("serial Top 100 (#88)", SERIALS, 1),
  "reveal-serial-top10": reveal("serial Top 10 (#7)", SERIALS, 2),
  "reveal-serial-one": reveal("serial #1 (momento propio)", SERIALS, 3),
  "reveal-unknown-status": reveal("sin foto de colección: no se afirma nueva/duplicada", NO_BEFORE, 2),
  "reveal-artwork-fallback": reveal("sin artwork de la versión: retrato de reserva NEXUS", single(EPIC), 0),
  "reveal-long-names": reveal("nombre y equipo más largos del catálogo", LONG_NAMES, 0),
  "reveal-reduced-legendary": reveal("movimiento reducido · legendaria", single(LEGEND), 0, true, true),
  "reveal-reduced-back": reveal("movimiento reducido · anticipación", single(RARE), 0, false, true),
  "summary-mixed": summary("sobre mezclado: nuevas, variante y duplicada", MIXED),
  "summary-all-new": summary("todas nuevas: la colección sube tantas definiciones como cartas", ALL_NEW),
  "summary-all-duplicates": summary("todas duplicadas: X → X, sin fingir progreso", ALL_DUP),
  "summary-same-twice": summary("misma carta dos veces", SAME_TWICE),
  "summary-first-legendary": summary("primera legendaria", FIRST_LEGEND),
  "summary-serial-one": summary("serial #1 destacado", SERIAL_ONE),
  "summary-set-complete": summary("set completado (reconocimiento, sin recompensa)", SET_COMPLETE),
  "summary-open-another": summary("quedan 3 de este sobre: abrir otro", MIXED, { available: 3, packsLeft: 5 }),
  "summary-inventory": summary("sin más de este sobre, pero con otros sobres", MIXED, { available: 0, packsLeft: 4 }),
  "summary-no-more": summary("sin sobres: ver sobres", ALL_NEW, { available: 0, packsLeft: 0 }),
  "summary-recovered": summary("recuperado tras recarga (el sobre ya se abrió)", MIXED, { recovered: true }),
  "summary-repeated": summary("respuesta repetida del servidor (misma operación)", MIXED, { repeated: true }),
  "summary-collection-unavailable": summary("colección no disponible: cartas sí, progreso no", NO_BEFORE),
  "summary-long-names": summary("nombres largos", LONG_NAMES),
  "summary-reduced": summary("movimiento reducido", FIRST_LEGEND, { reduced: true }),
  "status-recovering": { kind: "status", note: "recarga con la apertura enviada: recuperando", status: "recovering", title: "Recuperando tu sobre", message: "Había una apertura en marcha en esta pestaña. Estamos pidiendo al servidor su resultado — no se abre ningún sobre nuevo.", packsLeft: 2 },
  "status-network-error": { kind: "status", note: "red caída antes de confirmar", status: "error", title: "Se perdió la conexión", message: "La conexión se cortó mientras se abría el sobre. Reintenta: si el servidor ya lo abrió, recuperarás exactamente las mismas cartas.", packsLeft: 1, retry: true },
  "status-server-error": { kind: "status", note: "error del servidor", status: "error", title: "No se pudo abrir", message: "El servidor no pudo completar la apertura. Reintentar es seguro: si llegó a abrirse recuperas las mismas cartas; si no, el sobre sigue en tu inventario.", packsLeft: 1, retry: true },
  "status-already-opened": { kind: "status", note: "otra pestaña ya lo abrió", status: "no_pack", title: "No te queda este sobre", message: "No queda ninguna unidad de este sobre. Si lo abriste en otra pestaña, tus cartas ya están en tu colección.", packsLeft: 0 },
  "status-missing": { kind: "status", note: "no tienes este sobre", status: "missing", title: "No tienes este sobre", message: "No queda ninguna unidad de «Sobre Estándar» en tu inventario. Consigue uno en la tienda o revisa los que ya tienes pendientes.", packsLeft: 3 },
  "status-unavailable": { kind: "status", note: "sobre DRAFT", status: "unavailable", title: "Sobre no disponible", message: "Este sobre no está disponible para abrir ahora mismo. Echa un vistazo al resto del catálogo.", packsLeft: 0 },
  "status-not-found": { kind: "status", note: "enlace a un sobre inexistente", status: "not_found", title: "Ese sobre no existe", message: "El enlace apunta a un sobre que no está en el catálogo.", packsLeft: 0 },
  "status-offline": { kind: "status", note: "sin conexión al pulsar abrir", status: "error", title: "Se perdió la conexión", message: "La conexión se cortó mientras se abría el sobre. Reintenta: si el servidor ya lo abrió, recuperarás exactamente las mismas cartas.", packsLeft: 2, retry: true },
};
