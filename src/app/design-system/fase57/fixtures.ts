/**
 * FIXTURES QA SYNTHETIC · FASE 57 — resultados INVENTADOS para fotografiar la ceremonia (uids, qué sale, colección de
 * antes). Lo real: el catálogo (cartas, rarezas, sobres) y el dominio que presenta (`buildRevealPlan`).
 *
 * A diferencia del arnés de la Fase 38, NO registra la carta serializada de QA: dar de alta una carta en `CARDS` al cargar
 * el módulo contamina el catálogo compartido del prerender (rompió el de `/design-system/fase56`). Aquí solo se LEE.
 */
import type { CardDef } from "@/domain/cards/types";
import { CARDS } from "@/data/catalog";
import { rarityOf, type OwnedInstanceFact } from "@/domain/collection/room";
import type { OpenedInstance } from "@/domain/packs/reveal";
import type { RarityBucket } from "@/domain/packs/types";

export interface PlanFixture { opened: OpenedInstance[]; before: OwnedInstanceFact[] | null }

let seq = 0;
const uid = () => `00000057-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const op = (c: CardDef): OpenedInstance => ({ uid: uid(), cardId: c.id, serial: null, mintedVersion: 1 });
const own = (c: CardDef): OwnedInstanceFact => ({ uid: uid(), cardId: c.id, serial: null, mintedVersion: 1 });

const byRarity = (r: RarityBucket) => CARDS.filter((c) => rarityOf(c) === r);
const pick = (r: RarityBucket, i = 0, ...exclude: CardDef[]) => byRarity(r).filter((c) => !exclude.some((e) => e.playerId === c.playerId))[i];

export const LEGEND = pick("legendary");
export const EPIC = pick("epic", 0, LEGEND);
export const RARE = pick("rare", 0, LEGEND, EPIC);
export const UNCOMMON = pick("uncommon", 0, LEGEND, EPIC, RARE);
export const COMMON = pick("common", 0, LEGEND, EPIC, RARE, UNCOMMON);
const COMMONS = byRarity("common");

/** La colección de «antes»: 20 comunes (incluida `COMMON`, para que salga DUPLICADA). */
const BEFORE: OwnedInstanceFact[] = [...COMMONS.slice(0, 20).map(own), own(COMMON), own(COMMON)];

export const LEGENDARY_IN: PlanFixture = { before: BEFORE, opened: [op(COMMONS[40]), op(COMMON), op(UNCOMMON), op(RARE), op(LEGEND)] };
/** El Sobre ICON Premium (`icon`) trae 3 cartas en el catálogo: sus escenas usan 3 (la escena se adapta al número REAL). */
// 2026-10-09 · 3 cartas, todas Icon (legendarias); repetidas permitidas, como en el motor.
export const ICON_PACK: PlanFixture = { before: BEFORE, opened: [op(LEGEND), op(LEGEND), op(LEGEND)] };
export const MIXED: PlanFixture = { before: BEFORE, opened: [op(COMMON), op(COMMONS[41]), op(UNCOMMON), op(RARE), op(EPIC)] };
export const SIX: PlanFixture = { before: BEFORE, opened: [...MIXED.opened, op(COMMONS[42])] };
export const ALL_DUP: PlanFixture = { before: BEFORE, opened: COMMONS.slice(0, 5).map(op) };
export const single = (c: CardDef): PlanFixture => ({ before: BEFORE, opened: [op(c)] });
export const ONE_COMMON = single(COMMONS[43]);
