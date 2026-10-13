"use client";

/**
 * F89 · LAS DOS VISTAS DEL PERFIL, explícitas (simplificadas: el perfil es identidad):
 *
 *   ProfileOwnerView   mi perfil (foto SELF del servidor): EDITAR PERFIL, CUENTA Y AJUSTES, SALA DE TROFEOS y CERRAR
 *                      SESIÓN (logout canónico que pasa la página).
 *   PublicProfileView  perfil de otro (foto PUBLIC): identidad pública + acciones sociales de F85. No recibe NINGÚN
 *                      manejador de edición ni de sesión: no hay forma de montar acciones de cuenta en ella.
 *
 * Las dos componen la MISMA tarjeta (`PlayerIdentityView` → `ProfileIdentityCard`); la autoridad real es el servidor
 * (la foto PUBLIC no trae datos privados y toda mutación sale del token).
 */
import type { PlayerIdentitySnapshot } from "@/domain/profile/identity";
import { PlayerIdentityView } from "./PlayerIdentityView";
import type { EditorTab } from "./ShowcaseEditor";

export function ProfileOwnerView({ snap, onEdit, onSignOut, signingOut }: { snap: PlayerIdentitySnapshot; onEdit: (tab: EditorTab) => void; onSignOut: () => void; signingOut?: boolean }) {
  if (snap.view !== "SELF") return null; // defensa: nunca se montan acciones de cuenta sobre una foto ajena
  return <PlayerIdentityView snap={snap} onEdit={onEdit} onSignOut={onSignOut} signingOut={signingOut} />;
}

export function PublicProfileView({ snap, social }: { snap: PlayerIdentitySnapshot; social?: React.ReactNode }) {
  return <PlayerIdentityView snap={snap} social={social} />;
}
