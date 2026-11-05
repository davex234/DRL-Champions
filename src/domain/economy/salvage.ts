/**
 * DESGUACE DE CARTAS — el sumidero de duplicados (Fase 11).
 *
 * ────────────────────────── EL PROBLEMA QUE RESUELVE ──────────────────────────
 *
 * A partir de unas 300 cartas, **una de cada cuatro que salen de un sobre ya la tienes**;
 * con la colección completa, todas. Hasta la Fase 11 un duplicado no valía absolutamente
 * nada con cuenta iniciada: la venta rápida existe pero está deshabilitada online desde la
 * Fase B, y el mercado entre jugadores lleva cerrado desde la Fase A.
 *
 * ─────────── POR QUÉ NO SE USA `quickSellValue` (eliminada en la F57.6: la venta local ya paga `salvageValue`) ───────────
 *
 * Esta es la decisión importante de la fase, y sale de medir, no de opinar.
 *
 * `marketValue` (`domain/economy/pricing`) tasa una carta por su rareza y su media con dos
 * exponenciales. Es una buena tasación de COLECCIONISTA. El problema es que nunca se
 * reconcilió con el precio de los sobres. Abriendo 4.000 sobres de cada tipo con el motor
 * real, el valor de mercado de lo que sale es:
 *
 *   | Sobre     | Precio | Valor de lo que sale | Venta rápida (80 %) |
 *   |-----------|--------|----------------------|---------------------|
 *   | Estándar  |    750 |                7.899 |               6.319 |
 *   | Premium   |  2.500 |               36.771 |              29.417 |
 *   | Champions |  8.000 |               99.839 |              79.871 |
 *   | Icon      | 20.000 |              180.481 |             144.385 |
 *
 * Es decir: entre **7 y 15 veces el precio**. Abrir un sobre Premium y vender sus seis
 * cartas al 80 % devolvería 29.417 créditos por una compra de 2.500. Eso no es una
 * economía con un sumidero: es una impresora de dinero con un botón.
 *
 * Que la venta rápida estuviera apagada nos salvó por accidente — se apagó por un problema
 * de autoridad (el saldo lo borraba la sincronización), no porque nadie hubiera hecho esta
 * cuenta.
 *
 * ────────────────────────── CÓMO SE CALIBRA ──────────────────────────
 *
 * (HISTÓRICO, Fase 11 — sustituido en la F57.5 por la fracción de abajo; la regla se mantiene.)
 * La regla: desguazar un sobre ENTERO tiene que devolver bastante menos de lo que costó.
 * Con la tabla por rareza de entonces, midiendo con el motor real:
 *
 *   | Sobre     | Precio | Desguace completo | Recuperación |
 *   |-----------|--------|-------------------|--------------|
 *   | Estándar  |    750 |               354 |          47 % |
 *   | Premium   |  2.500 |             1.006 |          40 % |
 *   | Masters   |  5.000 |             1.710 |          34 % |
 *   | Champions |  8.000 |             2.265 |          28 % |
 *   | Prime     | 10.000 |             2.107 |          21 % |
 *   | Icon      | 20.000 |             3.060 |          15 % |
 *
 * Y eso es el PEOR caso, porque solo se desguazan duplicados. Con una colección de 300
 * cartas, uno de cada cuatro naipes es duplicado, así que la recuperación real ronda el
 * 10 % del precio del sobre. Es un consuelo por el duplicado, no una vía de ingresos.
 *
 * La recuperación **cae con la rareza del sobre** a propósito: los sobres caros se compran
 * por la carta que puede salir, no por el material. Si el Icon devolviera el mismo
 * porcentaje que el Estándar, comprar Icon para desguazar sería una estrategia.
 *
 * ────────────────────────── LO QUE NO HACE ──────────────────────────
 *
 * Este módulo es PURO. No borra cartas, no paga y no sabe quién juega. Devuelve un
 * importe; quien lo entrega es `app_salvage_cards`, que comprueba en la misma transacción
 * que las cartas son tuyas y que no están bloqueadas por un listado del mercado.
 *
 * **El cliente nunca envía el importe.** Lo calcula el servidor con esta tabla a partir del
 * `card_id`, que es lo único que el cliente puede nombrar.
 */
import type { CardDef } from "../cards/types";
import { marketValue } from "./pricing";

/*
 * ────────────────────────── FASE 57.5 — FRACCIÓN DEL VALOR, NO TABLA POR RAREZA ──────────────────────────
 *
 * Hasta la F57.5 esto era una tabla por bucket de rareza (común 30 · poco común 70 · rara 200 · épica 600 · legendaria
 * 1.600). El bucket sale del rank de la edición y hereda su inversión: future-star (Prime) es «rara» y champions-s es
 * «épica», así que una Prime pagaba 200 y una Champions 600, al revés que la jerarquía de producto.
 *
 * Ahora el desguace es una fracción CONSERVADORA de `marketValue`, que ya sigue la jerarquía de clase y el OVR:
 *
 *   salvageValue = max(5, redondeo(6 % × marketValue))      redondeo: a 5 bajo 100, a 10 bajo 1.000, a 50 por encima
 *
 * Por qué 6 % (medido, no copiado; `docs/product/fase-57-5-card-value-implementation.md`):
 *   · desguazar un sobre ENTERO de la línea principal devuelve ~23–34 % de su precio (antes ~28–38 %): lejos del 70 %;
 *   · la peor carta desguaza al 10 % de su valor (el suelo de 5 sobre la Base de OVR 70, que vale 50): por debajo de la
 *     banda inferior del mercado (`min_price_mult` = 0,2), así que comprar en el mercado para desguazar nunca rinde;
 *   · medianas y medias por clase crecen Base < Plata < Oro < Masters < Champions < Prime < Icon.
 *
 * La recuperación sigue cayendo con la gama del sobre (Icon ~23 %), porque el Icon se compra por la garantía de top tier.
 */

/** Fracción del valor de mercado que paga el desguace. */
export const SALVAGE_RATE = 0.06;
/** Lo mínimo que paga una carta: nunca 0. */
export const SALVAGE_FLOOR = 5;

/** Redondeo del desguace: a 5 por debajo de 100, a 10 por debajo de 1.000 y a 50 por encima. */
export function salvageRound(raw: number): number {
  const step = raw < 100 ? 5 : raw < 1_000 ? 10 : 50;
  return Math.round(raw / step) * step;
}

/**
 * ¿Cuánto vale desguazar ESTA carta?
 *
 * No depende del número de serie (usa `marketValue`, no `instanceValue`). Es deliberado: una carta serializada del #1
 * vale una fortuna para un coleccionista y eso es asunto del mercado entre jugadores, no del desguace. Pagar el
 * desguace por serie convertiría el sistema en una tasación paralela al mercado, con dos precios para la misma carta.
 */
export function salvageValue(card: Pick<CardDef, "variantId" | "ovr">): number {
  return Math.max(SALVAGE_FLOOR, salvageRound(SALVAGE_RATE * marketValue(card)));
}

/** Total de un lote. Se suma en enteros: no hay céntimos en esta economía. */
export function salvageTotal(cards: CardDef[]): number {
  return cards.reduce((sum, c) => sum + salvageValue(c), 0);
}

/**
 * ¿Se puede desguazar esta carta?
 *
 * La regla de producto: **solo duplicados**. Desguazar la única copia de una carta es
 * destruir colección, y una colección que se puede vaciar por accidente con un botón es
 * una colección que nadie va a tocar. Si algún día se quiere permitir, es esta función la
 * que cambia y ninguna otra.
 *
 * `copies` es cuántos ejemplares de esa MISMA carta posee el jugador.
 */
export function canSalvage(copies: number): boolean {
  return copies > 1;
}

/**
 * Cuántos ejemplares de cada carta se pueden desguazar conservando uno.
 *
 * Se expone aparte de `canSalvage` porque la interfaz necesita ofrecer «desguazar todos
 * los duplicados» y el servidor necesita validar exactamente lo mismo. Una sola función
 * evita que la pantalla ofrezca algo que el servidor va a rechazar.
 */
export function salvageableCount(copies: number): number {
  return Math.max(0, copies - 1);
}
