/**
 * I18N · FRASES CON TROZOS RESALTADOS.
 *
 * Una frase con una palabra en negrita no se parte en fragmentos («Centro de» + «Eventos»): el orden de las palabras
 * cambia con el idioma. Se traduce ENTERA, con una variable donde va cada trozo, y el trozo se pinta después:
 *
 *   fill(t("Centro de {word}", slots("word")), { word: <span className="text-drl">{t("Eventos")}</span> })
 *
 * `slots` da a cada variable una marca invisible; `fill` parte el texto ya traducido por esas marcas.
 */
import { Fragment, type ReactNode } from "react";

const OPEN = "\u0001";
const CLOSE = "\u0002";
const MARK = /\u0001([A-Za-z_][A-Za-z0-9_]*)\u0002/;

/** Variables-marca para `t(...)`: una por trozo que se pintará con `fill`. */
export function slots<K extends string>(...names: K[]): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const n of names) out[n] = `${OPEN}${n}${CLOSE}`;
  return out;
}

/** Sustituye cada marca del texto (ya traducido) por su nodo. El resto del texto queda intacto. */
export function fill(text: string, nodes: Record<string, ReactNode>): ReactNode {
  const parts = text.split(MARK);
  return parts.map((part, i) => (i % 2 ? <Fragment key={i}>{nodes[part]}</Fragment> : part ? <Fragment key={i}>{part}</Fragment> : null));
}
