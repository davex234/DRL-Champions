"use client";

/**
 * EL PERFIL DE JUGADOR = IDENTIDAD (sobre F31/F56/F82/F89). Recibe UNA `PlayerIdentitySnapshot` (del servidor o QA
 * SYNTHETIC en el arnés) y la pinta como UNA tarjeta (`ProfileIdentityCard`): avatar, nombre, rango actual, equipo
 * favorito, miembro desde y acciones.
 *
 * Antes era un panel de control (héroe con XP, estadísticas, temporada, colección, historial, ranked, momentos, logros,
 * Pick'ems, actividad, vitrina). Esos datos siguen en la foto y en sus pantallas (Ranked, Temporada, Colección, Sala de
 * Trofeos, Social): el perfil ya no los repite. Las vistas `ProfileOwnerView` y `PublicProfileView` (ProfileViews.tsx)
 * deciden qué acciones se ofrecen; esta pieza solo compone.
 */
import type { PlayerIdentitySnapshot } from "@/domain/profile/identity";
import { ProfileIdentityCard } from "./ProfileIdentityCard";
import type { EditorTab } from "./ShowcaseEditor";

export interface PlayerIdentityViewProps {
  snap: PlayerIdentitySnapshot;
  /** Solo perfil propio: abre el editor existente («Editar perfil»). */
  onEdit?: (tab: EditorTab) => void;
  /** Solo perfil propio: el logout CANÓNICO (`useAuth().signOut`), lo pasa la página. */
  onSignOut?: () => void;
  signingOut?: boolean;
  /** Solo perfil ajeno: las acciones sociales de F85. */
  social?: React.ReactNode;
}

export function PlayerIdentityView({ snap, onEdit, onSignOut, signingOut, social }: PlayerIdentityViewProps) {
  const owner = snap.view === "SELF" && onEdit && onSignOut ? { onEdit: () => onEdit("avatar"), onSignOut, signingOut } : null;
  return <ProfileIdentityCard snap={snap} owner={owner} social={snap.view === "SELF" ? null : social} />;
}
