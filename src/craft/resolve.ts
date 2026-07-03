/**
 * RESOLUCIÓN DE ENTRADAS/SALIDAS (Collection Fase 4/7).
 *
 * Selecciona de forma DETERMINISTA las instancias a consumir (o valida la selección del usuario) y
 * resuelve la carta de SALIDA reutilizando el `CardRegistry` (catálogo). La salida SIEMPRE es un cardId
 * que YA EXISTE (misma identidad de jugador): nunca inventa una carta. Nunca consume cartas bloqueadas
 * salvo que la receta lo permita. Puro y determinista.
 */
import type { CardRegistry, OwnershipIndex } from "@/collection";
import { makeCardId } from "@/collection";
import { bucketForRank } from "@/domain/packs/types";
import { BUCKETS } from "./materials";
import type { InputMatch, OutputSpec, OwnedCard, CraftIssue } from "./types";

const bidx = (b: ReturnType<typeof bucketForRank>): number => BUCKETS.indexOf(b);

/** ¿Cumple una instancia el criterio de entrada? (no evalúa bloqueo ni cantidad). */
function matchesInput(registry: CardRegistry, own: OwnershipIndex, o: OwnedCard, m: InputMatch): boolean {
  const def = registry.card(o.cardId);
  if (!def) return false;
  const v = registry.variant(def.variantId);
  const b = bidx(bucketForRank(v.rank));
  if (m.minBucket && b < bidx(m.minBucket)) return false;
  if (m.maxBucket && b > bidx(m.maxBucket)) return false;
  if (m.groups && !m.groups.includes(v.group)) return false;
  if (m.variants && !m.variants.includes(def.variantId)) return false;
  if (m.serialized != null && v.serialized !== m.serialized) return false;
  if (m.duplicatesOnly && own.countOf(o.cardId) <= 1) return false;
  return true;
}

/** Orden determinista: consume primero lo MENOS valioso (rango asc, serie más alta, uid). */
function worstFirst(registry: CardRegistry, a: OwnedCard, b: OwnedCard): number {
  const ra = registry.variant(registry.card(a.cardId)!.variantId).rank;
  const rb = registry.variant(registry.card(b.cardId)!.variantId).rank;
  if (ra !== rb) return ra - rb;
  const sa = a.serial ?? Infinity, sb = b.serial ?? Infinity;   // serie alta = peor = se consume antes
  if (sa !== sb) return sb - sa;
  return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
}

export interface InputResolution { picked: OwnedCard[]; issues: CraftIssue[] }

/** Selecciona (o valida) las `count` instancias de entrada. */
export function resolveInputs(
  registry: CardRegistry, own: OwnershipIndex, owned: OwnedCard[], m: InputMatch, locks: Set<string>, selection?: string[],
): InputResolution {
  const issues: CraftIssue[] = [];
  const allowLocked = !!m.allowLocked;
  if (m.count <= 0) return { picked: [], issues };

  // Selección explícita del usuario.
  if (selection && selection.length) {
    const byUid = new Map(owned.map((o) => [o.uid, o]));
    const picked: OwnedCard[] = [];
    for (const uid of selection) {
      const o = byUid.get(uid);
      if (!o) { issues.push({ code: "CARD_NOT_FOUND", message: `Instancia inexistente: ${uid}` }); continue; }
      if (!allowLocked && locks.has(uid)) { issues.push({ code: "LOCKED_CARD", message: `Carta bloqueada: ${uid}` }); continue; }
      if (!matchesInput(registry, own, o, m)) { issues.push({ code: "SELECTION_MISMATCH", message: `La carta no cumple la receta: ${uid}` }); continue; }
      picked.push(o);
    }
    if (picked.length < m.count) issues.push({ code: "NOT_ENOUGH_INPUTS", message: `Faltan entradas: ${picked.length}/${m.count}` });
    else if (m.samePlayer && new Set(picked.map((o) => registry.card(o.cardId)!.playerId)).size > 1) issues.push({ code: "NOT_SAME_PLAYER", message: "Las entradas deben ser del mismo jugador." });
    return { picked: picked.slice(0, m.count), issues };
  }

  // Selección AUTOMÁTICA determinista.
  const candidates = owned.filter((o) => (allowLocked || !locks.has(o.uid)) && matchesInput(registry, own, o, m)).sort((a, b) => worstFirst(registry, a, b));

  if (m.samePlayer) {
    const byPlayer = new Map<string, OwnedCard[]>();
    for (const o of candidates) { const p = registry.card(o.cardId)!.playerId; (byPlayer.get(p) ?? byPlayer.set(p, []).get(p)!).push(o); }
    const eligible = [...byPlayer.entries()].filter(([, list]) => list.length >= m.count).sort((a, b) => (a[0] < b[0] ? -1 : 1))[0];
    if (!eligible) { issues.push({ code: "NOT_ENOUGH_INPUTS", message: `Faltan entradas del mismo jugador: 0/${m.count}` }); return { picked: [], issues }; }
    return { picked: eligible[1].slice(0, m.count), issues };
  }

  if (candidates.length < m.count) issues.push({ code: "NOT_ENOUGH_INPUTS", message: `Faltan entradas: ${candidates.length}/${m.count}` });
  return { picked: candidates.slice(0, m.count), issues };
}

export interface OutputResolution { cardIds: string[]; issues: CraftIssue[] }

/** Resuelve la carta de salida (misma identidad; debe existir en el catálogo). */
export function resolveOutput(registry: CardRegistry, out: OutputSpec, picked: OwnedCard[]): OutputResolution {
  const issues: CraftIssue[] = [];
  if (out.mode === "materials") return { cardIds: [], issues };

  const anchor = picked[0];
  const playerId = anchor ? registry.card(anchor.cardId)?.playerId : undefined;
  const inputRank = anchor ? registry.variant(registry.card(anchor.cardId)!.variantId).rank : -1;

  let cardId: string | null = null;
  switch (out.mode) {
    case "explicit":
      cardId = out.cardId ?? null;
      break;
    case "variant":
      if (playerId && out.variant) cardId = makeCardId(playerId, out.variant);
      break;
    case "nextRank": {
      if (playerId) {
        const higher = registry.forPlayer(playerId).filter((c) => registry.variant(c.variantId).rank > inputRank).sort((a, b) => registry.variant(a.variantId).rank - registry.variant(b.variantId).rank);
        cardId = higher[0]?.id ?? null;
      }
      break;
    }
    case "group": {
      if (playerId && out.group) {
        const inGroup = registry.forPlayer(playerId).filter((c) => registry.variant(c.variantId).group === out.group && registry.variant(c.variantId).rank > inputRank).sort((a, b) => registry.variant(a.variantId).rank - registry.variant(b.variantId).rank);
        cardId = inGroup[0]?.id ?? null;
      }
      break;
    }
  }

  if (!cardId) { issues.push({ code: "OUTPUT_NOT_IN_CATALOG", message: "La salida no se pudo resolver a una carta existente." }); return { cardIds: [], issues }; }
  if (!registry.has(cardId) && !registry.card(cardId)) { issues.push({ code: "OUTPUT_NOT_IN_CATALOG", message: `La carta de salida no existe: ${cardId}` }); return { cardIds: [], issues }; }
  return { cardIds: [cardId], issues };
}
