/**
 * PACK WALKOUT · CELEBRACIONES (puro, sin three ni reloj): `WalkoutCelebration`.
 *
 * 0.9 · CAPTURA PRIMERO. Cada gesto sale de movimiento CAPTURADO (Microsoft Rocketbox, MIT) aplicado solo a los huesos
 * que lo hacen (máscaras), sobre el reposo del cuerpo entero — antes eran IK puras sobre el reposo (brazo recto como un
 * palo, giro de muñeca arbitrario, clavícula quieta, mano aplastada contra la cara):
 *   · POINT TO SKY — el brazo derecho de `Cheer_04` (sube con la clavícula, codo flexionado, puño real) + IK de
 *     precisión que solo abre el codo hasta ~30° y lleva la mano sobre la cabeza CONSERVANDO el plano del codo
 *     capturado; índice extendido sobre el puño capturado; torso y mirada acompañan; mantiene y vuelve a bajar con la
 *     bajada capturada del mismo clip.
 *   · SHUSH — el brazo derecho de `TouchFace_01` (mano a la cara, codo abajo) + IK de precisión: la falange media del
 *     índice queda vertical delante de los labios (huesos `MUpperLip`/`MBottomLip`), el resto de dedos recogidos;
 *     cabeza inclinada; vuelve con la bajada capturada.
 *   · HYPE JUMP — saltos de Quaternius (CC0) + el brazo derecho de `Cheer_04` con el puño capturado (antes, IK).
 *   · ARMS CROSSED — `Idle_FoldArms_Loop` SOLO en el tronco y los brazos: piernas y pelvis siguen en el reposo, así que
 *     los pies no se deslizan al cruzar los brazos.
 * `celebrationPose(id, t)` es determinista: mismo instante → misma pose (SALTAR, REPETIR, congelar).
 *
 * Elegir la celebración (`pickCelebration`) es SOLO visual: RANDOM no toca el RNG de los sobres ni ninguna recompensa, y
 * quien llama la fija al empezar la reproducción.
 */
import type { WalkoutIntensity } from "./timeline";

export type CelebrationId = "ARMS_CROSSED" | "HYPE_JUMP" | "SHUSH" | "POINT_SKY";
export type CelebrationChoice = CelebrationId | "RANDOM";

export interface ClipLayer { clip: string; time: number; weight: number }

/** Grupos de huesos a los que se aplica un clip enmascarado. */
export type BoneMask = "armR" | "armL" | "spine" | "neck" | "upper";
/** Un clip aplicado SOLO a un grupo de huesos, mezclado sobre la pose base con `weight`. */
export interface MaskedClip { clip: string; time: number; mask: BoneMask; weight: number }
/** Giro añadido del tronco o de la cabeza en ejes del cuerpo (rad, ya ponderado): pitch + = hacia delante/abajo, yaw + = hacia su izquierda, roll + = inclina hacia su derecha. */
export interface BodyBend { part: "spine" | "neck"; pitch: number; yaw: number; roll: number }
/** Metas de precisión del brazo: mano sobre la cabeza (señalar) · índice delante de los labios. */
export type ArmGoal = "sky" | "lips";
export type HandShape = "fist" | "point" | "shush" | "relaxed";
export interface HandLayer { side: "l" | "r"; shape: HandShape; weight: number }

export interface CelebrationPose {
  /** Clips de cuerpo entero y pesos (suman 1). */
  layers: ClipLayer[];
  /** Clips enmascarados encima (brazo, tronco…). */
  masked: MaskedClip[];
  /** Acompañamiento de tronco y cabeza. */
  bends: BodyBend[];
  /** Elevación de la raíz (m): solo durante el vuelo del salto. */
  lift: number;
  /** IK de precisión del brazo (conserva el plano del codo de la captura). */
  arm: { side: "l" | "r"; goal: ArmGoal; weight: number } | null;
  /** Forma de las manos (dedos de datos capturados). */
  hands: HandLayer[];
}

/**
 * Tramos en los que un pie se queda CLAVADO al suelo mientras cambia la pose (la raíz compensa) y el otro, si tiene que
 * moverse, va por el aire. Sin esto, pasar del reposo (piernas abiertas) a la carrerilla del salto arrastraría los pies.
 */
export interface FootLock { from: number; to: number; side: "l" | "r" }

export type CelebrationFraming = "close" | "medium" | "wide";

export interface CelebrationDef {
  id: CelebrationId;
  label: string;
  /** Segundos hasta la pose final (después se mantiene). */
  duration: number;
  framing: CelebrationFraming;
  locks: FootLock[];
  /** Clips que necesita (si falta alguno: pose segura = reposo, y la escena sigue). */
  clips: string[];
  /** Solo las que pasaron la revisión visual se ofrecen. */
  enabled: boolean;
  /** Por qué no se ofrece (si `enabled` es false). */
  disabledReason?: string;
}

/** Reposo base al llegar (antes de celebrar) y clips de cada gesto. */
export const BASE_IDLE = "Idle_Loop";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const ss = (x: number) => { const k = clamp01(x); return k * k * (3 - 2 * k); };
const fade = (t: number, at: number, dur: number) => ss((t - at) / dur);
/** Sube en [a, a+da] y baja en [b, b+db]. */
const envelope = (t: number, a: number, da: number, b: number, db: number) => fade(t, a, da) * (1 - fade(t, b, db));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** HYPE JUMP: medidas del salto (física real: h = g·T²/8). */
export const HYPE = {
  /** Agacharse: del reposo a la carrerilla de `Jump_Start` (que empieza agachado). */
  crouch: 0.38,
  /**
   * Despegue: `Jump_Start` 0 → 0,1 s a ~1/3 de velocidad (0,28 s: lo que dura un impulso real). 0.9: a velocidad real la pelvis se estiraba en 0,07 s
   * y la cabeza saltaba 16 cm entre fotogramas (≈ 10 m/s): se veía como un tirón, no como un impulso.
   */
  takeoff: 0.28,
  /** Vuelo: 0,49 s ⇒ 30 cm de altura con g = 9,8 m/s² (h = g·T²/8). */
  flight: 0.49,
  height: 0.3,
  /** `Jump_Land` dura 1,267 s: amortigua y se levanta; luego vuelve al reposo. */
  land: 0.95,
  settle: 0.35,
} as const;
export const HYPE_TIMES = (() => {
  const t0 = HYPE.crouch, t1 = t0 + HYPE.takeoff, t2 = t1 + HYPE.flight, t3 = t2 + HYPE.land, t4 = t3 + HYPE.settle;
  return { crouchEnd: t0, takeoffEnd: t1, landAt: t2, landEnd: t3, end: t4 };
})();

/**
 * POINT TO SKY (s desde el beat). Medido en `Cheer_04` (Rocketbox): la mano sube de 0,3 a 1,1 s, se mantiene arriba
 * hasta 3,5 s y baja de 3,5 a 4,6 s. Su subida es de DOS brazos y abre el brazo en horizontal (con uno solo parece un
 * barrido rígido): la subida sale de `POINT_RISE` y de `Cheer_04` se usan la pose alta y la bajada (un 20 % más rápida:
 * cabe en los 2,5 s que hay hasta el destello del WALKOUT).
 */
export const POINT = { raise: 0.8, enter: 0.4, holdEnd: 1.55, lowerEnd: 2.45, clip: "Cheer_04", clipRaise: [1.1, 1.2], clipLower: [3.5, 4.6] } as const;
/** Subida de un solo brazo (medida en `TouchFace_01`: la mano pasa de la cadera a la sien, codo de 22° a 126°). */
export const POINT_RISE = { clip: "TouchFace_01", from: 0.3, to: 0.95, dur: 0.55 } as const;
/**
 * SHUSH (s desde el beat). Medido en `TouchFace_01`: la mano sube a la cara de 0,3 a 1,2 s y baja de 4,4 a 5,2 s.
 * `reach`: el índice llega a los labios (el «shhh» del audio y el silencio del público se sincronizan aquí).
 */
export const SHUSH = { reach: 0.75, raise: 0.75, enter: 0.25, holdEnd: 1.65, lowerEnd: 2.45, clip: "TouchFace_01", clipRaise: [0.3, 1.2], clipLower: [4.4, 5.2] } as const;
/** Captura con el brazo arriba y el puño cerrado (puño de HYPE y base del índice de POINT). */
export const FIST_CLIP = "Cheer_04";

export const CELEBRATIONS: Readonly<Record<CelebrationId, CelebrationDef>> = {
  ARMS_CROSSED: {
    id: "ARMS_CROSSED", label: "Brazos cruzados", duration: 0.9, framing: "medium", enabled: true,
    clips: [BASE_IDLE, "Idle_FoldArms_Loop", FIST_CLIP], locks: [],
  },
  HYPE_JUMP: {
    id: "HYPE_JUMP", label: "Salto + puño", duration: HYPE_TIMES.end, framing: "wide", enabled: true,
    clips: [BASE_IDLE, "Jump_Start", "Jump_Land", FIST_CLIP, POINT_RISE.clip],
    locks: [{ from: 0, to: HYPE_TIMES.crouchEnd, side: "l" }, { from: HYPE_TIMES.landEnd, to: HYPE_TIMES.end, side: "l" }],
  },
  SHUSH: {
    id: "SHUSH", label: "Silencio (shush)", duration: SHUSH.lowerEnd, framing: "close", enabled: true,
    clips: [BASE_IDLE, SHUSH.clip, FIST_CLIP], locks: [],
  },
  POINT_SKY: {
    id: "POINT_SKY", label: "Señalar al cielo", duration: POINT.lowerEnd, framing: "medium", enabled: true,
    clips: [BASE_IDLE, POINT.clip, POINT_RISE.clip, FIST_CLIP], locks: [],
  },
};

export const CELEBRATION_IDS = Object.keys(CELEBRATIONS) as CelebrationId[];
export const enabledCelebrations = (): CelebrationId[] => CELEBRATION_IDS.filter((id) => CELEBRATIONS[id].enabled);

/**
 * Qué celebración se ve. RANDOM elige entre las habilitadas con el `rand` que pase quien llama (visual: nunca el RNG de
 * sobres). Una no habilitada cae a la primera habilitada.
 */
export function pickCelebration(choice: CelebrationChoice, rand: () => number): CelebrationId {
  const ok = enabledCelebrations();
  if (!ok.length) return "ARMS_CROSSED";
  if (choice === "RANDOM") return ok[Math.min(ok.length - 1, Math.floor(rand() * ok.length))];
  return CELEBRATIONS[choice]?.enabled ? choice : ok[0];
}

/** Por intensidad: STANDARD sin persona; RARE una pose breve (brazos cruzados); WALKOUT y MEGA la celebración completa. */
export function celebrationForIntensity(intensity: WalkoutIntensity, chosen: CelebrationId): CelebrationId | null {
  if (intensity === "STANDARD") return null;
  if (intensity === "RARE") return "ARMS_CROSSED";
  return chosen;
}

/**
 * Un gesto de brazo capturado en tres tramos: SUBIDA (clip a velocidad real) → MANTIENE (el clip sigue, despacio) →
 * BAJADA (la bajada capturada). Entre mantener y bajar, las dos lecturas del clip se funden 0,2 s (las dos están en la
 * pose alta: no hay salto). Devuelve las capas enmascaradas del brazo.
 */
function capturedArm(k: number, g: { raise: number; enter: number; holdEnd: number; lowerEnd: number; clip: string; clipRaise: readonly [number, number]; clipLower: readonly [number, number] }, mask: BoneMask, holdRate: number): MaskedClip[] {
  const [r0, r1] = g.clipRaise, [l0, l1] = g.clipLower;
  const up = k < g.raise ? lerp(r0, r1, k / g.raise) : r1 + (k - g.raise) * holdRate;
  const down = lerp(l0, l1, clamp01((k - g.holdEnd) / (g.lowerEnd - g.holdEnd)));
  const x = fade(k, g.holdEnd - 0.1, 0.2);                       // fundido «mantener» → «bajar»
  const enter = fade(k, 0, g.enter);                             // del reposo al primer fotograma usado, sin chasquido
  const leave = 1 - fade(k, g.lowerEnd - 0.35, 0.35);            // al final, el brazo es otra vez el del reposo
  const w = enter * leave;
  return [{ clip: g.clip, time: up, mask, weight: w * (1 - x) }, { clip: g.clip, time: down, mask, weight: w * x }].filter((m) => m.weight > 0);
}

/**
 * El brazo de POINT: la SUBIDA es la de un solo brazo de `TouchFace_01` (la mano sube junto a la cara con el codo
 * flexionado, 0,3 → 1,0 s), que se funde con la pose alta de `Cheer_04` mientras la IK de precisión estira hacia el cielo;
 * mantiene y baja con la bajada capturada de `Cheer_04`. (Fundir el reposo directamente con la pose alta pasa por un
 * brazo casi recto hacia delante.)
 */
function pointArm(k: number): MaskedClip[] {
  const P = POINT;
  const high = capturedArm(k, P, "armR", 0.35);                  // Cheer_04: pose alta → bajada capturada
  const rise = { clip: POINT_RISE.clip, time: lerp(POINT_RISE.from, POINT_RISE.to, clamp01(k / POINT_RISE.dur)), mask: "armR" as const };
  const x = fade(k, POINT_RISE.dur - 0.2, 0.35);                 // subida (una mano) → pose alta
  const enter = fade(k, 0, 0.25);                                // la captura arranca del reposo: entra en 0,25 s
  return [{ ...rise, weight: enter * (1 - x) }, ...high.map((m) => ({ ...m, weight: m.weight * x }))].filter((m) => m.weight > 0);
}

/** La pose de la celebración a `t` s de su inicio (`idleTime`: el reloj del reposo base, que sigue corriendo). */
export function celebrationPose(id: CelebrationId, t: number, idleTime: number): CelebrationPose {
  const k = Math.max(0, t);
  const idle = (w: number): ClipLayer => ({ clip: BASE_IDLE, time: idleTime, weight: w });
  switch (id) {
    case "ARMS_CROSSED": {
      // tronco y brazos del clip; piernas y pelvis del reposo (los pies no se mueven); manos medio recogidas
      const w = fade(k, 0, 0.85);
      return {
        layers: [idle(1)], masked: [{ clip: "Idle_FoldArms_Loop", time: idleTime, mask: "upper", weight: w }], bends: [], lift: 0, arm: null,
        hands: [{ side: "r", shape: "relaxed", weight: w }, { side: "l", shape: "relaxed", weight: w }],
      };
    }
    case "POINT_SKY": {
      // 1) gira y abre el pecho; 2) el brazo capturado sube; 3) la IK de precisión estira hasta ~30° de codo; 4) la
      // mirada sube con la mano; mantiene; 5) baja con la bajada capturada y todo vuelve al reposo
      const P = POINT;
      const body = envelope(k, 0, 0.45, P.holdEnd - 0.05, P.lowerEnd - P.holdEnd);
      const look = envelope(k, 0.25, 0.5, P.holdEnd, 0.7);
      return {
        layers: [idle(1)],
        masked: [...pointArm(k), ...capturedArm(k, P, "spine", 0.35).map((m) => ({ ...m, weight: m.weight * 0.35 }))],
        bends: [{ part: "spine", pitch: -0.06 * body, yaw: 0.14 * body, roll: -0.05 * body }, { part: "neck", pitch: -0.32 * look, yaw: -0.1 * look, roll: 0.03 * look }],
        lift: 0,
        arm: { side: "r", goal: "sky", weight: envelope(k, 0.12, 0.6, P.holdEnd, 0.45) },
        hands: [{ side: "r", shape: "point", weight: envelope(k, 0.2, 0.45, P.holdEnd - 0.05, 0.4) }],
      };
    }
    case "SHUSH": {
      // 1) mira a cámara y la mano capturada sube a la cara; 2) la IK de precisión lleva la falange media del índice
      // delante de los labios, vertical; los demás dedos recogidos; 3) cabeza un poco inclinada; mantiene; 4) baja
      const S = SHUSH;
      const head = envelope(k, 0.2, 0.5, S.holdEnd, 0.7);
      return {
        layers: [idle(1)],
        masked: capturedArm(k, S, "armR", 0.45),
        bends: [{ part: "spine", pitch: 0.04 * head, yaw: 0.05 * head, roll: 0 }, { part: "neck", pitch: 0.12 * head, yaw: 0.03 * head, roll: -0.07 * head }],
        lift: 0,
        arm: { side: "r", goal: "lips", weight: envelope(k, 0.3, 0.45, S.holdEnd, 0.35) },
        hands: [{ side: "r", shape: "shush", weight: envelope(k, 0.25, 0.45, S.holdEnd - 0.1, 0.45) }],
      };
    }
    case "HYPE_JUMP": {
      const T = HYPE_TIMES;
      // el puño sube CON el despegue: el brazo derecho toma la pose alta capturada de `Cheer_04` (codo flexionado,
      // clavícula arriba) y la IK de precisión la lleva sobre la cabeza en vertical del MUNDO (con el tronco inclinado del
      // salto, la pose capturada sola apuntaría hacia delante). El izquierdo, relajado (el del reposo) en vez del brazo
      // rígido en cruz de los clips de salto; vuelve a ellos al asentarse.
      // subida de un brazo con el codo flexionado (la de POINT) durante la carrerilla → pose alta al despegar
      const enter = fade(k, 0.06, 0.22);
      const x = fade(k, T.crouchEnd - 0.08, 0.5);                // el puño culmina en lo alto del vuelo
      const rise = lerp(POINT_RISE.from, POINT_RISE.to, clamp01((k - 0.06) / (T.crouchEnd + 0.1)));
      const leftW = 0.75 * fade(k, T.crouchEnd - 0.3, 0.32) * (1 - fade(k, T.landEnd, HYPE.settle));
      const masked: MaskedClip[] = [
        { clip: POINT_RISE.clip, time: rise, mask: "armR" as const, weight: enter * (1 - x) },
        { clip: FIST_CLIP, time: 1.2 + k * 0.4, mask: "armR" as const, weight: enter * x },
        { clip: BASE_IDLE, time: idleTime, mask: "armL" as const, weight: leftW },
      ].filter((m) => m.weight > 0);
      const hands: HandLayer[] = [{ side: "r", shape: "fist", weight: fade(k, T.crouchEnd - 0.1, 0.25) }];
      const base = { masked, bends: [] as BodyBend[], arm: { side: "r" as const, goal: "sky" as const, weight: fade(k, T.crouchEnd - 0.05, 0.55) }, hands };
      if (k < T.crouchEnd) {                                     // se agacha: del reposo a la carrerilla (Jump_Start @0)
        const w = ss(k / T.crouchEnd);
        return { ...base, layers: [idle(1 - w), { clip: "Jump_Start", time: 0, weight: w }], lift: 0 };
      }
      if (k < T.landAt) {                                        // despegue y vuelo
        const clipT = k < T.takeoffEnd ? ((k - T.crouchEnd) / HYPE.takeoff) * 0.1 : Math.min(0.6, 0.1 + (k - T.takeoffEnd));
        const u = Math.max(0, (k - T.takeoffEnd) / HYPE.flight);
        // al bajar, las piernas se estiran hacia la pose de toma de contacto (Jump_Land @0): tocan el suelo extendidas
        const reach = ss((u - 0.5) / 0.5);
        return { ...base, layers: [{ clip: "Jump_Start", time: clipT, weight: 1 - reach }, { clip: "Jump_Land", time: 0, weight: reach }], lift: k < T.takeoffEnd ? 0 : 4 * HYPE.height * u * (1 - u) };
      }
      if (k < T.landEnd) {                                       // aterriza: amortigua y se levanta
        return { ...base, layers: [{ clip: "Jump_Land", time: k - T.landAt, weight: 1 }], lift: 0 };
      }
      const w = ss((k - T.landEnd) / HYPE.settle);              // vuelve al reposo con el puño arriba
      return { ...base, layers: [{ clip: "Jump_Land", time: HYPE.land, weight: 1 - w }, idle(w)], lift: 0 };
    }
  }
}
