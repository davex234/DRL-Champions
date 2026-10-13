"use client";

/**
 * EL PERFIL ES IDENTIDAD — una sola tarjeta centrada: avatar (con su marco equipado), nombre, TAG público (0068, copiable),
 * rango competitivo actual
 * (F84: emblema + rango + división + rating, solo si está clasificado o en colocación), equipo favorito (si lo tiene),
 * «miembro desde» y las acciones que tocan:
 *
 *   PROPIO   EDITAR PERFIL (editor existente) · CUENTA Y AJUSTES · SALA DE TROFEOS · CERRAR SESIÓN (logout canónico)
 *   AJENO    las acciones sociales de F85 (añadir, solicitud, aceptar, amigos, retar, comparar, bloquear en el menú)
 *
 * Todo lo demás (estadísticas, temporada, colección, historial, insignias, vitrina) vive en SU pantalla: Ranked,
 * Temporada, Colección, Sala de Trofeos, Social. Los datos siguen en el servidor: aquí simplemente no se pintan.
 * Presentación pura sobre la foto del servidor (SELF / PUBLIC ya vienen distintas); las acciones de cuenta solo existen
 * si quien monta la tarjeta pasa `owner` (y `ProfileOwnerView` solo lo hace con una foto SELF).
 */
import Link from "next/link";
import { Stage } from "@/components/ui/Surface";
import { CompetitiveEmblem } from "@/components/competitive/ranked/CompetitiveEmblem";
import type { PlayerIdentitySnapshot } from "@/domain/profile/identity";
import { PlayerAvatar, ProfileButton, TeamMark, fmtMonth } from "./bits";
import { AccountTag } from "./AccountTag";
// IA 2026-10-07 · «Cuenta y ajustes» abre la pestaña CUENTA de Mi cuenta (antes, `/cuenta` a secas era esa pantalla).
import { ROUTES } from "@/design/nav";

export interface ProfileOwnerActions {
  onEdit: () => void;
  onSignOut: () => void;
  signingOut?: boolean;
}

const fmtRating = (n: number): string => n.toLocaleString("es-ES");

export function ProfileIdentityCard({ snap, owner, social }: { snap: PlayerIdentitySnapshot; owner?: ProfileOwnerActions | null; social?: React.ReactNode }) {
  const { player } = snap;
  const comp = snap.competitive;
  const team = snap.favoriteTeam;
  const accent = snap.accent.color;
  // Rango «si existe»: clasificado (rango + división) o en colocación. Sin clasificar = no se pinta un rango vacío.
  const ranked = comp && comp.state === "RANKED" && comp.rank ? comp : null;
  const placing = comp && comp.state === "PLACEMENT" ? comp : null;
  const rating = snap.ranked?.rating ?? comp?.rating ?? null;
  const isOwner = snap.view === "SELF" && !!owner;

  return (
    <div className="mx-auto w-full max-w-xl" data-scene="player-identity" data-view={snap.view} data-player={player.userId}>
      <Stage grid className="relative overflow-hidden px-5 py-8 text-center sm:px-10 sm:py-12" data-testid="profile-card" data-view={snap.view}>
        <span aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: `radial-gradient(520px 300px at 50% 0%, ${accent}33, transparent 70%)` }} />
        <p className="nx-label">{snap.view === "SELF" ? "Tu perfil" : "Perfil de jugador"}</p>

        <div className="mt-5 flex justify-center">
          <PlayerAvatar avatar={player.avatar} username={player.username} frame={player.frame} />
        </div>
        <h1 className="mt-4 break-words font-display text-[clamp(26px,7vw,44px)] font-bold uppercase leading-[0.95] text-white [overflow-wrap:anywhere]" data-field="player-name">
          {player.username}
        </h1>
        {/* 0068 · el TAG PÚBLICO permanente, bajo el nombre: identifica la cuenta aunque el nombre cambie. Copiable. */}
        {player.tag && <div className="mt-1.5 flex justify-center"><AccountTag tag={player.tag} /></div>}

        {(ranked || placing) && (
          <div className="mt-6 flex flex-col items-center gap-2" data-testid="profile-rank" data-rank-state={comp!.state} data-tier={ranked?.rank?.tierId}>
            <CompetitiveEmblem rank={comp!.rank} state={comp!.state} placement={comp!.placement} size="sm" position={null} animate={false} />
            <p className="font-display text-[20px] font-bold uppercase tracking-[0.08em]" style={{ color: ranked?.rank?.color ?? "var(--nx-gold)" }} data-field="rank-label">
              {ranked ? ranked.rank!.label : `Colocación ${placing!.placement.played}/${placing!.placement.total}`}
            </p>
            {rating !== null && <p className="nx-readout text-[15px] text-white/70" aria-label={`Rating ${rating}`} data-field="rating">{fmtRating(rating)}</p>}
          </div>
        )}

        {team && (
          <div className="mt-5 flex justify-center" data-testid="favorite-team" data-team={team.id}>
            <TeamMark team={team} size="lg" />
          </div>
        )}

        {snap.memberSince !== null && (
          <p className="mt-5 text-[13px] text-white/55" data-testid="member-since">Miembro desde {fmtMonth(snap.memberSince)}</p>
        )}

        {isOwner && owner && (
          <div className="mx-auto mt-8 flex max-w-xs flex-col gap-2.5" data-testid="profile-owner-actions">
            <ProfileButton tone="primary" onClick={owner.onEdit} data-action="edit" className="w-full">Editar perfil</ProfileButton>
            <Link href={ROUTES.accountSettings} data-action="account" className="nx-focus nx-clip-sm inline-flex min-h-[44px] w-full items-center justify-center border border-white/15 px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white/80 transition hover:bg-white/[0.08] hover:text-white">Cuenta y ajustes</Link>
            <Link href="/coleccion/trofeos" data-action="trophy-room" className="nx-focus nx-clip-sm inline-flex min-h-[44px] w-full items-center justify-center border border-drl-gold/35 px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-gold/90 transition hover:bg-drl-gold/10">Sala de Trofeos</Link>
            <button
              type="button"
              onClick={owner.onSignOut}
              disabled={owner.signingOut}
              data-action="sign-out"
              className="nx-focus nx-clip-sm mt-3 inline-flex min-h-[44px] w-full items-center justify-center border border-drl/45 px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl transition hover:bg-drl/10 disabled:cursor-wait disabled:opacity-60"
            >
              {owner.signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
            </button>
          </div>
        )}

        {snap.view !== "SELF" && social && <div className="mt-8 flex justify-center text-left" data-testid="profile-social">{social}</div>}
      </Stage>
    </div>
  );
}
