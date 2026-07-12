// ❄️ FROZEN (Consolidation F1.1, 2026-07-06): motor completo y verificado SIN consumidores de
// producto hoy. Se conserva por valor de roadmap (wire before kill). NO crecer ni integrar
// sin decision explicita. Registro y criterios: docs/FROZEN.md
/**
 * FRIENDS, PARTY & SOCIAL ENGINE — API pública (Online Fase 4/7).
 *
 * Infraestructura social completa: Friend · Party (1..5) · Presence (+rich) · Invitations
 * (amigo/party/lobby/spectator, expirables) · Notifications · Privacy · Block List · Recent
 * Players · Party Chat (infra) · Voice hooks (infra). Flujo único: Friend → Party → Lobby →
 * Matchmaking → Online Session → Gameplay. Reutiliza matchmaking/online/competitive/identity
 * (nunca al revés). Determinista. Sin O(n²). NO torneos/clanes/marketplace.
 */
export * from "./types";
export { FriendGraph } from "./friends";
export { PresenceEngine, richPresence } from "./presence";
export { PartyEngine, noopVoice, type VoiceHooks } from "./party";
export { InvitationEngine } from "./invitations";
export { NotificationEngine } from "./notifications";
export { RecentPlayers } from "./recent";
export { DEFAULT_PRIVACY, canReceiveFriendRequest, canReceivePartyInvite, canSeePresence } from "./privacy";
export { SocialEngine } from "./engine";
export { friendsListView, partyView, notificationsView, type FriendView, type PartyView } from "./broadcast";
