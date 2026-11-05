/**
 * ARNÉS QA · FASE 41 — ECONOMÍA · ESCENAS QA SYNTHETIC.
 *
 * Lo SINTÉTICO son los hechos de cuenta (saldo, sobres, respuesta del servidor sobre el Sobre Inicial, objetivos). Lo
 * real: `starterOffer` (política → presentación), `PackPurchaseCta` (la misma CTA de `/packs/[packId]`), el vestíbulo
 * (`buildDailyLoop` + `DailyLobby`) con el recorrido, `ResultScreen` con la presentación de recompensa y `ObjectiveList`.
 */
import type { StarterStatus } from "@/server/services/starter";
import type { MetaObjective } from "@/domain/progression/meta";
import type { DailyLoopFacts } from "@/domain/dailyLoop";
import { firstSession, journey, cardsByRole, LEGAL_IDS } from "../fase40/fixtures";

export const FASE41_SCENES = [
  "starter-claim", "starter-claim-many-roles", "starter-checking", "starter-error", "starter-offline", "starter-owned",
  "starter-has-unopened", "starter-not-needed", "starter-cap", "starter-keyboard",
  "pack-purchasable", "pack-insufficient", "pack-premium-purchasable", "pack-icon-insufficient", "pack-event", "pack-owned",
  "credits-closed",
  "reward-granted", "reward-capped", "reward-unavailable", "reward-draft-none",
  "objective-claimable", "objective-claimed", "objective-progress", "objective-window-claimed", "objectives-mixed",
  "home-collect-starter", "home-open-welcome", "home-deck-ready", "economy-unavailable", "long-text",
] as const;
export type Fase41Scene = (typeof FASE41_SCENES)[number];

const status = (o: Partial<StarterStatus>): StarterStatus => ({
  eligible: false, reason: null, deckReady: false, unopenedStarter: 0, freeClaims: 0, maxFreeClaims: 8, missingRoles: [], ...o,
});

export interface PackScene { kind: "pack"; note: string; packId: string; credits: number; owned: number; online: boolean; status: StarterStatus | null | undefined; focus?: boolean }
export interface CreditsScene { kind: "credits"; note: string }
export interface RewardScene { kind: "reward"; note: string; award: { credits: number; xp: number; points: number } | null; mode: "PVE" | "DRAFT_GAUNTLET" }
export interface ObjectivesScene { kind: "objectives"; note: string; objectives: MetaObjective[] }
export interface HomeScene { kind: "home"; note: string; facts: DailyLoopFacts; network?: "online" | "offline" | "error" }
export type Scene = PackScene | CreditsScene | RewardScene | ObjectivesScene | HomeScene;

const NOW = Date.UTC(2026, 8, 16, 12);
const obj = (o: Partial<MetaObjective>): MetaObjective => ({
  id: "d-duelo-1", label: "Juega un duelo", kind: "daily", current: 0, goal: 1, complete: false, claimed: false, rewardCredits: 250, xp: 200,
  metric: "duels_played", packId: null, packCount: 0, assignedAt: NOW - 3_600_000, expiresAt: Date.UTC(2026, 8, 17), ...o,
});
const pack = (note: string, packId: string, credits: number, owned: number, s: StarterStatus | null | undefined = undefined, o: Partial<PackScene> = {}): PackScene =>
  ({ kind: "pack", note, packId, credits, owned, online: true, status: s, ...o });
const STARTER_LIKE = cardsByRole({ Duelista: 5, Controlador: 4, Iniciador: 4, Centinela: 1, Flex: 1 });

export const SCENES: Record<Fase41Scene, Scene> = {
  "starter-claim": pack("sin plantilla y sin Sobre Inicial: el servidor lo concede", "inicial", 6000, 0, status({ eligible: true, missingRoles: [{ role: "Centinela", have: 1, need: 2 }, { role: "Flex", have: 1, need: 2 }] })),
  "starter-claim-many-roles": pack("cuenta sin cartas (rara): faltan los cinco roles", "inicial", 6000, 0, status({ eligible: true, missingRoles: ["Duelista", "Controlador", "Iniciador", "Centinela", "Flex"].map((role) => ({ role, have: 0, need: 2 })) })),
  "starter-checking": pack("comprobando con el servidor: botón desactivado", "inicial", 6000, 0, undefined),
  "starter-error": pack("no se pudo comprobar: no se ofrece nada", "inicial", 6000, 0, null),
  "starter-offline": pack("sin sesión: el Sobre Inicial gratis lo concede el servidor", "inicial", 0, 0, null, { online: false }),
  "starter-owned": pack("tiene 2 Sobres Iniciales en el inventario: abrir", "inicial", 6000, 2, undefined),
  "starter-has-unopened": pack("el servidor dice que tiene uno sin abrir (la tienda local aún no)", "inicial", 6000, 0, status({ reason: "HAS_UNOPENED_STARTER", unopenedStarter: 1 })),
  "starter-not-needed": pack("ya puede formar plantilla: el gratis deja de existir", "inicial", 6000, 0, status({ reason: "DECK_READY", deckReady: true, freeClaims: 1 })),
  "starter-cap": pack("tope de 8 concesiones: ruta con créditos", "inicial", 6000, 0, status({ reason: "CLAIM_CAP", freeClaims: 8, missingRoles: [{ role: "Flex", have: 1, need: 2 }] })),
  "starter-keyboard": pack("foco de teclado en «Conseguir Sobre Inicial gratis»", "inicial", 6000, 0, status({ eligible: true, missingRoles: [{ role: "Centinela", have: 0, need: 2 }] }), { focus: true }),
  "pack-purchasable": pack("Sobre Estándar con saldo suficiente", "estandar", 6120, 0),
  "pack-insufficient": pack("Sobre Estándar sin saldo: cuánto falta y cómo se gana", "estandar", 420, 0),
  "pack-premium-purchasable": pack("Sobre Premium con saldo", "premium", 12_000, 0),
  "pack-icon-insufficient": pack("Sobre ICON Premium (80.000) con 9.850", "icon", 9850, 0),
  "pack-event": pack("sobre de evento: se obtiene en eventos", "masters", 50_000, 0),
  "pack-owned": pack("Sobre Premium en el inventario: abrir sin comprar", "premium", 100, 1),
  "credits-closed": { kind: "credits", note: "tienda de créditos de prueba cerrada por el servidor" },
  "reward-granted": { kind: "reward", note: "victoria en Difícil dentro del tope: 350 créditos, 180 XP, 22 puntos", award: { credits: 350, xp: 180, points: 22 }, mode: "PVE" },
  "reward-capped": { kind: "reward", note: "partida 21 del día: tope alcanzado, sin recompensa", award: { credits: 0, xp: 0, points: 0 }, mode: "PVE" },
  "reward-unavailable": { kind: "reward", note: "la recompensa no llegó del servidor", award: null, mode: "PVE" },
  "reward-draft-none": { kind: "reward", note: "Draft Gauntlet: sin economía", award: null, mode: "DRAFT_GAUNTLET" },
  "objective-claimable": { kind: "objectives", note: "misión completa pendiente de recoger", objectives: [obj({ current: 1, complete: true })] },
  "objective-claimed": { kind: "objectives", note: "misión ya cobrada en esta tanda", objectives: [obj({ current: 1, complete: true, claimed: true })] },
  "objective-progress": { kind: "objectives", note: "misión semanal en progreso", objectives: [obj({ id: "w-duelos-5", label: "Juega 5 duelos", kind: "weekly", goal: 5, current: 3, rewardCredits: 1200, xp: 800, expiresAt: Date.UTC(2026, 8, 21) })] },
  "objective-window-claimed": { kind: "objectives", note: "reclamada y jugando más: sigue «conseguida» hasta la tanda nueva", objectives: [obj({ current: 1, complete: true, claimed: true }), obj({ id: "d-duelo-win", label: "Gana un duelo", current: 1, complete: true, claimed: true, rewardCredits: 400, xp: 300, metric: "duels_won" })] },
  "objectives-mixed": { kind: "objectives", note: "tanda mixta: recoger, cobrada, en progreso, con sobre", objectives: [
    obj({ current: 1, complete: true }), obj({ id: "d-abrir-1", label: "Abre un sobre", current: 1, complete: true, claimed: true, rewardCredits: 200, xp: 150, metric: "packs_opened" }),
    obj({ id: "w-sobres-10", label: "Abre 10 sobres", kind: "weekly", goal: 10, current: 4, rewardCredits: 1500, xp: 900, metric: "packs_opened", expiresAt: Date.UTC(2026, 8, 21) }),
    obj({ id: "s-duelos-25", label: "Juega 25 duelos en la temporada", kind: "seasonal", goal: 25, current: 11, rewardCredits: 0, xp: 2500, packId: "estandar", packCount: 2, expiresAt: null }),
  ] },
  "home-collect-starter": { kind: "home", note: "bienvenida abierta, faltan roles: copia nueva del recorrido", facts: firstSession(journey({ ids: STARTER_LIKE, packsOpened: 4, unopenedPacks: 0, firstPackId: null })) },
  "home-open-welcome": { kind: "home", note: "cuenta nueva: abrir los sobres de bienvenida primero", facts: firstSession(journey()) },
  "home-deck-ready": { kind: "home", note: "plantilla posible: el recorrido ya no ofrece Sobre Inicial", facts: firstSession(journey({ ids: LEGAL_IDS, packsOpened: 5, unopenedPacks: 0, firstPackId: null })) },
  "economy-unavailable": { kind: "home", note: "servidor no disponible: foto anterior y acciones desactivadas", facts: firstSession(journey({ ids: STARTER_LIKE, packsOpened: 4, unopenedPacks: 0, firstPackId: null })), network: "error" },
  "long-text": pack("roles con nombres completos y tope de concesiones al límite", "inicial", 123_456_789, 0, status({ eligible: true, freeClaims: 7, missingRoles: ["Controlador", "Iniciador", "Centinela", "Flex"].map((role) => ({ role, have: 1, need: 2 })) })),
};
