/**
 * IDENTIDAD DE VARIANTE — tests del sistema.
 *
 * Se comprueban PROPIEDADES, no capturas. La más importante es la de §12 del encargo: que la
 * identidad no dependa del color. Eso no se demuestra mirando una carta, se demuestra
 * enumerando los pares de variantes que comparten paleta y verificando que TODOS se distinguen
 * por otra cosa. Si mañana alguien añade una variante reutilizando un color, este test lo caza.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { variantIdentity, sealedVariants, type VariantFamily } from "./variantIdentity";
import { VariantSeal } from "@/components/cards/layers/VariantSeal";
import { CardRenderer } from "@/components/cards/CardRenderer";
import { CardThumb } from "@/components/cards/CardThumb";
import { VARIANTS, getVariant } from "@/domain/cards/variants";
import { allPlayers } from "@/data/catalog";
import { computeOvr } from "@/domain/cards/ovr";
import type { VariantId } from "@/domain/cards/types";

/** Las ocho que el pipeline puede conceder hoy con datos reales. */
const REALES: VariantId[] = [
  "mythic", "champion-edition", "clutch",
  "top-rating", "top-acs", "top-kills", "top-assist", "top-hs",
] as VariantId[];

const TOP: VariantId[] = ["top-rating", "top-acs", "top-kills", "top-assist", "top-hs"] as VariantId[];
const TODAS = Object.keys(VARIANTS) as VariantId[];
const player = allPlayers()[0]!;

const pinta = (id: VariantId, size: "sm" | "lg" = "sm"): string =>
  renderToStaticMarkup(
    <CardRenderer
      player={player}
      variant={getVariant(id)}
      stats={player.stats}
      ovr={computeOvr(player.stats)}
      serial={7}
      size={size}
      interactive={false}
    />,
  );

/* ─────────────────────── COBERTURA ─────────────────────── */

test("las 8 variantes reales tienen identidad con sello", () => {
  for (const id of REALES) {
    const i = variantIdentity(id);
    assert.ok(i.seal, `${id} sin sello`);
    assert.ok(i.sealLabel && i.sealLabel.length > 0, `${id} sin nombre accesible`);
    assert.equal(i.tournament, true, `${id} debería marcarse como carta de torneo`);
  }
});

test("NINGUNA variante se queda sin identidad: el respaldo es total", () => {
  for (const id of TODAS) {
    const i = variantIdentity(id);
    assert.ok(i.family, `${id} sin familia`);
    assert.ok(typeof i.tournament === "boolean", `${id} sin marca de torneo`);
  }
  // Y también una que no existe: la función nunca puede reventar.
  const inventada = variantIdentity("no-existe" as VariantId);
  assert.equal(inventada.family, "base");
  assert.equal(inventada.seal, null);
});

test("las cartas base NO llevan sello ni marca de torneo", () => {
  for (const id of ["bronze", "silver", "gold", "emea", "americas"] as VariantId[]) {
    const i = variantIdentity(id);
    assert.equal(i.seal, null, `${id} no debería llevar sello`);
    assert.equal(i.tournament, false, `${id} no es carta de torneo`);
  }
});

test("ROOKIE sigue bloqueada: no recibe identidad de variante jugable", () => {
  /*
   * Existe en el dominio (rank 10, /200) pero el pipeline no puede concederla: no hay fuente
   * de `status`. Darle sello sería anunciar una carta que nadie puede tener.
   */
  const i = variantIdentity("rookie" as VariantId);
  assert.equal(i.seal, null);
  assert.equal(i.blocked, true, "debe quedar marcada, para que desbloquearla sea deliberado");
  assert.ok(!sealedVariants().includes("rookie" as VariantId));
});

/* ─────────────────────── DISTINCIÓN ─────────────────────── */

test("EL COLOR NO ES LA SEÑAL · las 8 reales se distinguen sin mirar el color", () => {
  /*
   * La propiedad central del sistema, y la de §12 del encargo. Medido en la auditoría:
   * `#ff2e63` lo comparten mythic, clutch y top-kills, y el dorado lo comparten top-rating y
   * champions-mvp. Si la identidad dependiera del color, cuatro de las ocho serían
   * indistinguibles. Aquí se comprueba que las ocho son distinguibles DOS A DOS usando solo
   * la forma y el código.
   */
  const firma = (id: VariantId): string => {
    const i = variantIdentity(id);
    return `${i.seal}|${i.code ?? "-"}`;
  };
  const vistas = new Map<string, VariantId>();
  for (const id of REALES) {
    const f = firma(id);
    const previa = vistas.get(f);
    assert.equal(previa, undefined, `${id} y ${previa} comparten firma visual (${f})`);
    vistas.set(f, id);
  }
  assert.equal(vistas.size, REALES.length);
});

test("dos reconocimientos DISTINTOS nunca comparten color y sello a la vez", () => {
  /*
   * Compartir sello dentro de una familia es correcto y deliberado: los siete «winner» son
   * todos campeones, y `emea-mvp` y `mythic` son los dos MVP. Reconocen lo mismo a distinta
   * escala, y los separan el material (la escalera de rareza) y su nombre.
   *
   * Lo que NO puede pasar es que dos reconocimientos DISTINTOS —un campeón y un MVP, pongamos—
   * caigan en el mismo color con el mismo sello. Eso sí sería indistinguible.
   */
  const porColor = new Map<string, VariantId[]>();
  for (const id of TODAS) {
    const c = getVariant(id).palette.primary.toLowerCase();
    porColor.set(c, [...(porColor.get(c) ?? []), id]);
  }

  let pares = 0;
  for (const [color, ids] of porColor) {
    const conSello = ids.filter((id) => variantIdentity(id).seal);
    for (let a = 0; a < conSello.length; a++) {
      for (let b = a + 1; b < conSello.length; b++) {
        const ia = variantIdentity(conSello[a]);
        const ib = variantIdentity(conSello[b]);
        const mismaFirma = ia.seal === ib.seal && ia.code === ib.code;
        if (mismaFirma) {
          assert.equal(
            ia.family, ib.family,
            `${conSello[a]} y ${conSello[b]} comparten color ${color} y sello, pero reconocen cosas distintas`,
          );
        }
        pares++;
      }
    }
  }
  assert.ok(pares > 0, "el test debe estar comprobando pares de verdad");
});

test("CHAMPION EDITION tiene identidad propia y no se confunde con MVP", () => {
  const champion = variantIdentity("champion-edition" as VariantId);
  const mvp = variantIdentity("mythic" as VariantId);
  assert.equal(champion.family, "champion");
  assert.equal(champion.seal, "champion");
  assert.equal(mvp.family, "mvp");
  assert.equal(mvp.seal, "mvp");
  assert.notEqual(champion.seal, mvp.seal, "campeón del evento y jugador destacado son cosas distintas");
});

test("CLUTCH KING tiene sello propio, distinto de todas las demás familias", () => {
  const clutch = variantIdentity("clutch" as VariantId);
  assert.equal(clutch.seal, "clutch");
  const otras: VariantFamily[] = ["mvp", "champion", "top"];
  for (const f of otras) {
    const ejemplo = TODAS.find((id) => variantIdentity(id).family === f)!;
    assert.notEqual(variantIdentity(ejemplo).seal, clutch.seal, `clutch no puede compartir sello con ${f}`);
  }
});

test("las cinco TOP son una FAMILIA: mismo sello, código distinto", () => {
  const codigos = new Set<string>();
  for (const id of TOP) {
    const i = variantIdentity(id);
    assert.equal(i.family, "top", `${id} debería ser familia TOP`);
    assert.equal(i.seal, "top", `${id} debería llevar el galón`);
    assert.ok(i.code, `${id} sin código`);
    assert.ok(i.code!.length <= 3, `el código de ${id} no cabe a tamaño de rejilla`);
    codigos.add(i.code!);
  }
  assert.equal(codigos.size, TOP.length, "cada TOP necesita su propio código");
});

test("solo la familia TOP usa código: en las demás el sello ya es único", () => {
  for (const id of TODAS) {
    const i = variantIdentity(id);
    if (i.code) assert.equal(i.family, "top", `${id} no debería necesitar código`);
  }
});

/* ─────────────────────── SUPERVIVENCIA ─────────────────────── */

test("la identidad sobrevive SIN animación: el sello es HTML estático", () => {
  // Se renderiza en servidor, sin JS ni motor de animación, y el sello sigue estando.
  for (const id of REALES) {
    const html = pinta(id);
    assert.match(html, /<svg/, `${id} sin sello en el marcado estático`);
  }
});

test("la identidad sobrevive en la representación compacta (44 px)", () => {
  for (const id of REALES) {
    const def = { id: `x__${id}`, playerId: player.id, variantId: id, ovr: 90, stats: player.stats } as never;
    const html = renderToStaticMarkup(<CardThumb card={def} />);
    assert.match(html, /<svg/, `${id} pierde su identidad en miniatura`);
  }
});

test("en miniatura las TOP conservan su código, que es lo único que las separa", () => {
  for (const id of TOP) {
    const def = { id: `x__${id}`, playerId: player.id, variantId: id, ovr: 90, stats: player.stats } as never;
    const html = renderToStaticMarkup(<CardThumb card={def} />);
    assert.ok(html.includes(variantIdentity(id).code!), `${id} sin código en miniatura`);
  }
});

test("el sello es accesible cuando no hay texto que lo acompañe", () => {
  const solo = renderToStaticMarkup(<VariantSeal shape="champion" label="Campeón del torneo" />);
  assert.match(solo, /role="img"/);
  assert.match(solo, /aria-label="Campeón del torneo"/);

  // Y decorativo cuando el nombre va al lado: no se lee dos veces lo mismo.
  const acompanado = renderToStaticMarkup(<VariantSeal shape="champion" label="Campeón" decorative />);
  assert.match(acompanado, /aria-hidden/);
  assert.ok(!/aria-label/.test(acompanado));
});

test("la marca de torneo distingue especial de base sin usar color", () => {
  const especial = pinta("clutch" as VariantId);
  const base = pinta("gold" as VariantId);
  assert.match(especial, /repeating-linear-gradient/, "el canto de una carta de torneo va trabajado");
  assert.ok(!/repeating-linear-gradient/.test(base), "el de una carta base, no");
});

/* ─────────────────────── NO ROMPER LO ANTERIOR ─────────────────────── */

test("REGRESIÓN · la identidad no toca ni un dato del dominio", () => {
  assert.equal(TODAS.length, 44); // 37 + 7 ediciones diseñadas (catálogo 2026-09-21)
  assert.equal(getVariant("clutch" as VariantId).serialLimit, 120);
  assert.equal(getVariant("champion-edition" as VariantId).rank, 13);
  assert.equal(getVariant("mythic" as VariantId).serialLimit, 25);
});

test("REGRESIÓN · el serial sigue conviviendo con el sello", () => {
  // Los dos viven en la esquina de procedencia; ninguno desplaza al otro.
  const html = pinta("clutch" as VariantId);
  assert.match(html, /<svg/, "sello");
  assert.ok(html.includes("120"), "y el límite de la serie sigue impreso");
});
