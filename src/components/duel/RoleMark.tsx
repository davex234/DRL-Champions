"use client";

/**
 * DUEL GAMEPLAY UX 2.0 · MARCA DE ROL. El icono real del rol cuando exista (`lib/duel/roleIcons`); mientras tanto, su
 * abreviatura canónica en texto. Si el icono no carga, vuelve al texto (nunca una imagen rota).
 */
import { useState } from "react";
import { cn } from "@/lib/format";
import type { RoleId } from "@/domain/cards/types";
import { roleAbbr, roleIconSrc } from "@/lib/duel/roleIcons";

export function RoleMark({ role, className }: { role: RoleId; className?: string }) {
  const src = roleIconSrc(role);
  const [failed, setFailed] = useState(false);
  return (
    <span
      data-testid="role-mark"
      data-role={role}
      data-role-kind={src && !failed ? "icon" : "text"}
      className={cn(
        "inline-flex items-center justify-center rounded-[3px] border border-white/20 bg-[#0b0c12]/90 px-[0.35em] font-display font-bold uppercase leading-none tracking-[0.06em] text-white/90",
        className,
      )}
    >
      {src && !failed ? (
        <img src={src} alt="" draggable={false} onError={() => setFailed(true)} className="block h-[1.1em] w-[1.1em] select-none object-contain" />
      ) : (
        roleAbbr(role)
      )}
    </span>
  );
}
