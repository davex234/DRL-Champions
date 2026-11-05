/**
 * PRIVACY — quién puede enviarte solicitudes/invitaciones y ver tu presencia (Online Fase 4/7).
 * PURO. Determinista.
 */
import type { PrivacySettings } from "./types";

export const DEFAULT_PRIVACY: PrivacySettings = { allowFriendRequests: true, allowPartyInvites: "friends", showPresence: "friends" };

export function canReceiveFriendRequest(priv: PrivacySettings): boolean { return priv.allowFriendRequests; }
export function canReceivePartyInvite(priv: PrivacySettings, isFriend: boolean): boolean { return priv.allowPartyInvites === "everyone" || (priv.allowPartyInvites === "friends" && isFriend); }
export function canSeePresence(priv: PrivacySettings, isFriend: boolean): boolean { return priv.showPresence === "everyone" || (priv.showPresence === "friends" && isFriend); }
