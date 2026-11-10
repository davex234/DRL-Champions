/**
 * COMMAND CENTER — tests del vestíbulo (Fase 4).
 *
 * Se prueban PROPIEDADES de la composición, no su aspecto. Las tres que sostienen la fase:
 *
 *   · el escenario se dibuja SIN datos de red (el fallo que la auditoría encontró);
 *   · el estado del jugador se lee del estado real y no de una suposición;
 *   · el vestíbulo consume el sistema de diseño en vez de inventarse superficies.
 */
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { LobbyHud } from "./LobbyHud";
import { LobbyShowcase } from "./LobbyShowcase";
import { LobbyModes } from "./LobbyModes";
import { LobbyCircuit } from "./LobbyCircuit";
import { TONE } from "@/components/ui/tone";
import { READOUT } from "@/design/tokens";

const html = (n: React.ReactElement): string => renderToStaticMarkup(n);
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

const NIVEL = { level: 14, xpIntoLevel: 342, xpForNext: 762, progress: 0.45 };
const COLECCION = { distinct: 12, total: 772, owned: 12 };

/* ─────────────────────── EL HUD ─────────────────────── */

test("HUD · funciona SIN sesión: nivel, colección y créditos son estado local", () => {
  const markup = html(
    <LobbyHud rank={null} level={NIVEL} collection={COLECCION} credits={18450} packs={3} />,
  );
  assert.match(markup, /Nivel/);
  assert.match(markup, /Colección/);
  assert.match(markup, /18\.450/, "los créditos van formateados por el dominio");
  assert.match(markup, /3 sobres sin abrir/);
});

test("HUD · el rango es lo único que exige cuenta", () => {
  const sin = html(<LobbyHud rank={null} level={NIVEL} collection={COLECCION} credits={0} packs={0} />);
  assert.ok(!/Rango/.test(sin), "sin sesión no se enseña un rango vacío");

  const con = html(
    <LobbyHud
      rank={{ tierId: "oro", color: "#ffd35c", label: "Oro II", division: 2, divisions: 3, position: 41, points: 820, champion: false }}
      level={NIVEL}
      collection={COLECCION}
      credits={0}
      packs={0}
    />,
  );
  assert.match(con, /Rango/);
  assert.match(con, /Oro II/);
});

test("HUD · las cifras usan la escala READOUT, no un tamaño a ojo", () => {
  const markup = html(<LobbyHud rank={null} level={NIVEL} collection={COLECCION} credits={100} packs={0} />);
  assert.ok(markup.includes(READOUT.md), "la cifra del vestíbulo es el paso `md` de la escala");
  assert.ok(!/text-\[\d+px\]/.test(markup), "sin tamaños arbitrarios");
});

test("HUD · cada celda cumple el objetivo táctil de 44 px", () => {
  const markup = html(<LobbyHud rank={null} level={NIVEL} collection={COLECCION} credits={0} packs={0} />);
  const celdas = markup.match(/min-h-\[44px\]/g) ?? [];
  assert.equal(celdas.length, 3, "las tres celdas del HUD son pulsables de verdad");
});

/* ─────────────────────── LA VITRINA ─────────────────────── */

test("VITRINA · sin cartas enseña el SITIO de las cartas, no un hueco negro", () => {
  const markup = html(<LobbyShowcase cards={[]} packs={4} />);
  assert.match(markup, /data-surface="recessed"/, "los huecos son la superficie hundida del sistema");
  assert.match(markup, /Tu vitrina/);
  assert.match(markup, /4 sobres esperando/, "la invitación usa la cifra real");
  assert.match(markup, /Abrir sobres/);
});

test("VITRINA · sin cartas y sin sobres manda a la tienda, que es la salida que hay", () => {
  const markup = html(<LobbyShowcase cards={[]} packs={0} />);
  assert.match(markup, /Ir a la tienda/);
  assert.ok(!/sobres esperando/.test(markup));
});

test("VITRINA · calla su botón cuando el CTA del escenario ya lleva al mismo sitio", () => {
  const markup = html(<LobbyShowcase cards={[]} packs={4} offerAction={false} />);
  assert.ok(!/Abrir sobres/.test(markup), "dos botones idénticos en el mismo plano son una duda");
  assert.match(markup, /Tu vitrina/, "pero la vitrina sigue explicando qué va ahí");
});

/* ─────────────────────── JERARQUÍA ─────────────────────── */

test("MODOS · las puertas y la barra de mando NO pesan lo mismo", () => {
  const markup = html(
    <LobbyModes
      modes={[{ id: "torneos", href: "/torneos", label: "Torneos", tag: "Competición", line: "x", tint: "255,138,61" }]}
      destinations={[{ href: "/tienda", label: "Tienda", tint: "255,211,92" }]}
    />,
  );
  // La puerta es una superficie con chaflán de placa; la barra, una sola placa dividida.
  assert.match(markup, /min-h-\[150px\]/, "la puerta tiene cuerpo");
  assert.match(markup, /data-surface="plate"/, "la barra de mando es UNA placa, no cuatro pastillas");
  assert.ok(!/rounded-full/.test(markup.replace(/rounded-full transition/g, "")), "sin píldoras salvo el punto de estado");
});

test("CIRCUITO · sin torneo dice qué pasa, y no desaparece", () => {
  const markup = html(<LobbyCircuit tournament={null} matches={[]} pickem={null} ranking={[]} reward={null} />);
  assert.equal(markup, "", "sin torneo NI clasificación NI recompensa, la banda entera se va");

  const conRanking = html(
    <LobbyCircuit
      tournament={null}
      matches={[]}
      pickem={null}
      ranking={[{ id: "a", username: "kai", avatar: "🦊", points: 120, isMe: true }]}
      reward={null}
    />,
  );
  assert.match(conRanking, /No hay torneos publicados|No hay ningún torneo|No hay torneos/);
  assert.match(conRanking, /kai/);
});

test("CIRCUITO · el tono de estado sale del vocabulario del sistema", () => {
  const markup = html(
    <LobbyCircuit
      tournament={{ id: "t1", name: "Masters", demo: false }}
      matches={[{ id: "m", teamA: "A", teamB: "B", live: true, when: "hoy" }]}
      pickem={{ open: 3, pending: 2 }}
      ranking={[]}
      reward={null}
    />,
  );
  assert.match(markup, /quedan 2 predicciones/, "el texto sale del dato, no de una plantilla fija");
  assert.ok(markup.includes(TONE.key), "«En vivo» usa el tono de marca del sistema");
});

/* ─────────────────────── ADOPCIÓN Y ANTI-GRAMÁTICA ─────────────────────── */

test("ADOPCIÓN · el vestíbulo se compone con primitivas del sistema", () => {
  /*
   * FASE 46 · CAMBIO DE CONTRATO, A PROPÓSITO.
   *
   * La Home ya NO monta `DailyLobby`: monta `MainMenu` (tres acciones sobre una escena). Lo que este
   * test protegía —que la página no se inventara su propio vocabulario— sigue vigente y se comprueba
   * igual, sólo que sobre la pieza nueva. Y `DailyLobby` no se ha borrado: sigue siendo la vista del
   * arnés de QA de la Fase 36, así que sus primitivas se siguen exigiendo más abajo.
   */
  const page = read("../../app/page.tsx");
  assert.match(page, /MainMenu/, "la Home monta el menú principal");
  assert.match(page, /DailyLobbySkeleton/, "y conserva el esqueleto mientras no hay foto");
  // La foto sigue viniendo del Daily Loop: la composición cambia, la lectura no.
  assert.match(page, /useDailyLoop/, "la Home sigue leyendo el Daily Loop");
  assert.match(page, /buildDailyLoop/, "y sigue degradando con el dominio puro");
  const daily = ["DailyLobby.tsx", "DailyHero.tsx", "DailyPanels.tsx"].map((f) => read(`../dailyLoop/${f}`)).join("\n");
  for (const prim of ["NxButton", "Meter", "Badge"]) assert.match(daily, new RegExp(`@/components/ui/${prim}`));
  assert.match(daily, /@\/components\/lobby\/LobbyShowcase/);
  const piezas = ["LobbyStage.tsx", "LobbyHud.tsx", "LobbyShowcase.tsx", "LobbyModes.tsx", "LobbyCircuit.tsx"]
    .map((f) => read(`./${f}`))
    .join("\n");
  assert.match(piezas, /@\/components\/ui\/Surface/);
  assert.match(piezas, /@\/components\/ui\/NxButton/);
  assert.match(piezas, /@\/components\/ui\/Readout/);
  assert.match(piezas, /@\/components\/ui\/Meter/);
  assert.match(piezas, /@\/components\/ui\/Badge/);
});

test("ANTI-GRAMÁTICA · el vestíbulo no reintroduce lo que la Fase 3 vino a quitar", () => {
  const piezas = ["LobbyStage.tsx", "LobbyHud.tsx", "LobbyShowcase.tsx", "LobbyModes.tsx", "LobbyCircuit.tsx",
    "../dailyLoop/DailyLobby.tsx", "../dailyLoop/DailyHero.tsx", "../dailyLoop/DailyPanels.tsx"]
    .map((f) => read(`./${f}`));
  const cuerpo = piezas.map((s) => s.split("*/").slice(1).join("*/")).join("\n");
  assert.ok(!/#[0-9a-fA-F]{6}\b/.test(cuerpo), "hexadecimal suelto: el color sale de los tokens");
  assert.ok(!/rounded-(xl|2xl|3xl|panel|card)\b/.test(cuerpo), "tarjeta redondeada genérica");
  assert.ok(!/z-\[\d+\]/.test(cuerpo), "z-index arbitrario: existe la escala LAYER");
});

test("SIN RED · el escenario no depende de ninguna lectura online para dibujarse", () => {
  /*
   * El fallo que abrió la Fase 4: todo el vestíbulo colgaba de un `loading` que solo se
   * apagaba al responder `fetchTournaments`, así que con el servidor caído un jugador con
   * doce cartas veía un spinner indefinido. Este test fija que ya no hay puerta.
   */
  const page = read("../../app/page.tsx");
  assert.ok(!/if \(loading\)/.test(page), "no queda una puerta de carga global");
  assert.ok(!/<Loading\b/.test(page), "el vestíbulo ya no se sustituye por un spinner");
  assert.ok(!/<ErrorState\b/.test(page), "ni por una pantalla de error");
  // Fase 36: sin respuesta, la home degrada a un vestíbulo honesto (`unknownFacts`) o conserva la última foto.
  assert.match(page, /buildDailyLoop\(unknownFacts\(!!user\)\)/, "sin foto se dibuja un vestíbulo degradado, no un hueco");
  assert.match(page, /network=\{network\}/, "el fallo de red se dice en el propio vestíbulo");
  // Y el menú principal TIENE que enseñarlo: una Home bonita que se calla que está sin datos miente.
  const menu = read("../home/MainMenu.tsx");
  assert.match(menu, /network/, "el menú principal recibe el estado de red");
  assert.match(menu, /data-testid="home-offline"/, "y lo dice en pantalla");
});
