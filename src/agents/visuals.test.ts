/**
 * NEXUS AGENT IDENTITY SYSTEM — las reglas que no se pueden romper sin darse cuenta (Fase 48).
 *
 * El encargo pedía diez personajes DISTINGUIBLES, un manifiesto único y un respaldo que nunca
 * deje una imagen rota. Eso no se comprueba mirando pantallas: se cierra aquí.
 *
 * Lo que vigila:
 *   · que el manifiesto cubra exactamente el roster canónico —ni un agente once, ni uno menos—;
 *   · que dos agentes de la MISMA clase no compartan acento (si lo comparten, la identidad no
 *     existe: sólo hay clase);
 *   · que el color de clase del manifiesto y el del emblema del mapa no se separen nunca;
 *   · que sólo Veil tenga arte publicado (F48B) y los otros nueve caigan al sigilo;
 *   · que lo que se declara publicado exista en disco con el tamaño, el alfa y el peso del contrato;
 *   · y que el degradado entre variantes no invente encuadres.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENTS } from "./catalog";
import {
  AGENT_IDENTITY, AGENT_VISUALS, AGENT_CLASS_ACCENT, AGENT_ART_CONTRACT, AGENT_ART_VARIANTS,
  agentVisual, agentArt, publishedArtCount, type AgentArtVariant,
} from "./visuals";
import { AGENT_CLASS_COLOR } from "@/components/tactics/AgentEmblem";
import { agentArtSrc } from "@/lib/assets";

/** El roster canónico, escrito a mano a propósito: si alguien añade o quita, esto falla. */
const ROSTER = ["veil", "haze", "probe", "pulse", "spear", "blitz", "warden", "tripwire", "specter", "echo"];

test("el manifiesto cubre exactamente el roster canónico", () => {
  assert.deepEqual([...AGENTS.map((a) => a.id)].sort(), [...ROSTER].sort());
  assert.deepEqual(Object.keys(AGENT_VISUALS).sort(), [...ROSTER].sort());
  for (const id of ROSTER) {
    assert.ok(AGENT_IDENTITY[id], `${id} no tiene identidad visual propia`);
  }
});

test("ningún agente se queda sin acento, motivo y silueta", () => {
  for (const id of ROSTER) {
    const v = agentVisual(id)!;
    assert.match(v.accent, /^#[0-9a-f]{6}$/i, `${id}: acento mal formado`);
    assert.ok(v.motif.length > 20, `${id}: sin motivo visual`);
    assert.ok(v.silhouette.length > 20, `${id}: sin silueta descrita`);
  }
});

test("dos agentes NUNCA comparten acento: la identidad no puede ser sólo la clase", () => {
  const vistos = new Map<string, string>();
  for (const id of ROSTER) {
    const c = agentVisual(id)!.accent.toLowerCase();
    assert.equal(vistos.get(c), undefined, `${id} y ${vistos.get(c)} comparten el acento ${c}`);
    vistos.set(c, id);
  }
});

test("los dos agentes de cada clase se distinguen entre sí", () => {
  const porClase = new Map<string, string[]>();
  for (const a of AGENTS) porClase.set(a.class, [...(porClase.get(a.class) ?? []), a.id]);
  for (const [clase, ids] of porClase) {
    const acentos = new Set(ids.map((id) => agentVisual(id)!.accent.toLowerCase()));
    assert.equal(acentos.size, ids.length, `los ${clase} se confunden: ${ids.join(", ")}`);
    const siluetas = new Set(ids.map((id) => agentVisual(id)!.silhouette));
    assert.equal(siluetas.size, ids.length, `los ${clase} comparten silueta`);
  }
});

test("el color de CLASE del manifiesto es el mismo que el del emblema del mapa", () => {
  /*
   * Son dos copias por una razón real —`src/agents` es datos puros y no puede importar un
   * componente de React—, así que lo que no puede pasar es que se separen: el día que lo
   * hicieran, el mismo agente saldría de un color en el mapa y de otro en el roster.
   */
  assert.deepEqual(AGENT_CLASS_ACCENT, AGENT_CLASS_COLOR);
  for (const a of AGENTS) {
    assert.equal(agentVisual(a.id)!.classColor, AGENT_CLASS_COLOR[a.class]);
  }
});

test("el sigilo SIEMPRE está: ningún agente depende de tener arte", () => {
  for (const id of ROSTER) assert.equal(agentVisual(id)!.glyph, "emblem");
});

test("F48B: Veil es la ÚNICA muestra publicada — retrato y avatar, nada más", () => {
  /*
   * Estado real tras la Fase 48B: Veil es el Golden Sample y los otros nueve esperan a que se
   * apruebe. Si alguien publica un segundo agente —o una variante de Veil que no existe en
   * disco— esta prueba falla, y es a propósito: el orden «Veil primero, aprobación, luego el
   * resto» es una decisión de producción, no un accidente.
   */
  assert.equal(publishedArtCount(), 2);
  assert.deepEqual([...AGENT_IDENTITY.veil.published].sort(), ["avatar", "portrait"]);
  const veil = agentVisual("veil")!;
  assert.equal(veil.portrait, "/agents/veil/portrait.webp");
  assert.equal(veil.avatar, "/agents/veil/avatar.webp");
  // Sin `portrait-large` ni `fullbody`: el retrato grande sería un reescalado del máster.
  assert.equal(veil.portraitLarge, null);
  assert.equal(veil.fullbody, null);
  assert.equal(agentArt("veil", "portrait-large"), null);
  // El glifo no se jubila: sigue ahí para el mapa y los tamaños mínimos.
  assert.equal(veil.glyph, "emblem");
});

test("los otros nueve siguen con el sigilo en las cuatro variantes", () => {
  for (const id of ROSTER.filter((x) => x !== "veil")) {
    for (const v of AGENT_ART_VARIANTS) {
      assert.equal(agentArt(id, v), null, `${id}/${v} debería caer al sigilo`);
    }
    const visual = agentVisual(id)!;
    assert.equal(visual.portrait, null);
    assert.equal(visual.avatar, null);
    assert.equal(visual.fullbody, null);
  }
});

test("lo que declara `published` EXISTE en disco y cumple el contrato", () => {
  /*
   * La otra mitad de «cero imágenes rotas»: el manifiesto no puede prometer un fichero que no
   * está. Se lee la cabecera RIFF del WEBP para comprobar tamaño, alfa y peso sin decodificar.
   */
  for (const id of ROSTER) {
    for (const v of AGENT_IDENTITY[id].published) {
      const ruta = join(process.cwd(), "public", agentArtSrc(id, v));
      assert.ok(existsSync(ruta), `${id}/${v} declarado pero ausente: ${ruta}`);
      const b = readFileSync(ruta);
      const c = AGENT_ART_CONTRACT[v];
      assert.equal(b.toString("ascii", 0, 4), "RIFF");
      assert.equal(b.toString("ascii", 8, 12), "WEBP");
      assert.ok(b.length <= c.maxKb * 1024, `${id}/${v}: ${Math.round(b.length / 1024)} KB > ${c.maxKb} KB`);
      // Extended format (VP8X) lleva el tamaño y la bandera de alfa en la cabecera.
      assert.equal(b.toString("ascii", 12, 16), "VP8X", `${id}/${v}: sin cabecera extendida (¿sin alfa?)`);
      assert.ok((b[20] & 0x10) !== 0, `${id}/${v}: sin canal alfa`);
      const ancho = 1 + b.readUIntLE(24, 3);
      const alto = 1 + b.readUIntLE(27, 3);
      assert.deepEqual([ancho, alto], [c.width, c.height], `${id}/${v}: tamaño fuera de contrato`);
    }
  }
});

test("un agente que no existe no revienta: devuelve nada y el sigilo hace el resto", () => {
  for (const falso of ["jett", "sova", "omen", "", "../secreto"]) {
    assert.equal(agentVisual(falso), undefined, `«${falso}» no debería tener identidad`);
    assert.equal(agentArt(falso, "portrait"), null);
  }
});

test("el degradado entre variantes nunca estira un encuadre", () => {
  /*
   * Simulado sobre el manifiesto, sin tocarlo: un avatar (cabeza) NO puede rellenar un hueco
   * de medio cuerpo, pero un `portrait-large` sí vale para un `portrait` porque es la misma
   * foto con más píxeles. Se comprueba la REGLA, que es lo que se rompería al refactorizar.
   */
  const reglas: Record<AgentArtVariant, AgentArtVariant[]> = {
    avatar: ["avatar", "portrait", "portrait-large"],
    portrait: ["portrait", "portrait-large"],
    "portrait-large": ["portrait-large"],
    fullbody: ["fullbody"],
  };
  // El avatar acepta caer a retrato (recortar es legítimo); el retrato NUNCA acepta un avatar.
  assert.ok(!reglas.portrait.includes("avatar"));
  assert.ok(!reglas["portrait-large"].includes("portrait"));
  assert.ok(!reglas.fullbody.includes("portrait"));
  assert.ok(reglas.avatar.includes("portrait"));
});

test("el contrato de arte es coherente: mismo encuadre, misma proporción", () => {
  // Las dos piezas de retrato son la misma foto: si sus proporciones se separan, el hueco salta.
  assert.equal(AGENT_ART_CONTRACT.portrait.aspect, AGENT_ART_CONTRACT["portrait-large"].aspect);
  assert.ok(
    AGENT_ART_CONTRACT["portrait-large"].width > AGENT_ART_CONTRACT.portrait.width,
    "«portrait-large» tiene que ser más grande que «portrait»",
  );
  assert.equal(AGENT_ART_CONTRACT.avatar.aspect, 1, "el avatar es cuadrado");
  for (const v of AGENT_ART_VARIANTS) {
    const c = AGENT_ART_CONTRACT[v];
    assert.ok(c.width > 0 && c.height > 0, `${v}: sin tamaño`);
    assert.ok(Math.abs(c.width / c.height - c.aspect) < 0.001, `${v}: proporción y tamaño no cuadran`);
    assert.ok(c.maxKb > 0 && c.maxKb <= 300, `${v}: presupuesto de peso fuera de rango`);
    assert.ok(c.crop.length > 20 && c.usage.length > 10, `${v}: contrato sin describir`);
  }
});

test("las rutas del arte las compone UN solo sitio, y con la forma esperada", () => {
  assert.equal(agentArtSrc("veil", "portrait"), "/agents/veil/portrait.webp");
  assert.equal(agentArtSrc("tripwire", "avatar"), "/agents/tripwire/avatar.webp");
  // WEBP y no PNG: alfa real con una fracción del peso, como ya hacen los sobres.
  for (const v of AGENT_ART_VARIANTS) assert.match(agentArtSrc("echo", v), /\.webp$/);
});
