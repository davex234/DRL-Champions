/**
 * MICRODECISIONES — el entrenador interviene SOLO en momentos clave.
 *
 * Lee el RoundState en vivo y detecta situaciones que merecen una decisión del
 * entrenador (desventaja numérica, post-plant, clutch, ventaja para cerrar). NO se
 * dispara constantemente: cada tipo salta una vez por ronda. Las opciones se traducen
 * a `CoachCall` (que el sim ya entiende vía `applyCall`) — el entrenador nunca mueve
 * a un jugador.
 */
import type { CoachCallId, RoundState, Side } from "@/sim";

export interface MicroOption {
  label: string;
  /** Orden que se aplica (consume Voz). Ausente = "no intervenir / confío en el IGL". */
  call?: CoachCallId;
  tone?: "danger" | "go" | "calm";
}

export interface MicroPrompt {
  /** Clave única del disparador (para no repetirlo en la misma ronda). */
  key: string;
  title: string;
  situation: string;
  options: MicroOption[];
}

const HOLD = { label: "Confío en mi IGL", tone: "calm" as const };

function alive(round: RoundState, side: Side): number {
  return round.players.filter((p) => p.side === side && p.alive).length;
}

/**
 * Devuelve la microdecisión pertinente o null. `fired` lleva las keys ya mostradas
 * esta ronda. Solo propone si quedan Voz y la ronda sigue viva.
 */
export function detectMicro(round: RoundState, fired: Set<string>): MicroPrompt | null {
  if (round.phase === "ENDED" || round.voz.left <= 0) return null;

  const us = round.coachSide;
  const them: Side = us === "ATK" ? "DEF" : "ATK";
  const a = alive(round, us);
  const b = alive(round, them);
  const planted = round.spike.planted;

  // 1) Clutch: último vivo contra varios.
  if (a === 1 && b >= 2 && !fired.has("clutch")) {
    return {
      key: "clutch",
      title: "CLUTCH",
      situation: `Te quedas 1 contra ${b}. La ronda está en sus manos.`,
      options: [
        { label: "Juega por picks (paciencia)", call: "play-picks", tone: "calm" },
        ...(us === "DEF" && planted ? [{ label: "Compromete el retake", call: "rush" as CoachCallId, tone: "go" as const }] : []),
        { label: "Salva el arma", call: "save", tone: "danger" },
        HOLD,
      ],
    };
  }

  // 2) Post-plant.
  if (planted && !fired.has("postplant")) {
    return us === "ATK"
      ? {
          key: "postplant",
          title: "POST-PLANT",
          situation: "Spike plantada. Hay que defender el plante.",
          options: [
            { label: "Reagrupar y cerrar líneas", call: "regroup", tone: "calm" },
            { label: "Jugar por picks", call: "play-picks", tone: "calm" },
            HOLD,
          ],
        }
      : {
          key: "postplant",
          title: "RETAKE",
          situation: "El rival ha plantado. Toca decidir el retake.",
          options: [
            { label: "Comprometer el retake YA", call: "rush", tone: "go" },
            { label: "Jugar por picks (esperar error)", call: "play-picks", tone: "calm" },
            { label: "Salvar la ronda", call: "save", tone: "danger" },
            HOLD,
          ],
        };
  }

  // 3) Desventaja numérica fuerte.
  if (b - a >= 2 && a > 0 && !fired.has("disadvantage")) {
    return {
      key: "disadvantage",
      title: "EN DESVENTAJA",
      situation: `Vamos ${a} contra ${b}. Hay que tomar una decisión.`,
      options: [
        { label: "Reagrupar", call: "regroup", tone: "calm" },
        { label: "Jugar por picks", call: "play-picks", tone: "calm" },
        { label: "Salvar el armamento", call: "save", tone: "danger" },
        HOLD,
      ],
    };
  }

  // 4) Ventaja numérica para cerrar (solo ATK: ejecutar).
  if (us === "ATK" && a - b >= 2 && b > 0 && !planted && !fired.has("advantage")) {
    return {
      key: "advantage",
      title: "VENTAJA",
      situation: `Vamos ${a} contra ${b}. Ventana para ejecutar.`,
      options: [
        { label: "¡Execute ya!", call: "execute", tone: "go" },
        { label: "Rush al sitio", call: "rush", tone: "go" },
        HOLD,
      ],
    };
  }

  return null;
}
