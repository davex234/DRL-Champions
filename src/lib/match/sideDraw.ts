/**
 * EL SORTEO DEL LADO INICIAL — 50/50, y no lo elige nadie.
 *
 * ────────────────────────── POR QUÉ ES UN MÓDULO ──────────────────────────
 *
 * Porque era un bug y los bugs se arreglan con algo que se pueda comprobar. Hasta ahora la
 * pantalla previa ofrecía dos píldoras —Ataque / Defensa— y el jugador se quedaba con el lado
 * que prefería. Eso no es una preferencia de interfaz: es media ventaja de partido regalada,
 * porque atacar y defender no valen lo mismo en la misma composición.
 *
 * Metido aquí, en tres líneas puras y sin React, el reparto se puede probar de verdad: que
 * salgan los dos lados, que ninguno domine en una muestra grande y que la función sea
 * determinista si se le da un generador determinista.
 *
 * ────────────────────────── EL GENERADOR ──────────────────────────
 *
 * Se inyecta. En producción es `Math.random`; en las pruebas, una secuencia fija. Un módulo
 * que llama a `Math.random` por dentro es un módulo que no se puede verificar sin contar
 * miles de tiradas y cruzar los dedos.
 */
import type { Side } from "@/sim";

/** Los dos lados, en el orden en que se presentan. `Side` del simulador: "ATK" | "DEF". */
export const SIDES: readonly Side[] = ["ATK", "DEF"];

export const SIDE_NAME: Record<Side, string> = {
  ATK: "Ataque",
  DEF: "Defensa",
};

/**
 * Saca un lado. Exactamente 50/50.
 *
 * El corte está en 0,5 sobre un generador uniforme en [0, 1): la mitad exacta del recorrido a
 * cada lado. No hay ajuste por racha, ni por dificultad, ni por lo que saliera la vez
 * anterior — cualquiera de esas cosas convertiría un sorteo en una decisión disfrazada.
 */
export function drawSide(rand: () => number = Math.random): Side {
  return rand() < 0.5 ? "ATK" : "DEF";
}
