/**
 * TRANSFER MARKET & SQUAD MANAGEMENT ENGINE — tipos (Career Fase 4/7).
 *
 * El mercado de fichajes VIVO: cada club tiene necesidades, negocia, compra, vende, cede,
 * renueva y asciende cantera — aunque el usuario no haga nada. REUTILIZA el Living World
 * (`@/world`: WorldState/WorldPlayer/Contract/Transfer/playerValue/freshContract/generateRookie/
 * runTransferMarket) y el Player Development (`@/development`: scoutPlayer/progress/chemistry).
 * NO duplica ningún motor: lo EXTIENDE con negociación, cesiones, director deportivo y la
 * participación del usuario. Todo PLANO/clonable (persistible) y DETERMINISTA (Rng sembrado).
 */
import type { Region, RoleId } from "@/domain/cards/types";
import type { ScoutReport } from "@/development";

// ───────────────────────────── Necesidades del club ─────────────────────────────

/** Tipo de necesidad detectada en una plantilla. Calculado, nunca aleatorio. */
export type NeedKind =
  | "role_gap"     // falta cubrir un rol (Duelista/Iniciador/Centinela/Controlador/Flex)
  | "star"         // falta una estrella (poco top-end)
  | "igl"          // falta líder en pista (leadership)
  | "rookie"       // falta juventud/proyección
  | "veteran"      // falta experiencia/veteranía
  | "depth"        // falta fondo de armario (plantilla corta)
  | "sell_surplus";// exceso de plantilla / hay que vender para cuadrar

export interface SquadNeed {
  teamId: string;
  kind: NeedKind;
  role: RoleId | null;
  severity: number;   // 0..100
  reason: string;
}

/** Estado de transferibilidad de un jugador, fijado por el director deportivo / usuario. */
export type ListStatus = "protected" | "normal" | "listed" | "loan_listed";

// ───────────────────────────── Valor de mercado ─────────────────────────────

/** Desglose del valor de mercado. `base` = `playerValue` del mundo (reutilizado). */
export interface MarketValue {
  base: number;
  ageMult: number;
  potentialMult: number;
  formMult: number;
  contractMult: number;   // contrato corto ⇒ más barato (menos poder del vendedor)
  popularityMult: number; // fanbase/prestigio del club (marca del jugador)
  value: number;          // valor final de mercado
  releaseClause: number;  // cláusula de rescisión
  wageDemand: number;     // salario que exige el jugador
}

// ───────────────────────────── Cesiones (préstamos) ─────────────────────────────

export interface LoanTerms {
  ownerClub: string;        // club propietario
  seasons: number;          // duración (temporadas)
  wageShare: number;        // 0..1 parte del salario que paga el club cesionario
  buyOption: number | null; // opción de compra al final
  buyBackClause: number | null;
  guaranteedMinutes: number;// 0..100 minutos garantizados
}

export interface ActiveLoan {
  playerId: string;
  playerNick: string;
  ownerClub: string;
  loanClub: string;
  startSeason: number;
  endSeason: number;
  terms: LoanTerms;
}

// ───────────────────────────── Negociación ─────────────────────────────

export type OfferParty = "user" | "ai";
export type OfferKind = "transfer" | "loan" | "free" | "renewal" | "swap";
export type OfferStatus = "pending" | "countered" | "accepted" | "rejected" | "expired" | "withdrawn";
/** Relativo al usuario: sale de él (compra/venta que inicia) o le llega (por sus jugadores). */
export type OfferDirection = "outgoing" | "incoming";

export interface NegotiationRound {
  by: OfferParty;
  fee: number;
  salary: number;
  years: number;
  note: string;
}

export interface PlayerOffer {
  id: string;
  season: number;
  playerId: string;
  playerNick: string;
  role: RoleId;
  fromClub: string;   // vendedor (club id) o "" si agente libre
  fromClubName: string;
  toClub: string;     // comprador
  toClubName: string;
  initiator: OfferParty;
  direction: OfferDirection;
  kind: OfferKind;
  fee: number;
  salary: number;
  years: number;
  bonus: number;
  releaseClause: number;
  loan: LoanTerms | null;
  swapPlayerId: string | null;
  status: OfferStatus;
  rounds: NegotiationRound[];
  note: string;
}

// ───────────────────────────── Objetivos de fichaje ─────────────────────────────

/** Jugador OJEADO y fichable. Reutiliza `scoutPlayer` (report) + `playerValue` (value). */
export interface MarketTarget {
  id: string;
  nick: string;
  region: Region;
  role: RoleId;
  teamId: string | null;   // null = agente libre
  teamName: string;
  rating: number;
  potential: number;
  age: number;
  value: number;
  askingFee: number;       // lo que pide el vendedor (cláusula/valor)
  wageDemand: number;      // salario que exige
  releaseClause: number;
  contractYears: number;
  status: ListStatus;      // según el vendedor (listed = chollo)
  fit: number;             // compatibilidad con el estilo del coach 0..100
  chemistry: number;       // química estimada con la plantilla 0..100
  report: ScoutReport;
  rumor: string | null;
}

// ───────────────────────────── Rumores y eventos ─────────────────────────────

export interface MarketRumor {
  id: string;
  season: number;
  text: string;
  playerId: string | null;
  clubId: string | null;
  heat: number; // 0..100
}

export type MarketEventType =
  | "signing" | "sale" | "loan_out" | "loan_in" | "loan_return"
  | "renewal" | "release" | "promotion" | "swap"
  | "offer_made" | "offer_received" | "offer_rejected" | "offer_accepted"
  | "counter" | "bid_rejected" | "record_signing" | "bomb";

export interface MarketEvent {
  id: string;
  type: MarketEventType;
  season: number;
  at: number;
  playerId: string;
  playerNick: string;
  fromClub: string | null;
  toClub: string | null;
  fee: number;
  detail: string;
  magnitude: number; // 1..100
}

// ───────────────────────────── Plantilla (squad) ─────────────────────────────

export type SquadSlot = "starter" | "bench" | "loaned_out" | "academy";

export interface SquadPlayerView {
  id: string;
  nick: string;
  role: RoleId;
  age: number;
  rating: number;
  potential: number;
  value: number;
  wage: number;
  contractYears: number;
  happiness: number;
  slot: SquadSlot;
  status: ListStatus;
  band: "joven" | "prime" | "veterano" | "declive";
  form: number;
  loanInfo: string | null;
}

export interface SquadView {
  clubId: string;
  clubName: string;
  starters: SquadPlayerView[];
  bench: SquadPlayerView[];
  loanedOut: SquadPlayerView[];
  squadValue: number;
  wageBill: number;
  chemistry: number;     // química del quinteto titular (0..100)
  avgAge: number;
  needs: SquadNeed[];
}

// ───────────────────────────── Director deportivo ─────────────────────────────

/** Filosofía del club (derivada del mundo, mismo criterio que `@/career` derivePhilosophy). */
export type MarketPhilosophy = "develop_youth" | "buy_stars" | "financial_control" | "long_project" | "win_now";

/** Postura del director deportivo ante el mercado. */
export interface DirectorStance {
  philosophy: MarketPhilosophy;
  aggression: number;     // 0..100 disposición a gastar
  patience: number;       // 0..100 aguanta contraofertas / no malvende
  youthBias: number;      // 0..100 prioriza cantera/proyección
  message: string;
}

// ───────────────────────────── Ventana de fichajes ─────────────────────────────

/** Estado PERSISTENTE de la ventana de fichajes del club del usuario. Plano/clonable. */
export interface TransferWindow {
  clubId: string;
  season: number;
  seed: number;
  open: boolean;
  stance: DirectorStance;
  offers: PlayerOffer[];                    // salientes (del usuario) + entrantes (por sus jugadores)
  targets: MarketTarget[];                  // jugadores ojeados y fichables
  rumors: MarketRumor[];                    // ruido de mercado de todo el ecosistema
  listStatus: Record<string, ListStatus>;   // transferibilidad de los jugadores del usuario
  loans: ActiveLoan[];                       // cesiones activas del club del usuario
  spentThisSeason: number;
  earnedThisSeason: number;
  log: MarketEvent[];                        // lo ocurrido en la ventana
}

/** Resultado de un paso del motor: eventos + noticias (mismo NewsItem del buzón único). */
export interface MarketResult {
  events: MarketEvent[];
}
