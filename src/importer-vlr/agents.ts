/**
 * REGISTRO DE AGENTES — slug de imagen de VLR ("/img/vlr/game/agents/kayo.png") → nombre canónico.
 *
 * Solo mapeo de datos (cero lógica de juego). Un agente desconocido NO es un estado imposible:
 * se capitaliza el slug (VLR añade agentes nuevos antes de que este registro se actualice).
 */

const AGENT_BY_SLUG: Record<string, string> = {
  astra: "Astra", breach: "Breach", brimstone: "Brimstone", chamber: "Chamber", clove: "Clove",
  cypher: "Cypher", deadlock: "Deadlock", fade: "Fade", gekko: "Gekko", harbor: "Harbor",
  iso: "Iso", jett: "Jett", kayo: "KAY/O", killjoy: "Killjoy", neon: "Neon", omen: "Omen",
  phoenix: "Phoenix", raze: "Raze", reyna: "Reyna", sage: "Sage", skye: "Skye", sova: "Sova",
  tejo: "Tejo", viper: "Viper", vyse: "Vyse", waylay: "Waylay", yoru: "Yoru",
};

/** Nombre canónico desde un slug ("kayo" → "KAY/O"; desconocido → capitalizado). */
export function agentName(slug: string): string {
  const key = slug.toLowerCase().trim();
  return AGENT_BY_SLUG[key] ?? (key ? key[0].toUpperCase() + key.slice(1) : key);
}

/** Extrae el nombre de agente desde el `src` de una imagen de VLR. `undefined` si no es de agente. */
export function agentFromSrc(src: string): string | undefined {
  const m = /\/agents\/([a-z0-9-]+)\.(?:png|webp)/i.exec(src);
  return m ? agentName(m[1]) : undefined;
}
