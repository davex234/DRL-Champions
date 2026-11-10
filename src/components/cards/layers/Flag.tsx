"use client";

import { useEffect, useState } from "react";
import { flagSrc } from "@/lib/assets";

/**
 * Bandera real del país (imagen LOCAL, F72.3). Fallback: chip con el código ISO (si no hay bandera local o no carga).
 */
export function Flag({ iso, width = 22 }: { iso: string; width?: number }) {
  const src = flagSrc(iso);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={iso}
        onError={() => setFailed(true)}
        className="rounded-sm object-cover shadow"
        style={{ width, height: width * 0.66 }}
        draggable={false}
      />
    );
  }

  return (
    <span
      className="grid place-items-center rounded-sm bg-black/40 font-display font-bold text-white"
      style={{ width, height: width * 0.66, fontSize: width * 0.4 }}
    >
      {iso.toUpperCase()}
    </span>
  );
}
