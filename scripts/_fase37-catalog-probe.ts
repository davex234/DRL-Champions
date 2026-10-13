/**
 * FASE 37 · SONDA DEL CATÁLOGO REAL (instrumento `_`, fuera de CI). Solo lectura del código: cifras reales para el contrato
 * de colección (definiciones, jugadores, equipos, identidades ambiguas, rarezas, ediciones, disponibilidad en sobres).
 */
import { CARDS, TOTAL_CARDS, allPlayers, getPlayer } from "../src/data/catalog";
import { getVariant } from "../src/domain/cards/variants";
import { bucketForRank } from "../src/domain/packs/types";
import { PACKS } from "../src/data/packs";
import { isPurchasable, isPubliclyOpenable, packLifecycle } from "../src/domain/packs/lifecycle";
import { isEligible } from "../src/domain/packs/pool";
import { CardRegistry } from "../src/collection";
import { resolveTeamIdentity, isAmbiguousAlias, candidateIdentities } from "../src/data/teamIdentities";

const count = <T,>(xs: T[], key: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => { const k = key(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const players = allPlayers();
console.log(`cards=${CARDS.length} TOTAL_CARDS=${TOTAL_CARDS} players=${players.length} playersWithCards=${new Set(CARDS.map((c) => c.playerId)).size}`);
console.log(`id samples: ${CARDS.slice(0, 3).map((c) => c.id).join(" | ")} · idPattern ok=${CARDS.every((c) => /^[A-Za-z0-9._-]{1,64}__[a-z0-9-]{1,32}$/.test(c.id))}`);
console.log(`playerId chars: ${[...new Set(CARDS.map((c) => c.playerId).join("").split(""))].sort().join("")}`);
console.log(`buckets: ${JSON.stringify(count(CARDS, (c) => bucketForRank(getVariant(c.variantId).rank)))}`);
console.log(`groups: ${JSON.stringify(count(CARDS, (c) => getVariant(c.variantId).group))}`);
console.log(`roles: ${JSON.stringify(count(CARDS, (c) => getPlayer(c.playerId)?.role ?? "?"))}`);
console.log(`regions: ${JSON.stringify(count(CARDS, (c) => getPlayer(c.playerId)?.region ?? "?"))}`);
const teams = count(CARDS, (c) => getPlayer(c.playerId)?.team ?? "?");
console.log(`teams(raw)=${Object.keys(teams).length}`);
const unresolved = Object.keys(teams).filter((t) => !resolveTeamIdentity(t));
const ambiguous = Object.keys(teams).filter((t) => isAmbiguousAlias(t));
console.log(`teams unresolved=${unresolved.length} [${unresolved.slice(0, 12).join(", ")}] ambiguous=${ambiguous.length} [${ambiguous.map((a) => `${a}→${candidateIdentities(a).map((c) => c.canonicalId).join("/")}`).join(", ")}]`);
const canon = new Map<string, Set<string>>();
for (const t of Object.keys(teams)) { const id = !isAmbiguousAlias(t) ? resolveTeamIdentity(t)?.canonicalId : undefined; const k = id ?? `raw:${t}`; if (!canon.has(k)) canon.set(k, new Set()); canon.get(k)!.add(t); }
console.log(`team keys (identity or raw)=${canon.size} · multi-alias identities: ${[...canon.entries()].filter(([, s]) => s.size > 1).map(([k, s]) => `${k}=${[...s].join("+")}`).join(", ")}`);
const variantsPerPlayer = count(CARDS, (c) => c.playerId);
const vpp = Object.values(variantsPerPlayer);
console.log(`variants per player: min=${Math.min(...vpp)} max=${Math.max(...vpp)} multi=${vpp.filter((n) => n > 1).length}`);
console.log(`combat present=${CARDS.filter((c) => !!c.combat).length}/${CARDS.length} serialized=${CARDS.filter((c) => getVariant(c.variantId).serialized).length}`);
console.log(`ovr range ${Math.min(...CARDS.map((c) => c.ovr))}..${Math.max(...CARDS.map((c) => c.ovr))}`);
console.log(`packs: ${JSON.stringify(count(PACKS, (p) => packLifecycle(p)))} purchasable=${PACKS.filter(isPurchasable).length} openable=${PACKS.filter(isPubliclyOpenable).length}`);
const reg = new CardRegistry();
const active = PACKS.filter(isPurchasable);
const t0 = Date.now();
const inActive = CARDS.filter((c) => active.some((p) => isEligible(reg, p, c)));
console.log(`cards eligible in some ACTIVE purchasable pack=${inActive.length}/${CARDS.length} (${Date.now() - t0} ms) · not in any: ${JSON.stringify(count(CARDS.filter((c) => !inActive.includes(c)), (c) => getVariant(c.variantId).group))}`);
console.log(`image field present=${players.filter((p) => !!p.image).length} status inactive=${players.filter((p) => p.status === "inactive").length}`);
