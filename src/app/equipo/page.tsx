/**
 * `/equipo` — alias de la ruta canónica de equipos (Fase 32). No es una segunda experiencia: redirige a
 * `/duelos/mazos` conservando solo los parámetros que el constructor entiende.
 */
import { redirect } from "next/navigation";

export default async function EquipoAlias({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const k of ["deck", "nuevo", "add"]) {
    const v = sp[k];
    if (typeof v === "string" && /^[0-9a-z-]{1,64}$/i.test(v)) q.set(k, v);
  }
  const qs = q.toString();
  redirect(qs ? `/duelos/mazos?${qs}` : "/duelos/mazos");
}
