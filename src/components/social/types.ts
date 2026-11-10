/**
 * CONTRATO ENTRE EL HUB SOCIAL Y SU PÁGINA (Fase 29). Los componentes solo PIDEN cosas por id;
 * la página las manda al servidor y vuelve a leer. En el arnés QA los manejadores son no-op.
 */
import type { SocialPlayer, ChallengeView, SearchHit } from "@/server/services/social";

export interface SocialHandlers {
  onFriendRequest: (player: SocialPlayer) => void;
  onAcceptFriend: (player: SocialPlayer) => void;
  onDeclineFriend: (player: SocialPlayer) => void;
  /** Pide confirmación antes de tocar el servidor. */
  onUnfriend: (player: SocialPlayer) => void;
  /** Retira una solicitud enviada (misma RPC que eliminar: borra la fila PENDING propia). */
  onCancelRequest: (player: SocialPlayer) => void;
  onBlock: (player: SocialPlayer) => void;
  onUnblock: (player: SocialPlayer) => void;
  /** Abre la hoja de reto (elegir mazo). */
  onChallenge: (player: SocialPlayer, previousMatchId?: string | null) => void;
  onAcceptChallenge: (challenge: ChallengeView) => void;
  onDeclineChallenge: (challenge: ChallengeView) => void;
  onCancelChallenge: (challenge: ChallengeView) => void;
  onOpenMatch: (matchId: string) => void;
}

export interface SearchState {
  query: string;
  results: SearchHit[] | null;
  searching: boolean;
  error: string | null;
  onQuery: (q: string) => void;
  /** F85 · paginación de la búsqueda (10 por página, como mucho 5). */
  hasMore?: boolean;
  onMore?: () => void;
}

export type SocialTab = "amigos" | "solicitudes" | "buscar" | "retos" | "actividad";

export const SOCIAL_TABS: { id: SocialTab; label: string }[] = [
  { id: "amigos", label: "Amigos" },
  { id: "solicitudes", label: "Solicitudes" },
  { id: "buscar", label: "Buscar jugadores" },
  { id: "retos", label: "Retos" },
  { id: "actividad", label: "Jugadores recientes" },
];

export const isSocialTab = (v: unknown): v is SocialTab => SOCIAL_TABS.some((t) => t.id === v);
