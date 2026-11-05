/**
 * AGENT ENGINE — CAPACIDADES (no habilidades).
 *
 * Un agente NO se define por habilidades concretas, sino por un PERFIL DE CAPACIDADES:
 * cuánto aporta en cada eje del juego profesional (control, info, entrada, retake…).
 * Todo el motor (composición, táctica, combate, coach) razona sobre este vector
 * genérico — por eso añadir un agente nuevo es SOLO escribir un perfil de datos, sin
 * tocar ninguna lógica. Map-agnóstico y sin efectos/visuales.
 */

/** Los ejes del juego que un agente puede cubrir. Ampliar = añadir aquí. */
export const CAPABILITIES = [
  "control",      // negar/partir espacio (humos) — defaults lentos
  "initiation",   // abrir el sitio con utilidad coordinada
  "information",  // revelar posiciones / leer al rival (recon)
  "entry",        // ser el primero en entrar y ganar el duelo de apertura
  "anchor",       // aguantar un sitio en solitario
  "retake",       // recuperar un sitio plantado
  "postplant",    // defender el plante / cerrar líneas tras plantar
  "lurk",         // jugar flanco/timings en solitario
  "rotation",     // moverse rápido por el mapa / reposicionar
  "trading",      // refragar al instante
  "survival",     // sobrevivir, salvar, clutchear
  "space",        // tomar y mantener terreno
  "pressure",     // forzar reacciones del rival
  "fake",         // simular ejecuciones y reubicar
  "utility",      // cantidad/calidad de utilidad disponible
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Perfil de capacidades 0..100 (50 = aporte medio). */
export type CapabilityProfile = Record<Capability, number>;

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

/** Perfil con todas las capacidades a `base`. */
export function uniformProfile(base = 15): CapabilityProfile {
  const p = {} as CapabilityProfile;
  for (const c of CAPABILITIES) p[c] = base;
  return p;
}

/** Construye un perfil a partir de overrides parciales (resto = `base`). */
export function makeProfile(partial: Partial<CapabilityProfile>, base = 15): CapabilityProfile {
  const p = uniformProfile(base);
  for (const c of CAPABILITIES) if (partial[c] != null) p[c] = clamp(partial[c]!);
  return p;
}

/** Suma de dos perfiles (sin clamp, para agregados de equipo). */
export function addProfiles(a: CapabilityProfile, b: CapabilityProfile): CapabilityProfile {
  const out = {} as CapabilityProfile;
  for (const c of CAPABILITIES) out[c] = a[c] + b[c];
  return out;
}

/** Escala un perfil. */
export function scaleProfile(a: CapabilityProfile, k: number): CapabilityProfile {
  const out = {} as CapabilityProfile;
  for (const c of CAPABILITIES) out[c] = a[c] * k;
  return out;
}

/** Capacidad dominante de un perfil. */
export function dominant(p: CapabilityProfile): Capability {
  return CAPABILITIES.reduce((a, b) => (p[b] > p[a] ? b : a), CAPABILITIES[0]);
}

/** Etiquetas legibles (para coach/broadcast/narrativa). */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  control: "Control", initiation: "Iniciación", information: "Información", entry: "Entrada",
  anchor: "Anclaje", retake: "Retake", postplant: "Post-plant", lurk: "Lurk", rotation: "Rotación",
  trading: "Trading", survival: "Supervivencia", space: "Espacio", pressure: "Presión",
  fake: "Fake", utility: "Utilidad",
};
