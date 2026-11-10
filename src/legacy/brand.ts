/**
 * MARCA DEL CLUB — identidad/estilo/popularidad/reconocimiento/valor comercial (Fase 6/7).
 *
 * DERIVA de los datos del club en el `WorldState` (títulos/prestigio/fanbase/cantera/fichajes).
 * Determinista y estable (misma entrada ⇒ misma marca). PURO. No persiste estado nuevo.
 */
import type { WorldState } from "@/world";
import type { BrandIdentity } from "./types";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const STYLES = ["Ejecución agresiva", "Control metódico", "Juego coral", "Caos calculado", "Disciplina táctica", "Ritmo demoledor"];

function hash(s: string): number { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export function brandOf(world: WorldState, clubId: string): BrandIdentity {
  const t = world.teams[clubId];
  if (!t) return { clubId, name: clubId, identity: "—", style: "—", popularity: 0, recognition: 0, commercialValue: 0, tier: "—" };
  const academy = Object.values(world.players).filter((p) => p.teamId === clubId && p.origin === "academy").length;
  const bigBuys = world.transfers.filter((x) => x.to === clubId && x.kind === "transfer" && x.fee > 15000).length;

  const identity = t.titles >= 5 ? "Dinastía dominante" : bigBuys >= 2 ? "Proyecto de estrellas" : academy >= 2 ? "Cantera de oro" : t.prestige < 45 ? "Underdog con hambre" : "Proyecto sólido";
  const style = STYLES[hash(clubId) % STYLES.length];
  const popularity = clamp(Math.round(t.fanbase / 50), 0, 100);
  const recognition = clamp(Math.round(t.prestige * 0.7 + t.titles * 4), 0, 100);
  const commercialValue = Math.round(t.fanbase * 10 + t.prestige * 400 + t.titles * 2000);
  const tier = recognition >= 80 ? "Marca mundial" : recognition >= 60 ? "Marca continental" : recognition >= 40 ? "Marca regional" : "Marca emergente";
  return { clubId, name: t.name, identity, style, popularity, recognition, commercialValue, tier };
}
