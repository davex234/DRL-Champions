"use client";

import { useEffect, useState } from "react";
import { getTeam, teamSlug } from "@/data/teams";
import { teamLogoSrc } from "@/lib/assets";
import { hasTeamLogo } from "@/data/teamLogos";

/** Logos que ya se sabe que NO existen. Misma razón que en `PlayerPhoto`: no pedirlos dos veces. */
const missingLogos = new Set<string>();

/**
 * Logo oficial del equipo (`/teams/{slug}.png`). Si no existe, muestra un
 * monograma con la etiqueta del equipo y su color de marca.
 */
export function TeamLogo({ team, size = 26 }: { team: string; size?: number }) {
  const def = getTeam(team);
  const slug = teamSlug(team);
  const src = teamLogoSrc(slug);
  // F64 · solo se pide el fichero si EXISTE (lista `TEAM_LOGOS_AVAILABLE`): antes, un 404 por equipo y pantalla.
  const [failed, setFailed] = useState(() => !hasTeamLogo(slug) || missingLogos.has(src));

  useEffect(() => setFailed(!hasTeamLogo(slug) || missingLogos.has(src)), [src, slug]);

  if (!failed) {
    return (
      <img
        src={src}
        alt={team}
        onError={() => { missingLogos.add(src); setFailed(true); }}
        className="object-contain drop-shadow"
        style={{ width: size, height: size }}
        draggable={false}
      />
    );
  }

  return (
    <span
      className="nx-clip-sm grid place-items-center font-display font-bold leading-none text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: def?.color ?? "#222",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.25)",
      }}
      title={team}
    >
      {def?.tag ?? team.slice(0, 3).toUpperCase()}
    </span>
  );
}
