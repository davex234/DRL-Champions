/**
 * CONSTRUCTOR DEL DOCUMENTO DE PRODUCTO — NEXUS VALORANT CARDS · DUEL GAMEPLAY.
 *
 *   node scripts/duel-doc-build.mjs        → docs/product/duel-gameplay.html
 *
 * Lee `docs/product/duel-showcase.json` (datos REALES exportados del motor con
 * `scripts/duel-deck-export.ts`) y emite un deck de diapositivas 16:9 listo para imprimir a PDF.
 *
 * No toca la aplicación: solo lee datos y escribe un HTML dentro de `docs/product/`.
 * La estética replica la del juego (paleta, tipografías y anatomía de carta reales).
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs", "product");
const D = JSON.parse(readFileSync(join(OUT_DIR, "duel-showcase.json"), "utf8"));

// ───────────────────────────── utilidades ─────────────────────────────

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ROLE_ABBR = { Duelista: "DUE", Iniciador: "INI", Centinela: "CEN", Controlador: "CON", Flex: "FLX" };
const STAT = {
  stronghold: { label: "SH", full: "Stronghold", color: "#e8595b" },
  gamesense:  { label: "GS", full: "Gamesense",  color: "#4f9ede" },
  entryfrag:  { label: "EF", full: "Entryfrag",  color: "#4fbe78" },
};
const COUNTER = { stronghold: "entryfrag", gamesense: "gamesense", entryfrag: "stronghold" };

const mine = D.deckMine.cards;
const rival = D.deckRival.cards;
const byNick = Object.fromEntries([...mine, ...rival].map((c) => [c.nick, c]));


// ───────────────────────────── tipografías incrustadas ─────────────────────────────

/**
 * Incrusta las tipografías como datos dentro del propio HTML.
 *
 * No es una optimización: la API moderna de Google Fonts sirve Inter como fuente VARIABLE y Chrome
 * NO la incrusta al exportar a PDF —el texto caía a Segoe UI—. Con instancias estáticas incrustadas,
 * el PDF lleva sus dos tipografías dentro y se ve igual en cualquier ordenador. Se descargan una
 * vez con `node scripts/duel-doc-fonts.mjs`.
 */
function embeddedFonts() {
  const dir = join(OUT_DIR, "fonts");
  if (!existsSync(dir)) {
    throw new Error("Faltan las tipografías. Ejecuta primero: node scripts/duel-doc-fonts.mjs");
  }
  const faces = readdirSync(dir).filter((f) => f.endsWith(".woff2")).sort().map((file) => {
    const [family, weight] = file.replace(".woff2", "").split("-");
    const data = readFileSync(join(dir, file)).toString("base64");
    return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;` +
           `src:url(data:font/woff2;base64,${data}) format('woff2');}`;
  });
  if (faces.length === 0) throw new Error("El directorio de tipografías está vacío.");
  return faces.join("\n");
}

// ───────────────────────────── componentes ─────────────────────────────

/** Carta en VISTA DE DUELO: misma anatomía que el renderizador del juego, con el trío de combate. */
function card(c, size = "md", opts = {}) {
  // `opts.w` permite ajustar el ancho exacto dentro de contenedores estrechos (marcos de móvil)
  // sin inventar un tamaño nuevo en la escala.
  const W = opts.w ?? { xxs: 52, xs: 68, sm: 92, md: 124, lg: 168, xl: 214 }[size];
  const p = c.palette;
  const showStats = size !== "xxs" && size !== "xs" && opts.stats !== false;
  const initials = c.nick.slice(0, 2).toUpperCase();
  const ovrSize = { xxs: 13, xs: 17, sm: 22, md: 29, lg: 39, xl: 50 }[size];
  const nameSize = { xxs: 7, xs: 9, sm: 11, md: 14, lg: 19, xl: 24 }[size];
  const cls = ["dcard", opts.dim ? "dim" : "", opts.spent ? "spent" : "", opts.sel ? "sel" : "", opts.glow ? "glow" : ""].filter(Boolean).join(" ");
  const badge = opts.badge ? `<span class="dcard-badge">${esc(opts.badge)}</span>` : "";
  const veil = opts.spent ? `<span class="dcard-veil">USADA</span>` : "";
  return `<div class="${cls}" style="--cw:${W}px;--cp:${p.primary};--cbg:${p.background};--ctx:${p.text}">
  <div class="dcard-in">
    <div class="dcard-art">
      <svg viewBox="0 0 100 120" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
        <defs><linearGradient id="g-${c.uid}-${size}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${p.secondary}" stop-opacity=".55"/>
          <stop offset="100%" stop-color="${p.primary}" stop-opacity=".15"/>
        </linearGradient></defs>
        <circle cx="50" cy="38" r="22" fill="url(#g-${c.uid}-${size})"/>
        <path d="M12 120 C12 86 30 70 50 70 C70 70 88 86 88 120 Z" fill="url(#g-${c.uid}-${size})"/>
      </svg>
      <span class="dcard-ini" style="color:${p.text};font-size:${W * 0.2}px">${initials}</span>
    </div>
    <div class="dcard-fade"></div>
    <div class="dcard-tl">
      <span class="dcard-ovr" style="font-size:${ovrSize}px">${c.ovr}</span>
      ${size === "xxs" ? "" : `<span class="dcard-role">${ROLE_ABBR[c.role] ?? c.role}</span>`}
      ${size === "xxs" || size === "xs" ? "" : `<span class="dcard-flag">${esc(c.country)}</span>`}
      ${size === "md" || size === "lg" || size === "xl" ? `<span class="dcard-team" style="background:${c.teamColor === "#333" ? "#2a2f3d" : c.teamColor}">${esc(c.teamTag)}</span>` : ""}
    </div>
    ${badge}${veil}
    <div class="dcard-bl">
      <div class="dcard-rule"></div>
      <p class="dcard-name" style="font-size:${nameSize}px">${esc(c.nick)}</p>
      ${size === "xxs" ? "" : `<p class="dcard-var">${esc(c.variantLabel)}</p>`}
      ${showStats ? `<div class="dcard-stats">${["stronghold", "gamesense", "entryfrag"].map((k) =>
        `<div class="dcard-stat"><i style="color:${STAT[k].color}">${STAT[k].label}</i><b>${c.combat[k]}</b></div>`).join("")}</div>` : ""}
    </div>
  </div>
</div>`;
}

/** Marco de teléfono con la barra superior y la navegación inferior reales de la app. */
function phone(body, { active = "Duelos", w = 286, h = 516, label = "" } = {}) {
  const nav = [
    ["Inicio", "▦"], ["Duelos", "⚔"], ["Colección", "▤"], ["Sobres", "◈"], ["Perfil", "◉"],
  ];
  return `<div class="phone" style="--pw:${w}px;--ph:${h}px">
  <div class="phone-screen">
    <div class="phone-status"><span>9:41</span><span class="ps-r">▮▮▮ ▲ ▰</span></div>
    <div class="phone-top">
      <span class="brand"><i class="brand-mark"></i>NEXUS</span>
      <span class="orbs">◆ 12.480</span>
    </div>
    <div class="phone-body">${body}</div>
    <div class="phone-nav">${nav.map(([n, i]) =>
      `<span class="${n === active ? "on" : ""}"><i>${i}</i>${n}</span>`).join("")}</div>
  </div>
</div>${label ? `<p class="phone-label">${esc(label)}</p>` : ""}`;
}

/** Diapositiva 16:9. `kicker` es la sección, `n` el número de página. */
let PAGE = 0;
const slides = [];
function slide(html, { cls = "" } = {}) {
  PAGE++;
  slides.push(`<section class="slide ${cls}" data-n="${PAGE}">${html}</section>`);
}
function head(kicker, title, sub = "") {
  return `<header class="s-head">
    <span class="kicker">${esc(kicker)}</span>
    <h2>${title}</h2>
    ${sub ? `<p class="s-sub">${sub}</p>` : ""}
  </header>`;
}
const foot = (n) => `<footer class="s-foot"><span>NEXUS VALORANT CARDS · DUEL GAMEPLAY</span><span class="pg">${n}</span></footer>`;

/** Etiqueta de estado para lo que aún no está decidido. */
const tbd = (t) => `<span class="tbd">${esc(t)}</span>`;

// ───────────────────────────── datos derivados ─────────────────────────────

const M = D.match;                    // victoria 5-4
const MD = D.matchDefeat;             // derrota 4-6
const MW = D.matchDraw;               // empate
const tieTurn = M.turns.find((t) => t.outcome === "TIE");
const revealTurn = M.turns.find((t) => t.number === 9);
const t8 = M.turns.find((t) => t.number === 8);

const statChip = (k, v) => `<span class="chip" style="--c:${STAT[k].color}">${STAT[k].label} <b>${v}</b></span>`;

// ═══════════════════════════════ DIAPOSITIVAS ═══════════════════════════════

// ── 1 · Portada ───────────────────────────────────────────────────────────
slide(`
<div class="cover">
  <div class="cover-glow"></div>
  <div class="cover-cards">
    ${card(byNick["Alfajer"], "lg", { stats: false })}
    ${card(byNick["Kachoww"], "xl")}
    ${card(byNick["aspas"], "lg", { stats: false })}
  </div>
  <div class="cover-txt">
    <span class="cover-mark"><i class="brand-mark big"></i>NEXUS</span>
    <h1>VALORANT<br><em>CARDS</em></h1>
    <p class="cover-sub">DUEL GAMEPLAY</p>
    <p class="cover-tag">&ldquo;From collection to competitive play.&rdquo;</p>
    <div class="cover-meta"><span>PRODUCT PREVIEW</span><span class="dot"></span><span>2026</span></div>
  </div>
</div>`, { cls: "is-cover" });

// ── 2 · Índice ────────────────────────────────────────────────────────────
slide(`${head("Índice", "Qué vas a ver en este documento")}
<div class="idx-grid">
  ${[
    ["01", "El juego", "Qué es y qué lo hace distinto de un juego de OVR"],
    ["02", "La carta", "Anatomía, rareza y las tres estadísticas de combate"],
    ["03", "El mazo", "Diez cartas, cinco roles, mazo válido y mazo inválido"],
    ["04", "El duelo", "Turno a turno: carta, estadística, respuesta y revelación"],
    ["05", "Las reglas", "Cómo se gana, cómo se empata, cómo se desempata"],
    ["06", "El oponente", "Tres dificultades y una regla: nadie hace trampas"],
    ["07", "El resultado", "Victoria, derrota, empate y repetición de la partida"],
    ["08", "El plan", "Qué está construido y qué construimos ahora"],
  ].map(([n, t, s]) => `<div class="idx-item"><span class="idx-n">${n}</span><div><h3>${t}</h3><p>${s}</p></div></div>`).join("")}
</div>
${foot(PAGE + 1)}`);

// ── 3 · El concepto ───────────────────────────────────────────────────────
slide(`${head("01 · El juego", "No gana quien tiene la carta más cara")}
<div class="two">
  <div class="col-txt">
    <p class="lead">Un duelo son <b>diez enfrentamientos</b>. En cada uno eliges una carta y
    <b>declaras con qué estadística peleas</b>. Esa carta ya no vuelve.</p>
    <p>La carta más valorada puede perder si la enfrentas por su lado débil. Y una carta modesta
    puede ganarte un turno si la juegas en el momento correcto.</p>
    <div class="pillars">
      ${[
        ["Construye", "Diez cartas, cinco roles. Tu colección decide con qué puedes jugar."],
        ["Lee", "Cada estadística obliga al rival a responder con una concreta."],
        ["Decide", "Gastar tu mejor carta pronto o guardarla para el final."],
      ].map(([t, s]) => `<div class="pillar"><h4>${t}</h4><p>${s}</p></div>`).join("")}
    </div>
  </div>
  <div class="col-art">
    <div class="quote-card">
      <p>&ldquo;Las cartas no ganan simplemente por tener más OVR. El jugador tiene que construir
      un mazo, leer los enfrentamientos, elegir la carta correcta y tomar decisiones sobre las
      estadísticas.&rdquo;</p>
      <span>El concepto, en una frase</span>
    </div>
    <div class="mini-duel">
      ${card(byNick["Alfajer"], "sm")}
      <span class="vs-mini">VS</span>
      ${card(byNick["Raxcal"], "sm")}
    </div>
    <p class="cap">OVR 84 contra OVR 82. Lo que decide el turno es
      <b style="color:${STAT.stronghold.color}">Stronghold&nbsp;70</b> contra
      <b style="color:${STAT.entryfrag.color}">Entryfrag&nbsp;52</b>. Gana la carta de menos OVR… porque atacó por el lado correcto.</p>
  </div>
</div>
${foot(PAGE + 1)}`);

// ── 4 · From collection to duel ───────────────────────────────────────────
slide(`${head("01 · El juego", "From collection to duel")}
<div class="journey">
  ${[
    ["Colección", "◫", "Las cartas que ya tienes"],
    ["Constructor", "✎", "Eliges 10 y cumples los roles"],
    ["Mazo", "▦", "Validado y listo"],
    ["Oponente", "⚔", "Eliges dificultad"],
    ["Duelo", "◈", "10 turnos"],
    ["Resultado", "★", "Victoria, derrota o empate"],
    ["Replay", "▶", "Revive la partida"],
  ].map(([t, i, s], k) => `<div class="jstep${k === 4 ? " hero" : ""}">
      <span class="jicon">${i}</span><h4>${t}</h4><p>${s}</p>
    </div>${k < 6 ? '<span class="jarrow">›</span>' : ""}`).join("")}
</div>
<p class="journey-note">Todo el recorrido ocurre dentro de la app, sin salir de tu colección.
El duelo es el sitio donde tus cartas por fin <b>sirven para algo</b>.</p>
${foot(PAGE + 1)}`);

// ── 5 · Anatomía de la carta ──────────────────────────────────────────────
{
  const c = byNick["Kachoww"];
  slide(`${head("02 · La carta", "Anatomía de una carta")}
<div class="anatomy">
  <div class="anat-card">${card(c, "xl")}
    <p class="cap center">Vista de duelo de una carta real del catálogo</p>
  </div>
  <div class="anat-notes">
    ${[
      ["OVR", `<b>${c.ovr}</b> · valoración global de la carta. Ordena tu colección, y solo interviene en el desempate final de la partida.`],
      ["Rol", `<b>${c.role}</b> · define la composición legal del mazo. No interviene en el combate.`],
      ["Variante", `<b>${c.variantLabel}</b> · rareza y edición. Las variantes altas suben las estadísticas y algunas llevan número de serie.`],
      ["Equipo y país", `<b>${c.teamTag} · ${c.country}</b> · identidad competitiva del jugador.`],
      ["Trío de combate", `<b>${STAT.stronghold.label} ${c.combat.stronghold} · ${STAT.gamesense.label} ${c.combat.gamesense} · ${STAT.entryfrag.label} ${c.combat.entryfrag}</b> · lo único que se compara en un enfrentamiento.`],
    ].map(([t, s], i) => `<div class="anat-row"><span class="anat-n">${String(i + 1).padStart(2, "0")}</span><div><h4>${t}</h4><p>${s}</p></div></div>`).join("")}
    <p class="warn">Las estadísticas <b>salen del rendimiento real del jugador</b> en la temporada
    competitiva y viven en el modelo de carta. La interfaz solo las muestra: no las calcula ni las
    ajusta.</p>
  </div>
</div>
${foot(PAGE + 1)}`);
}

// ── 6 · Las tres estadísticas ─────────────────────────────────────────────
slide(`${head("02 · La carta", "The three combat stats")}
<div class="stats3">
  ${[
    ["stronghold", "Aguantar la posición", "Sobrevivir, no caer el primero, sostener el sitio."],
    ["gamesense", "Leer el juego", "Aportar a la ronda sin necesidad de fraguear."],
    ["entryfrag", "Abrir la ronda", "Agresión, primer contacto, iniciativa."],
  ].map(([k, t, s]) => `<div class="stat-card" style="--c:${STAT[k].color}">
      <span class="stat-abbr">${STAT[k].label}</span>
      <h3>${STAT[k].full}</h3>
      <p class="stat-t">${t}</p>
      <p class="stat-s">${s}</p>
      <div class="stat-bars">${mine.slice(0, 6).map((c) =>
        `<div class="sbar"><span>${esc(c.nick)}</span><i style="width:${c.combat[k]}%"></i><b>${c.combat[k]}</b></div>`).join("")}</div>
    </div>`).join("")}
</div>
<p class="journey-note">Cada carta tiene sus tres valores, y son distintos entre sí:
<b>${esc(byNick["Alfajer"].nick)}</b> es un ${STAT.entryfrag.full} de ${byNick["Alfajer"].combat.entryfrag}
con un ${STAT.gamesense.full} de solo ${byNick["Alfajer"].combat.gamesense}. No existe la carta que gane siempre.</p>
${foot(PAGE + 1)}`);

// ── 7 · Tabla de enfrentamientos ──────────────────────────────────────────
slide(`${head("02 · La carta", "Quién puede pelear contra quién")}
<div class="two matchup">
  <div>
    <p class="lead">La estadística que declaras <b>obliga</b> al rival a responder con una concreta.
    No puede elegir su mejor número: tiene que elegir su mejor carta <em>en ese eje</em>.</p>
    <div class="mtable">
      <div class="mrow">
        <span class="mstat" style="--c:${STAT.stronghold.color}">${STAT.stronghold.label} Stronghold</span>
        <span class="mlink">⟷</span>
        <span class="mstat" style="--c:${STAT.entryfrag.color}">${STAT.entryfrag.label} Entryfrag</span>
      </div>
      <div class="mrow">
        <span class="mstat" style="--c:${STAT.gamesense.color}">${STAT.gamesense.label} Gamesense</span>
        <span class="mlink">⟷</span>
        <span class="mstat" style="--c:${STAT.gamesense.color}">${STAT.gamesense.label} Gamesense</span>
      </div>
    </div>
    <p class="cap">El muro contra el que abre. La lectura contra la lectura. Es la tabla del
    documento de diseño original, sin añadidos.</p>
  </div>
  <div class="mex">
    <h4>Qué significa en la práctica</h4>
    ${[
      ["Declaras Stronghold", "El rival solo puede responder con Entryfrag."],
      ["Declaras Entryfrag", "El rival solo puede responder con Stronghold."],
      ["Declaras Gamesense", "El rival responde con Gamesense. Es el único espejo."],
    ].map(([a, b]) => `<div class="mex-row"><b>${a}</b><span>${b}</span></div>`).join("")}
    <div class="mex-note">
      <p>Por eso un mazo no es una lista de las diez cartas con más OVR: necesitas cubrir
      <b>los tres ejes</b>, o el rival te obligará a responder por tu lado más flojo.</p>
    </div>
  </div>
</div>
${foot(PAGE + 1)}`);

// ── 8 · Mi mazo ───────────────────────────────────────────────────────────
slide(`${head("03 · El mazo", "Mi mazo")}
<div class="deck-view">
  <div class="deck-cards">${mine.map((c) => card(c, "sm")).join("")}</div>
  <aside class="deck-side">
    <div class="dstat"><span>Cartas</span><b>10 / 10</b></div>
    <div class="dstat"><span>Suma de OVR</span><b>${D.deckMine.sumOvr}</b></div>
    <div class="dstat ok"><span>Estado</span><b>LISTO PARA DUELO</b></div>
    <h4>Composición</h4>
    ${["Duelista", "Controlador", "Iniciador", "Centinela", "Flex"].map((r) =>
      `<div class="drole"><span>${r}</span><i class="ok">●●</i><b>2 / 2</b></div>`).join("")}
    <h4>Cobertura de ejes</h4>
    ${["stronghold", "gamesense", "entryfrag"].map((k) => {
      const best = Math.max(...mine.map((c) => c.combat[k]));
      const avg = Math.round(mine.reduce((s, c) => s + c.combat[k], 0) / mine.length);
      return `<div class="dcov"><span style="color:${STAT[k].color}">${STAT[k].label}</span>
        <i><b style="width:${avg}%;background:${STAT[k].color}"></b></i>
        <em>máx ${best} · media ${avg}</em></div>`;
    }).join("")}
  </aside>
</div>
${foot(PAGE + 1)}`);

// ── 9 · Mazo válido / inválido ────────────────────────────────────────────
{
  const rc = D.invalidDeck.roleCounts;
  slide(`${head("03 · El mazo", "Mazo válido y mazo inválido")}
<div class="two vsdeck">
  <div class="deckbox ok">
    <div class="dbh"><span class="tick ok">✓</span><h3>Mazo válido</h3><b>LISTO PARA DUELO</b></div>
    <div class="mini-grid">${mine.map((c) => card(c, "xs")).join("")}</div>
    <ul class="dlist">
      <li>10 cartas exactas</li>
      <li>2 de cada rol: Duelista, Controlador, Iniciador, Centinela y Flex</li>
      <li>Todas de tu colección, sin repetir jugador</li>
    </ul>
  </div>
  <div class="deckbox bad">
    <div class="dbh"><span class="tick bad">✕</span><h3>Mazo inválido</h3><b>${esc(D.invalidDeck.status)}</b></div>
    <div class="rolecount">
      ${Object.entries(rc).map(([r, n]) => `<div class="rc ${n === 2 ? "" : "err"}"><span>${r}</span><b>${n} / 2</b></div>`).join("")}
    </div>
    <ul class="dlist err">
      ${D.invalidDeck.errors.map((e) => `<li>${esc(e.text)}</li>`).join("")}
    </ul>
    <p class="cap">El juego no deja empezar un duelo con un mazo ilegal, y explica exactamente qué
    falta. Nunca lo corrige por su cuenta.</p>
  </div>
</div>
${foot(PAGE + 1)}`);
}

// ── 10 · Home ─────────────────────────────────────────────────────────────
slide(`${head("04 · El duelo", "Punto de entrada")}
<div class="mock2">
  ${phone(`
    <div class="p-hero">
      <span class="p-eyebrow">MODO DE JUEGO</span>
      <h3 class="p-h1">DUELOS</h3>
      <p class="p-sub">Enfrenta tu mazo al de un rival. Diez cartas, diez turnos.</p>
      <button class="p-cta">JUGAR</button>
    </div>
    <div class="p-row2">
      <div class="p-tile"><i>▦</i><span>Mis mazos</span><em>3 guardados</em></div>
      <div class="p-tile"><i>▶</i><span>Repeticiones</span><em>12 partidas</em></div>
    </div>
    <div class="p-sect">Otros modos</div>
    <div class="p-list">
      <div class="p-li"><i>◫</i><span>Colección</span><em>184 cartas</em></div>
      <div class="p-li"><i>◈</i><span>Sobres</span><em>2 sin abrir</em></div>
      <div class="p-li muted"><i>◇</i><span>Draft</span><em>${"Próximamente"}</em></div>
    </div>`, { active: "Duelos" })}
  <div class="mock-notes">
    <h3>Duelos entra en el menú principal</h3>
    <p>Un destino más de la navegación, al mismo nivel que Colección y Sobres. Desde aquí se llega
    a las dos únicas cosas que necesita el jugador: <b>jugar</b> y <b>sus mazos</b>.</p>
    <div class="note-list">
      <div><b>Jugar</b><span>Lleva directo a elegir mazo y dificultad.</span></div>
      <div><b>Mis mazos</b><span>Construir y editar fuera de la partida, nunca dentro.</span></div>
      <div><b>Repeticiones</b><span>Cada partida terminada se puede volver a ver.</span></div>
    </div>
    <p class="tbd-line">${tbd("Draft")} aparece en el documento original como un segundo modo y queda
    fuera de esta fase.</p>
  </div>
</div>
${foot(PAGE + 1)}`);

// ── 11 · Mis mazos ────────────────────────────────────────────────────────
slide(`${head("04 · El duelo", "Mis mazos")}
<div class="mock2">
  ${phone(`
    <div class="p-title">MIS MAZOS <em>3 / 5</em></div>
    ${[
      ["Mazo 1", D.deckMine.sumOvr, "LISTO", mine.slice(0, 5)],
      ["Agresivo EMEA", 874, "LISTO", mine.slice(3, 8)],
    ].map(([n, ovr, st, cs]) => `<div class="p-deck">
        <div class="p-deck-h"><b>${n}</b><span class="p-pill ok">${st}</span></div>
        <div class="p-deck-cards">${cs.map((c) => card(c, "xxs", { stats: false, w: 44 })).join("")}<span class="p-more">+5</span></div>
        <div class="p-deck-f"><span>10 cartas · 5 roles</span><b>Σ OVR ${ovr}</b></div>
      </div>`).join("")}
    <div class="p-deck bad">
      <div class="p-deck-h"><b>Mazo incompleto</b><span class="p-pill bad">${esc(D.invalidDeck.status)}</span></div>
      <div class="p-deck-f"><span>8 cartas · faltan 2 Flex</span><b>—</b></div>
    </div>
    <button class="p-cta ghost">+ NUEVO MAZO</button>`, { active: "Duelos" })}
  <div class="mock-notes">
    <h3>El mazo se elige antes, nunca durante</h3>
    <p>Es una regla del documento original: <b>el mazo solo se puede cambiar aquí</b>, jamás en
    partida. Al empezar un duelo se congela una copia exacta de las diez cartas.</p>
    <div class="note-list">
      <div><b>Estado siempre visible</b><span>Un mazo ilegal se marca antes de intentar jugarlo.</span></div>
      <div><b>Suma de OVR</b><span>Se muestra porque interviene en el desempate final.</span></div>
      <div><b>Copia congelada</b><span>Si vendes una carta a mitad de partida, el duelo no cambia.</span></div>
    </div>
  </div>
</div>
${foot(PAGE + 1)}`);

// ── 12 · Constructor de mazo ──────────────────────────────────────────────
slide(`${head("04 · El duelo", "Constructor de mazo")}
<div class="mock2 wide-left">
  ${phone(`
    <div class="p-title">CONSTRUCTOR <em>8 / 10</em></div>
    <div class="p-slots">
      ${["Duelista", "Controlador", "Iniciador", "Centinela", "Flex"].map((r, i) => {
        const cs = mine.filter((c) => c.role === r);
        const filled = i < 4 ? 2 : 0;
        return `<div class="p-slot ${filled === 2 ? "" : "need"}">
          <span class="p-slot-r">${r}</span>
          <div class="p-slot-c">
            ${filled === 2 ? cs.map((c) => card(c, "xxs", { stats: false, w: 30 })).join("")
              : `<span class="p-empty">+</span><span class="p-empty">+</span>`}
          </div>
          <b class="${filled === 2 ? "ok" : "need"}">${filled}/2</b>
        </div>`;
      }).join("")}
    </div>
    <div class="p-picker">
      <div class="p-picker-h">ELEGIBLES · FLEX <em>14</em></div>
      <div class="p-picker-c">${[byNick["basic"], byNick["Veqaj"], byNick["slowly"]].map((c) => card(c, "xs", { w: 46 })).join("")}<span class="p-more tall">+11</span></div>
    </div>`, { active: "Duelos" })}
  <div class="mock-notes">
    <h3>Solo te ofrece lo que puedes poner</h3>
    <p>El constructor filtra por el rol que te falta y esconde lo que ya no es legal: cartas que ya
    están en el mazo, o un jugador que ya has usado con otra variante.</p>
    <div class="note-list">
      <div><b>Diez huecos, cinco parejas</b><span>2 Duelistas, 2 Controladores, 2 Iniciadores, 2 Centinelas, 2 Flex.</span></div>
      <div><b>Un jugador, una vez</b><span>No puedes llenar el mazo con diez versiones del mismo jugador.</span></div>
      <div><b>Se guarda incompleto</b><span>Puedes dejarlo a medias; simplemente no podrás jugarlo.</span></div>
    </div>
    <p class="tbd-line">${tbd("Química")} — el documento original describe bonificaciones por liga,
    nacionalidad y equipo. Se diseñará después de esta fase.</p>
  </div>
</div>
${foot(PAGE + 1)}`);

// ── 13 · Dificultad ───────────────────────────────────────────────────────
slide(`${head("06 · El oponente", "Choose your opponent")}
<div class="diff">
  ${[
    ["EASY", "Imprevisible", "Juega de forma legal pero sin plan. Perfecto para aprender el ritmo de los diez turnos.", 1,
      ["Elige la carta al azar", "Declara el eje al azar", "No guarda nada para el final", "Puedes ganarle sin pensar"]],
    ["NORMAL", "Competitivo", "Mezcla decisiones estratégicas con decisiones improvisadas. Se le gana, pero castiga los errores.", 2,
      ["Unas veces busca su mejor eje…", "…y otras improvisa", "Empieza a guardar sus cartas fuertes", "Un mal turno tuyo le vale la partida"]],
    ["HARD", "Exigente", "Elige con criterio la mayor parte del tiempo: guarda cartas, responde con el margen justo y sacrifica lo que no le sirve.", 3,
      ["Ataca por su eje más fuerte", "Gana por el margen mínimo", "Sacrifica lo que no le sirve", "Y aun así, no es perfecto"]],
  ].map(([n, t, s, lv, how]) => `<div class="dcard-diff lv${lv}">
      <span class="diff-n">${n}</span>
      <h3>${t}</h3>
      <p>${s}</p>
      <ul class="diff-how">${how.map((h) => `<li>${h}</li>`).join("")}</ul>
      <div class="diff-bars">${[1, 2, 3].map((i) => `<i class="${i <= lv ? "on" : ""}"></i>`).join("")}</div>
    </div>`).join("")}
</div>
<div class="fairbar">
  <b>Ningún nivel ve las cartas que el rival no ha jugado.</b>
  <span>La dificultad está en la calidad de la decisión, nunca en información que tú no tienes.</span>
</div>
${foot(PAGE + 1)}`);

// ── 14 · Juego limpio / información oculta ────────────────────────────────
slide(`${head("06 · El oponente", "Información oculta: las mismas reglas para los dos")}
<div class="two fair">
  <div>
    <div class="fair-grid">
      <div class="fcol">
        <h4>Lo que ves de tu rival</h4>
        <ul class="ok-list">
          <li>Las cartas que <b>ya ha jugado</b></li>
          <li>La estadística que declara <b>en este turno</b></li>
          <li>El marcador y el historial completo</li>
        </ul>
      </div>
      <div class="fcol">
        <h4>Lo que no ve nadie</h4>
        <ul class="no-list">
          <li>Las cartas que le <b>quedan</b> al rival</li>
          <li>Qué piensa declarar en el próximo turno</li>
        </ul>
      </div>
    </div>
    <div class="fair-note">
      <p><b>El bot juega con exactamente la misma información que tú.</b> No ve tu mano, no cambia
      las reglas y no recibe puntos extra. Un nivel más alto es un rival que <em>decide mejor</em>,
      no un rival que hace trampas.</p>
    </div>
  </div>
  <div class="hidden-art">
    <div class="ha-row"><span class="ha-lab">Tu mano</span>${mine.slice(0, 4).map((c) => card(c, "xs")).join("")}</div>
    <div class="ha-row"><span class="ha-lab">Jugadas del rival</span>
      ${rival.slice(0, 2).map((c) => card(c, "xs", { spent: true })).join("")}
      ${[0, 1].map(() => `<span class="ha-back"></span>`).join("")}
      ${[0, 1].map(() => `<span class="ha-back"></span>`).join("")}
    </div>
    <p class="cap center">Lo que el rival aún no ha jugado es una carta boca abajo. Para ti y para él.</p>
  </div>
</div>
${foot(PAGE + 1)}`);

// ── 15 · Preparación ──────────────────────────────────────────────────────
slide(`${head("04 · El duelo", "Antes de empezar")}
<div class="mock2">
  ${phone(`
    <div class="p-title">PREPARACIÓN</div>
    <div class="p-prep">
      <div class="p-prep-side">
        <div class="p-prep-h"><span class="p-prep-lab">TÚ</span><b>${esc(D.deckMine.name)}</b><em>Σ OVR ${D.deckMine.sumOvr}</em></div>
        <div class="p-prep-cards">${mine.slice(0, 5).map((c) => card(c, "xxs", { stats: false, w: 40 })).join("")}<span class="p-more xs">+5</span></div>
      </div>
      <span class="p-prep-vs">VS</span>
      <div class="p-prep-side rival">
        <div class="p-prep-h"><span class="p-prep-lab">RIVAL · NORMAL</span><b>Mazo desconocido</b><em>10 cartas</em></div>
        <div class="p-prep-cards">${[0, 1, 2, 3, 4].map(() => `<span class="ha-back sm"></span>`).join("")}<span class="p-more xs">+5</span></div>
      </div>
    </div>
    <div class="p-first">
      <span>PRIMER ATAQUE</span>
      <div class="p-first-opts"><b class="on">TÚ</b><b>RIVAL</b></div>
      <em>El ataque alterna cada turno: 5 y 5.</em>
    </div>
    <button class="p-cta">EMPEZAR DUELO</button>`, { active: "Duelos" })}
  <div class="mock-notes">
    <h3>Lo que se fija aquí ya no cambia</h3>
    <div class="note-list">
      <div><b>Las diez cartas</b><span>Se congela una copia. El duelo es inmune a lo que pase fuera.</span></div>
      <div><b>El rival</b><span>Su mazo existe, pero tú no lo ves. Solo verás lo que juegue.</span></div>
      <div><b>Quién ataca primero</b><span>Después alterna: cada bando ataca cinco veces.</span></div>
      <div><b>Las reglas de la partida</b><span>Un duelo empezado hoy se resuelve con las reglas de hoy, aunque el juego se actualice a mitad.</span></div>
    </div>
    <p class="tbd-line">${tbd("Recompensas")} y ${tbd("Emparejamiento PvP")} no forman parte de esta fase.</p>
  </div>
</div>
${foot(PAGE + 1)}`);

// ── 16 · Pantalla principal del duelo ─────────────────────────────────────
{
  const t = M.turns[4];
  slide(`${head("04 · El duelo", "La pantalla de duelo")}
<div class="mock2 big">
  ${phone(`
    <div class="p-score">
      <div class="ps-side you"><span>TÚ</span><b>${t.scoreAfterA}</b></div>
      <div class="ps-mid"><span>TURNO</span><b>${t.number} / 10</b><em>ATACAS TÚ</em></div>
      <div class="ps-side bot"><b>${t.scoreAfterB}</b><span>BOT</span></div>
    </div>
    <div class="p-track">${M.turns.map((x) => `<i class="${x.number < t.number ? "t" + x.outcome : x.number === t.number ? "now" : ""}"></i>`).join("")}</div>
    <div class="p-field">
      <div class="p-field-lab">RIVAL · 6 cartas</div>
      <div class="p-hand rival">${[0, 1, 2, 3, 4, 5].map(() => `<span class="ha-back sm"></span>`).join("")}</div>
      <div class="p-center">
        <div class="p-slots2"><span class="p-ghost">TU CARTA</span><b>VS</b><span class="p-ghost">RIVAL</span></div>
        <span class="p-await">Elige tu carta y declara una estadística</span>
      </div>
      <div class="p-field-lab">TU MANO · 6 cartas</div>
      <div class="p-hand">${[byNick["basic"], byNick["trent"], byNick["xenom"], byNick["vo0kashu"]].map((c) => card(c, "xs", { w: 52 })).join("")}<span class="p-more tall">+2</span></div>
    </div>`, { active: "Duelos" })}
  <div class="mock-notes">
    <h3>Todo lo importante cabe en una pantalla</h3>
    <div class="note-list">
      <div><b>Marcador</b><span>Arriba y siempre visible. Es el elemento principal del duelo.</span></div>
      <div><b>Turno y quién ataca</b><span>Nunca hay duda de a quién le toca declarar.</span></div>
      <div><b>La barra de diez</b><span>Un punto por turno: verde ganado, rojo perdido, gris empatado.</span></div>
      <div><b>Tu mano encoge</b><span>Cada carta jugada desaparece. Al final del turno 10 no queda ninguna.</span></div>
    </div>
  </div>
</div>
${foot(PAGE + 1)}`);
}

// ── 17 · Selección de carta ───────────────────────────────────────────────
slide(`${head("04 · El duelo", "Paso 1 · eliges la carta")}
<div class="steps2">
  ${phone(`
    <div class="p-score compact">
      <div class="ps-side you"><span>TÚ</span><b>${t8.scoreAfterA - 1}</b></div>
      <div class="ps-mid"><span>TURNO</span><b>9 / 10</b><em>ATACAS TÚ</em></div>
      <div class="ps-side bot"><b>${t8.scoreAfterB}</b><span>BOT</span></div>
    </div>
    <div class="p-stepbar"><b class="on">1 · CARTA</b><b>2 · ESTADÍSTICA</b><b>3 · RIVAL</b></div>
    <div class="p-field-lab">TU MANO · 2 cartas</div>
    <div class="p-hand pick">
      ${card(byNick["xenom"], "sm", { sel: true })}
      ${card(byNick["vo0kashu"], "sm")}
    </div>
    <div class="p-picked">
      <span>SELECCIONADA</span>
      <b>${esc(byNick["xenom"].nick)}</b>
      <em>${byNick["xenom"].role} · OVR ${byNick["xenom"].ovr}</em>
    </div>
    <button class="p-cta">CONTINUAR</button>`, { active: "Duelos", h: 516 })}
  <div class="step-notes">
    <span class="step-n">01</span>
    <h3>Solo puedes usar lo que te queda</h3>
    <p>Las cartas gastadas ya no están. En el turno 9 te quedan dos, y esa escasez es la que
    convierte cada elección temprana en una decisión real.</p>
    <div class="tip">
      <b>La decisión de verdad</b>
      <p>¿Gastas ahora tu <b>${esc(byNick["xenom"].nick)}</b> con
      ${STAT.stronghold.label}&nbsp;${byNick["xenom"].combat.stronghold}, o lo guardas para el último
      turno y arriesgas a que el rival te obligue a responder por tu lado flojo?</p>
    </div>
  </div>
</div>
${foot(PAGE + 1)}`);

// ── 18 · Selección de estadística ─────────────────────────────────────────
{
  const c = byNick["xenom"];
  slide(`${head("04 · El duelo", "Paso 2 · declaras la estadística")}
<div class="steps2">
  ${phone(`
    <div class="p-stepbar"><b>1 · CARTA</b><b class="on">2 · ESTADÍSTICA</b><b>3 · RIVAL</b></div>
    <div class="p-declare">
      ${card(c, "sm")}
      <div class="p-declare-opts">
        ${["stronghold", "gamesense", "entryfrag"].map((k) => `<button class="p-stat ${k === "stronghold" ? "on" : ""}" style="--c:${STAT[k].color}">
            <span>${STAT[k].label}</span><b>${c.combat[k]}</b>
            <em>responde con ${STAT[COUNTER[k]].label}</em>
          </button>`).join("")}
      </div>
    </div>
    <div class="p-warnbox">
      Al declarar <b style="color:${STAT.stronghold.color}">${STAT.stronghold.full} ${c.combat.stronghold}</b>,
      el rival <b>solo</b> puede responder con ${STAT.entryfrag.full}.
    </div>
    <button class="p-cta">DECLARAR</button>`, { active: "Duelos", h: 516 })}
  <div class="step-notes">
    <span class="step-n">02</span>
    <h3>Declarar es elegir el terreno</h3>
    <p>La estadística que declaras <b>define la respuesta legal del rival</b>. No es solo enseñar tu
    número más alto: es obligarle a pelear donde tú quieres.</p>
    <div class="tip">
      <b>Por eso hay lectura</b>
      <p>Si has visto que el rival ya gastó sus dos cartas con más ${STAT.entryfrag.full},
      declarar ${STAT.stronghold.full} deja de ser arriesgado y pasa a ser el movimiento correcto.</p>
    </div>
  </div>
</div>
${foot(PAGE + 1)}`);
}

// ── 19 · Respuesta del rival ──────────────────────────────────────────────
{
  const t = revealTurn;
  slide(`${head("04 · El duelo", "Paso 3 · responde el rival")}
<div class="steps2">
  ${phone(`
    <div class="p-stepbar"><b>1 · CARTA</b><b>2 · ESTADÍSTICA</b><b class="on">3 · RIVAL</b></div>
    <div class="p-vs-stage">
      <div class="p-vs-you">
        <span class="p-vs-lab">TU DECLARACIÓN</span>
        ${card(byNick[t.a.nick], "sm")}
        <span class="chip big" style="--c:${STAT[t.a.stat].color}">${STAT[t.a.stat].label} <b>${t.a.value}</b></span>
      </div>
      <span class="p-vs-mid">VS</span>
      <div class="p-vs-rival">
        <span class="p-vs-lab">EL RIVAL RESPONDE</span>
        <div class="flip"><span class="ha-back md"></span><span class="flip-q">?</span></div>
        <span class="chip big ghost" style="--c:${STAT[t.b.stat].color}">${STAT[t.b.stat].label} <b>?</b></span>
      </div>
    </div>
    <div class="p-warnbox">Está obligado a responder con
      <b style="color:${STAT[t.b.stat].color}">${STAT[t.b.stat].full}</b>. Elegirá con qué carta.</div>`,
    { active: "Duelos", h: 516 })}
  <div class="step-notes">
    <span class="step-n">03</span>
    <h3>El rival elige carta, no estadística</h3>
    <p>Su única decisión es <b>cuánto está dispuesto a gastar</b> para ganar este turno. Puede
    superarte por poco y guardar lo bueno, o rendir el turno y sacrificar su carta más floja.</p>
    <div class="tip">
      <b>Esa elección se ve en el historial</b>
      <p>Si responde con el mínimo imprescindible, sabes que aún tiene cartas fuertes. Si sacrifica
      una carta baja, te está regalando el turno para quedarse con la ventaja al final.</p>
    </div>
  </div>
</div>
${foot(PAGE + 1)}`);
}

// ── 20 · The duel moment ──────────────────────────────────────────────────
{
  const t = revealTurn;
  const A = byNick[t.a.nick], B = byNick[t.b.nick];
  slide(`
<div class="reveal">
  <span class="reveal-kicker">04 · El duelo — the duel moment</span>
  <div class="reveal-stage">
    <div class="reveal-side win">
      ${card(A, "lg", { glow: true })}
      <div class="reveal-val" style="--c:${STAT[t.a.stat].color}">
        <span>${STAT[t.a.stat].full}</span><b>${t.a.value}</b>
      </div>
      <span class="reveal-owner">TÚ</span>
    </div>
    <div class="reveal-mid">
      <span class="reveal-vs">VS</span>
      <div class="reveal-verdict">
        <span>GANAS EL TURNO</span>
        <b>+1</b>
        <em>${t.a.value} &gt; ${t.b.value}</em>
      </div>
      <span class="reveal-turn">TURNO ${t.number} / 10</span>
    </div>
    <div class="reveal-side lose">
      ${card(B, "lg")}
      <div class="reveal-val" style="--c:${STAT[t.b.stat].color}">
        <span>${STAT[t.b.stat].full}</span><b>${t.b.value}</b>
      </div>
      <span class="reveal-owner">BOT</span>
    </div>
  </div>
  <p class="reveal-foot">Gana el número mayor. Sin dados, sin porcentajes ocultos: los dos valores
  estaban en las cartas desde el principio.</p>
</div>
${foot(PAGE + 1)}`, { cls: "is-reveal" });
}

// ── 21 · Resultado del turno + empate ─────────────────────────────────────
{
  const t = tieTurn;
  slide(`${head("05 · Las reglas", "Resultado del turno")}
<div class="two turnres">
  <div>
    <h4 class="mini-h">Las tres cosas que pueden pasar</h4>
    <div class="outcomes">
      <div class="oc win"><span>GANAS</span><b>+1</b><em>Tu valor es mayor</em></div>
      <div class="oc lose"><span>PIERDES</span><b>+1 rival</b><em>Su valor es mayor</em></div>
      <div class="oc tie"><span>EMPATE</span><b>0</b><em>Valores idénticos: nadie puntúa</em></div>
    </div>
    <div class="tiebox">
      <span class="tiebox-lab">EMPATE REAL DE ESTA PARTIDA · TURNO ${t.number}</span>
      <div class="tiebox-row">
        <div>${card(byNick[t.a.nick], "sm")}<span class="chip" style="--c:${STAT[t.a.stat].color}">${STAT[t.a.stat].label} <b>${t.a.value}</b></span></div>
        <span class="eq">=</span>
        <div>${card(byNick[t.b.nick], "sm")}<span class="chip" style="--c:${STAT[t.b.stat].color}">${STAT[t.b.stat].label} <b>${t.b.value}</b></span></div>
      </div>
      <p>Dos ${STAT.gamesense.full} de ${t.a.value}. <b>Nadie recibe punto</b>, y las dos cartas se
      gastan igual. El marcador se queda como estaba.</p>
    </div>
  </div>
  <div class="afterturn">
    <h4 class="mini-h">Y entonces el turno pasa</h4>
    ${phone(`
      <div class="p-turnres win">
        <span class="p-tr-lab">TURNO ${revealTurn.number}</span>
        <b class="p-tr-verdict">GANAS EL TURNO</b>
        <div class="p-tr-line">
          <span>${esc(revealTurn.a.nick)}</span>
          <i style="color:${STAT[revealTurn.a.stat].color}">${STAT[revealTurn.a.stat].label} ${revealTurn.a.value}</i>
          <em>&gt;</em>
          <i style="color:${STAT[revealTurn.b.stat].color}">${STAT[revealTurn.b.stat].label} ${revealTurn.b.value}</i>
          <span>${esc(revealTurn.b.nick)}</span>
        </div>
        <div class="p-tr-score"><b>${revealTurn.scoreAfterA}</b><span>–</span><b>${revealTurn.scoreAfterB}</b></div>
        <div class="p-tr-next">SIGUIENTE TURNO · ATACA EL RIVAL ›</div>
      </div>`, { active: "Duelos", h: 300 })}
    <p class="cap">El ataque <b>alterna</b> siempre. Ganes o pierdas, el siguiente turno lo abre
    el otro bando.</p>
  </div>
</div>
${foot(PAGE + 1)}`);
}

// ── 22 · Diez turnos + historial ──────────────────────────────────────────
slide(`${head("04 · El duelo", "Diez turnos, una partida entera")}
<div class="ten">
  ${M.turns.map((t) => `<div class="tn ${t.outcome === "A" ? "w" : t.outcome === "B" ? "l" : "t"}">
      <div class="tn-h"><span>TURNO ${t.number}</span><i>${t.attacker === "A" ? "atacas" : "ataca el rival"}</i></div>
      <div class="tn-body">
        <div class="tn-p"><b>${esc(t.a.nick)}</b><span style="color:${STAT[t.a.stat].color}">${STAT[t.a.stat].label} ${t.a.value}</span></div>
        <span class="tn-op">${t.outcome === "A" ? "&gt;" : t.outcome === "B" ? "&lt;" : "="}</span>
        <div class="tn-p r"><b>${esc(t.b.nick)}</b><span style="color:${STAT[t.b.stat].color}">${STAT[t.b.stat].label} ${t.b.value}</span></div>
      </div>
      <div class="tn-f"><span class="tn-res">${t.outcome === "A" ? "GANAS" : t.outcome === "B" ? "PIERDES" : "EMPATE"}</span><b>${t.scoreAfterA}–${t.scoreAfterB}</b></div>
    </div>`).join("")}
</div>
<p class="journey-note">Partida real completa. Empieza 0–2 abajo, se da la vuelta en el turno 5 y se
decide en el 9. <b>Un turno empatado</b> —el 6— no puntúa para nadie.</p>
${foot(PAGE + 1)}`);

// ── 23 · Marcador ─────────────────────────────────────────────────────────
slide(`
<div class="scoreboard">
  <span class="reveal-kicker">04 · El duelo — el marcador</span>
  <div class="sb-main">
    <div class="sb-side you">
      <span class="sb-lab">TÚ</span>
      <b class="sb-num">${t8.scoreAfterA}</b>
      <span class="sb-deck">${esc(D.deckMine.name)}</span>
    </div>
    <div class="sb-mid">
      <span class="sb-vs">VS</span>
      <div class="sb-turn">TURNO ${t8.number} / 10</div>
      <div class="sb-track">${M.turns.map((x) => `<i class="${x.number <= t8.number ? "t" + x.outcome : ""}"></i>`).join("")}</div>
      <div class="sb-legend"><span><i class="tA"></i>ganado</span><span><i class="tB"></i>perdido</span><span><i class="tTIE"></i>empatado</span><span><i></i>por jugar</span></div>
    </div>
    <div class="sb-side bot">
      <span class="sb-lab">BOT · NORMAL</span>
      <b class="sb-num">${t8.scoreAfterB}</b>
      <span class="sb-deck">Mazo rival</span>
    </div>
  </div>
  <div class="sb-foot">
    <div><span>Cartas restantes</span><b>2 · 2</b></div>
    <div><span>Turnos empatados</span><b>${M.turns.filter((x) => x.number <= t8.number && x.outcome === "TIE").length}</b></div>
    <div><span>Quedan</span><b>2 turnos</b></div>
  </div>
</div>
${foot(PAGE + 1)}`, { cls: "is-score" });

// ── 24 · Flujo de la partida ──────────────────────────────────────────────
slide(`${head("05 · Las reglas", "El flujo de una partida")}
<div class="flow">
  <div class="flow-pre">
    ${["Preparación", "Selección de mazo", "Quién ataca primero"].map((t, i) =>
      `<div class="fbox pre"><span>${String(i + 1).padStart(2, "0")}</span>${t}</div>${i < 2 ? '<i class="fdown">▼</i>' : ""}`).join("")}
  </div>
  <span class="fjoin">›</span>
  <div class="flow-loop">
    <div class="loop-head">EL TURNO · se repite 10 veces</div>
    <div class="loop-steps">
      ${[
        ["Eliges carta", "de las que te quedan"],
        ["Declaras estadística", "SH, GS o EF"],
        ["Responde el rival", "con la estadística obligada"],
        ["Enfrentamiento", "gana el valor mayor"],
        ["Resultado", "marcador e historial"],
      ].map(([t, s], i) => `<div class="fbox loop"><b>${t}</b><em>${s}</em></div>${i < 4 ? '<i class="fright">›</i>' : ""}`).join("")}
    </div>
    <div class="loop-back">↺ el ataque alterna · cada bando ataca 5 veces</div>
  </div>
  <span class="fjoin">›</span>
  <div class="flow-end">
    <div class="fbox end"><b>TURNO 10 COMPLETADO</b><em>los dos mazos se han agotado</em></div>
    <i class="fdown">▼</i>
    <div class="fbox final"><b>RESULTADO FINAL</b><em>victoria · derrota · empate</em></div>
  </div>
</div>
${foot(PAGE + 1)}`);

// ── 25 · Empates y desempates ─────────────────────────────────────────────
slide(`${head("05 · Las reglas", "Cómo se gana y cómo se empata")}
<div class="two ties">
  <div>
    <h4 class="mini-h">Durante la partida</h4>
    <div class="rulebox">
      <b>Si las dos estadísticas son idénticas, nadie recibe punto.</b>
      <p>Las dos cartas se gastan igual. Es lo único coherente con &ldquo;gana el valor mayor&rdquo;:
      si no hay valor mayor, no hay ganador de ese turno.</p>
    </div>
    <h4 class="mini-h">Al terminar los diez turnos</h4>
    <div class="ladder">
      ${[
        ["1", "Enfrentamientos ganados", "Quien ha ganado más turnos.", "on"],
        ["2", "Suma de las medias del mazo", "Si el marcador está empatado, gana la suma de OVR más alta. Es la regla del documento original.", "on"],
        ["3", "Estadística total declarada", "Si las medias también coinciden, gana quien haya puesto más estadística sobre la mesa en los diez turnos.", "on"],
        ["—", "DRAW", "Si todo sigue igual, la partida es un empate. Es un resultado válido, no un error.", "end"],
      ].map(([n, t, s, cl]) => `<div class="lstep ${cl}"><span class="lnum">${n}</span><div><b>${t}</b><p>${s}</p></div></div>`).join("")}
    </div>
    <p class="cap">No hay un cuarto criterio. La partida siempre termina, y siempre se puede explicar
    por qué terminó así.</p>
  </div>
  <div class="drawex">
    <h4 class="mini-h">Un empate real, con dos mazos idénticos</h4>
    <div class="drawcard">
      <div class="dr-row"><span>Enfrentamientos</span><b>${MW.scoreA} – ${MW.scoreB}</b><i>empate</i></div>
      <div class="dr-row"><span>Suma de medias</span><b>${MW.sumOvrA} – ${MW.sumOvrB}</b><i>empate</i></div>
      <div class="dr-row"><span>Estadística total</span><b>${MW.statTotalA} – ${MW.statTotalB}</b><i>empate</i></div>
      <div class="dr-final">DRAW</div>
      <p>Cuando dos jugadores llevan exactamente el mismo mazo, ningún criterio del mazo puede
      separarlos. El empate es la respuesta honesta.</p>
    </div>
    <div class="freq">
      <div><b>1 de cada 5</b><span>duelos entre mazos idénticos llegaba antes a &ldquo;sin resultado&rdquo;</span></div>
      <div class="arr">›</div>
      <div><b>Prácticamente ninguno</b><span>ahora termina sin un resultado que el jugador entienda</span></div>
    </div>
  </div>
</div>
${foot(PAGE + 1)}`);

// ── 26 · Resultado final ──────────────────────────────────────────────────
slide(`${head("07 · El resultado", "Victoria, derrota, empate")}
<div class="results3">
  ${[
    ["VICTORY", "win", M, "Ganaste más enfrentamientos."],
    ["DEFEAT", "lose", MD, "El rival ganó más enfrentamientos."],
    ["DRAW", "draw", MW, "Empate en todos los criterios."],
  ].map(([title, cls, x, why]) => `
    <div class="resbox ${cls}">
      <span class="res-t">${title}</span>
      <div class="res-score"><b>${x.scoreA}</b><span>–</span><b>${x.scoreB}</b></div>
      <div class="res-rows">
        <div><span>Turnos ganados</span><b>${x.turns.filter((t) => t.outcome === "A").length} / ${x.turns.filter((t) => t.outcome === "B").length}</b></div>
        <div><span>Turnos empatados</span><b>${x.tiedEncounters}</b></div>
        <div><span>Estadística total</span><b>${x.statTotalA} – ${x.statTotalB}</b></div>
        ${x.sumOvrA != null ? `<div><span>Suma de medias</span><b>${x.sumOvrA} – ${x.sumOvrB}</b></div>` : ""}
      </div>
      <p class="res-why">${why}</p>
      <div class="res-btns"><b>VOLVER A JUGAR</b><span>VER PARTIDA</span><span>MIS MAZOS</span></div>
    </div>`).join("")}
</div>
<p class="journey-note">Cada final explica <b>por qué</b> terminó así, con las cifras a la vista.
${tbd("Recompensas")} llegará en una fase posterior: hoy el resultado es solo el resultado.</p>
${foot(PAGE + 1)}`);

// ── 27 · Replay ───────────────────────────────────────────────────────────
slide(`${head("07 · El resultado", "Repetición de la partida")}
<div class="mock2">
  ${phone(`
    <div class="p-title">REPETICIÓN <em>${esc(D.deckMine.name)} vs Bot</em></div>
    <div class="p-replay-head">
      <span class="p-pill ok">VICTORIA ${M.scoreA}–${M.scoreB}</span>
      <span class="p-pill">NORMAL</span>
    </div>
    <div class="p-timeline">
      ${M.turns.map((t) => `<i class="t${t.outcome} ${t.number === revealTurn.number ? "cur" : ""}">${t.number}</i>`).join("")}
    </div>
    <div class="p-replay-card">
      <span class="p-rc-lab">TURNO ${revealTurn.number} · ATACAS TÚ</span>
      <div class="p-rc-duel">
        ${card(byNick[revealTurn.a.nick], "xs")}
        <div class="p-rc-mid">
          <span style="color:${STAT[revealTurn.a.stat].color}">${STAT[revealTurn.a.stat].label} ${revealTurn.a.value}</span>
          <b>&gt;</b>
          <span style="color:${STAT[revealTurn.b.stat].color}">${STAT[revealTurn.b.stat].label} ${revealTurn.b.value}</span>
        </div>
        ${card(byNick[revealTurn.b.nick], "xs")}
      </div>
      <div class="p-rc-res">GANAS · marcador ${revealTurn.scoreAfterA}–${revealTurn.scoreAfterB}</div>
    </div>
    <div class="p-controls"><i>◀◀</i><i>◀</i><b>▶</b><i>▶</i><i>▶▶</i></div>`,
    { active: "Duelos" })}
  <div class="mock-notes">
    <h3>La partida se puede volver a ver entera</h3>
    <p>No es un vídeo: el juego <b>guarda las decisiones</b>, no las imágenes. Por eso una repetición
    ocupa casi nada y se puede reproducir turno a turno, hacia delante y hacia atrás.</p>
    <div class="note-list">
      <div><b>Idéntica siempre</b><span>La misma partida se reproduce igual hoy y dentro de un año.</span></div>
      <div><b>Con sus reglas</b><span>Una partida antigua se vuelve a ver con las reglas con las que se jugó, no con las nuevas.</span></div>
      <div><b>Todo el detalle</b><span>Cartas, estadísticas declaradas, decisiones y marcador de cada turno.</span></div>
    </div>
    <p class="tbd-line">Compartir repeticiones y ver partidas de otros jugadores: ${tbd("Posterior a esta fase")}.</p>
  </div>
</div>
${foot(PAGE + 1)}`);

// ── 28 · Arquitectura ─────────────────────────────────────────────────────
slide(`${head("08 · El plan", "Cómo está montado por dentro", "Una sola página técnica")}
<div class="arch">
  ${[
    ["Datos de carta", "Jugador, rendimiento real, variante"],
    ["Mazo de duelo", "10 cartas, 5 roles, validado"],
    ["Copia congelada", "Las cartas de esta partida, intocables"],
    ["Sistema de turnos", "Quién ataca, qué es legal, cuándo se avanza"],
    ["Resolutor de combate", "Compara, puntúa, desempata"],
    ["Resultado", "Marcador, motivo, historial"],
    ["Interfaz", "Lo enseña"],
  ].map((x, i) => `<div class="abox ${i === 4 ? "key" : ""} ${i === 6 ? "ui" : ""}">
      <b>${x[0]}</b><em>${x[1]}</em>
    </div>${i < 6 ? '<i class="adown">▼</i>' : ""}`).join("")}
</div>
<div class="arch-claim">
  <b>La interfaz presenta el juego. El dominio determina el resultado.</b>
  <span>Ninguna pantalla puede calcular un marcador, inventar un desempate ni cambiar un ganador.
  Por eso el mismo duelo da el mismo resultado en el móvil, en el escritorio y en una repetición.</span>
</div>
${foot(PAGE + 1)}`);

// ── 29 · Lo que ya está construido ────────────────────────────────────────
slide(`${head("08 · El plan", "What is already built")}
<div class="built">
  ${[
    ["Modelo de carta", "Jugador, variante, rareza y serie"],
    ["Estadísticas de combate", "Stronghold, Gamesense y Entryfrag"],
    ["OVR", "Valoración global de cada carta"],
    ["Validación de mazo", "10 cartas, 5 roles, sin repetir jugador"],
    ["Resolutor de combate", "Comparación, marcador y desempates"],
    ["Sistema de turnos", "Diez turnos con ataque alterno"],
    ["Oponente", "Un rival que juega la partida entera"],
    ["Dificultad", "EASY, NORMAL y HARD"],
    ["Reglas de empate", "Empate de turno y empate de partida"],
    ["Repetición", "Reproducción exacta de la partida"],
    ["Azar reproducible", "El mismo duelo se repite igual"],
    ["Reglas versionadas", "Las partidas antiguas no cambian"],
  ].map(([t, s]) => `<div class="bitem"><span class="bt">✓</span><div><b>${t}</b><em>${s}</em></div></div>`).join("")}
</div>
<p class="journey-note">El motor del duelo está terminado y probado: juega partidas completas, las
puntúa, las explica y las guarda. <b>Lo que falta es la parte que se ve.</b></p>
${foot(PAGE + 1)}`);

// ── 30 · Lo que construimos ahora ─────────────────────────────────────────
slide(`${head("08 · El plan", "Next — gameplay experience")}
<div class="next">
  ${[
    ["01", "Constructor de mazo", "Elegir, filtrar por rol y guardar mazos legales"],
    ["02", "Antesala del duelo", "Elegir mazo, elegir dificultad, empezar"],
    ["03", "Pantalla de duelo", "Marcador, mano, turno y ritmo"],
    ["04", "Selección de carta", "Con lo que te queda, no con todo"],
    ["05", "Declaración de estadística", "Y la consecuencia visible sobre el rival"],
    ["06", "Revelación del enfrentamiento", "El momento importante del juego"],
    ["07", "Historial de turnos", "Qué ha pasado y qué se ha gastado"],
    ["08", "Resultado final", "Victoria, derrota o empate, con su motivo"],
    ["09", "Repetición", "Volver a ver la partida turno a turno"],
  ].map(([n, t, s]) => `<div class="nitem"><span class="nn">${n}</span><div><b>${t}</b><em>${s}</em></div></div>`).join("")}
</div>
<p class="journey-note">Nueve pantallas. Ninguna inventa reglas: todas consumen el motor que ya
existe. <b>Convertir el motor de duelo en una experiencia jugable.</b></p>
${foot(PAGE + 1)}`);

// ── 31 · Fuera de esta fase ───────────────────────────────────────────────
slide(`${head("08 · El plan", "Not in this phase")}
<div class="notin">
  ${[
    ["PvP", "Duelos contra otras personas"],
    ["Emparejamiento", "Buscar rival por nivel"],
    ["Tiempo real", "Partidas simultáneas y turnos con reloj"],
    ["Economía del duelo", "Coste de entrada o apuestas"],
    ["Mercado", "Compraventa entre jugadores"],
    ["Recompensas", "Qué ganas por ganar"],
    ["Química", "Bonificación por liga, país y equipo"],
    ["Abandono y rendición", "Qué pasa si te vas a mitad"],
  ].map(([t, s]) => `<div class="ni"><b>${t}</b><em>${s}</em></div>`).join("")}
</div>
<div class="notin-foot">
  <b>These systems will be developed in later phases.</b>
  <span>Ninguno de ellos está implementado hoy, y este documento no los da por decididos.
  La química y las recompensas aparecen en el documento de diseño original y se abordarán
  con su propia fase.</span>
</div>
${foot(PAGE + 1)}`);

// ── 32 · Cierre ───────────────────────────────────────────────────────────
slide(`
<div class="closing">
  <div class="cover-glow"></div>
  <span class="reveal-kicker">The next step</span>
  <h1 class="close-h">FASE 8</h1>
  <p class="close-sub">GAMEPLAY EXPERIENCE</p>
  <p class="close-tag">&ldquo;Turning the duel engine into a playable experience.&rdquo;</p>
  <div class="close-cards">${[byNick["Alfajer"], byNick["Kachoww"], byNick["aspas"], byNick["Neon"], byNick["trexx"]].map((c) => card(c, "sm", { stats: false })).join("")}</div>
  <div class="cover-meta"><span>NEXUS VALORANT CARDS</span><span class="dot"></span><span>PRODUCT PREVIEW 2026</span></div>
</div>`, { cls: "is-closing" });

// ═══════════════════════════════ CSS ═══════════════════════════════

const CSS = `
@page { size: 1280px 720px; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #06070d; }
::-webkit-scrollbar { width: 0; height: 0; }
body {
  font-family: Barlow, "Segoe UI", system-ui, sans-serif;
  color: #eef1f8; -webkit-font-smoothing: antialiased;
  print-color-adjust: exact; -webkit-print-color-adjust: exact;
}
.slide {
  position: relative; width: 1280px; height: 720px; overflow: hidden;
  padding: 44px 58px 64px; break-after: page; page-break-after: always;
  background:
    radial-gradient(1200px 600px at 50% -12%, rgba(255,46,99,.13), transparent 60%),
    radial-gradient(900px 500px at 92% 8%, rgba(25,227,255,.08), transparent 55%),
    #06070d;
  display: flex; flex-direction: column;
}
.slide::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background-image: linear-gradient(rgba(255,255,255,.028) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(255,255,255,.028) 1px, transparent 1px);
  background-size: 36px 36px;
}
.slide > * { position: relative; }
.slide:last-child { break-after: auto; page-break-after: auto; }

h1,h2,h3,h4,.disp,.dcard-ovr,.dcard-name,.sb-num { font-family: Rajdhani, "Segoe UI", sans-serif; letter-spacing: .01em; }

/* ── cabecera y pie de diapositiva ── */
.s-head { flex: 0 0 auto; margin-bottom: 22px; }
.kicker { font-size: 11px; font-weight: 600; letter-spacing: .22em; text-transform: uppercase; color: #ff2e63; }
.s-head h2 { font-size: 44px; font-weight: 700; line-height: 1.02; margin-top: 6px; letter-spacing: -.005em; }
.s-sub { font-size: 14px; color: #8b93a7; margin-top: 6px; }
.s-foot {
  position: absolute; left: 58px; right: 58px; bottom: 20px;
  display: flex; justify-content: space-between; align-items: center;
  font-size: 9.5px; letter-spacing: .18em; text-transform: uppercase; color: #565e73;
  border-top: 1px solid rgba(255,255,255,.07); padding-top: 10px;
}
.s-foot .pg { font-family: Rajdhani, sans-serif; font-size: 14px; font-weight: 700; color: #8b93a7; letter-spacing: .06em; }

/* ── carta ── */
.dcard { width: var(--cw); flex: 0 0 auto; }
.dcard-in {
  position: relative; width: 100%; aspect-ratio: 5/7; border-radius: 10px; overflow: hidden;
  border: 2px solid var(--cp); background: var(--cbg); color: var(--ctx);
  box-shadow: 0 10px 24px -10px rgba(0,0,0,.8);
}
.dcard.glow .dcard-in { box-shadow: 0 0 0 2px rgba(255,255,255,.15), 0 0 34px rgba(255,46,99,.5), 0 12px 30px -8px #000; }
.dcard.sel .dcard-in { outline: 2px solid #ff2e63; outline-offset: 2px; }
.dcard.dim { opacity: .38; }
.dcard.spent .dcard-in { filter: grayscale(.85) brightness(.6); }
.dcard-art { position: absolute; left: 6%; right: 6%; top: 6%; bottom: 30%; }
.dcard-art svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.dcard-ini { position: absolute; left: 0; right: 0; top: 22%; text-align: center; font-family: Rajdhani, sans-serif; font-weight: 700; opacity: .9; }
.dcard-fade { position: absolute; inset-inline: 0; bottom: 0; height: 48%;
  background: linear-gradient(to top, rgba(0,0,0,.68), rgba(0,0,0,.18) 55%, transparent); }
.dcard-tl { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px 5px; }
.dcard-ovr { font-family: Rajdhani, sans-serif; font-weight: 700; line-height: .9; }
.dcard-role { font-family: Rajdhani, sans-serif; font-size: 7px; font-weight: 700; letter-spacing: .1em; opacity: .85; }
.dcard-flag { font-size: 6.5px; font-weight: 700; letter-spacing: .06em; opacity: .75; border: 1px solid currentColor; border-radius: 2px; padding: 0 2px; }
.dcard-team { font-family: Rajdhani, sans-serif; font-size: 7px; font-weight: 700; color: #fff; border-radius: 3px; padding: 1px 3px; box-shadow: 0 0 0 1px rgba(255,255,255,.25); }
.dcard-badge { position: absolute; right: 4px; top: 4px; font-size: 7px; font-weight: 700; letter-spacing: .08em;
  background: #ff2e63; color: #fff; border-radius: 3px; padding: 2px 4px; }
.dcard-veil { position: absolute; inset: 0; display: grid; place-items: center; font-family: Rajdhani, sans-serif;
  font-size: 10px; font-weight: 700; letter-spacing: .18em; color: rgba(255,255,255,.8); background: rgba(6,7,13,.5); }
.dcard-bl { position: absolute; inset-inline: 0; bottom: 0; padding: 6px 6px 5px; }
.dcard-rule { height: 1px; background: currentColor; opacity: .4; margin-bottom: 3px; }
.dcard-bl .dcard-name { text-align: center; font-weight: 700; text-transform: uppercase; color: #fff; line-height: 1;
  text-shadow: 0 1px 6px rgba(0,0,0,.7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dcard-bl .dcard-var { text-align: center; font-size: 6px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: rgba(255,255,255,.8); margin-top: 1px; }
.dcard-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; margin-top: 4px; }
.dcard-stat { display: flex; align-items: baseline; justify-content: center; gap: 2px; }
.dcard-stat i { font-style: normal; font-size: 6.5px; font-weight: 800; letter-spacing: .04em; }
.dcard-stat b { font-family: Rajdhani, sans-serif; font-size: 10px; font-weight: 700; color: #fff; }

/* ── portada ── */
.is-cover, .is-closing, .is-reveal, .is-score { padding: 0; }
.cover { position: relative; width: 100%; height: 100%; display: grid; grid-template-columns: 1.05fr .95fr; align-items: center; padding: 0 68px; }
.cover-glow { position: absolute; inset: 0; background:
  radial-gradient(680px 480px at 26% 50%, rgba(255,46,99,.30), transparent 62%),
  radial-gradient(560px 420px at 82% 34%, rgba(25,227,255,.16), transparent 60%); }
.cover-txt { position: relative; }
.cover-mark { display: inline-flex; align-items: center; gap: 10px; font-family: Rajdhani, sans-serif; font-size: 20px; font-weight: 700; letter-spacing: .34em; color: #fff; }
.brand-mark { width: 12px; height: 12px; background: #ff2e63; border-radius: 3px; box-shadow: 0 0 16px #ff2e63; display: inline-block; }
.brand-mark.big { width: 16px; height: 16px; }
.cover h1 { font-size: 94px; font-weight: 700; line-height: .88; margin-top: 22px; letter-spacing: -.02em; }
.cover h1 em { font-style: normal; color: #ff2e63; text-shadow: 0 0 40px rgba(255,46,99,.55); }
.cover-sub { font-family: Rajdhani, sans-serif; font-size: 30px; font-weight: 600; letter-spacing: .36em; color: #19e3ff; margin-top: 18px; }
.cover-tag { font-size: 17px; color: #b9c0d0; margin-top: 22px; font-style: italic; }
.cover-meta { display: flex; align-items: center; gap: 14px; margin-top: 40px; font-size: 11px; font-weight: 700; letter-spacing: .28em; color: #7d859a; }
.cover-meta .dot { width: 4px; height: 4px; border-radius: 50%; background: #ff2e63; }
.cover-cards { position: relative; display: flex; justify-content: center; align-items: center; }
.cover-cards .dcard:nth-child(1) { transform: rotate(-12deg) translateX(24px) translateY(18px); z-index: 1; }
.cover-cards .dcard:nth-child(2) { z-index: 3; transform: translateY(-14px); }
.cover-cards .dcard:nth-child(3) { transform: rotate(12deg) translateX(-24px) translateY(18px); z-index: 2; }

/* ── índice ── */
.idx-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 40px; margin-top: 8px; }
.idx-item { display: flex; gap: 16px; align-items: flex-start; padding: 14px 0; border-top: 1px solid rgba(255,255,255,.08); }
.idx-n { font-family: Rajdhani, sans-serif; font-size: 22px; font-weight: 700; color: #ff2e63; line-height: 1; width: 30px; }
.idx-item h3 { font-size: 20px; font-weight: 600; }
.idx-item p { font-size: 12.5px; color: #8b93a7; margin-top: 2px; }

/* ── dos columnas ── */
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 46px; flex: 1; min-height: 0; align-items: center; }
/* Los paneles que son cajas completas sí ocupan todo el alto. */
.two.vsdeck, .two.ties, .two.fair, .two.turnres { align-items: stretch; }
.lead { font-size: 17px; line-height: 1.5; color: #dfe3ec; }
.lead b { color: #fff; }
.two p { font-size: 13.5px; color: #99a1b4; line-height: 1.55; }
.two p + p { margin-top: 10px; }
.cap { font-size: 11.5px; color: #7d859a; line-height: 1.5; margin-top: 10px; }
.cap.center { text-align: center; }
.cap b { color: #c3c9d6; }
.mini-h { font-size: 12px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: #ff2e63; margin-bottom: 12px; }

.pillars { display: flex; flex-direction: column; gap: 10px; margin-top: 22px; }
.pillar { border-left: 2px solid #ff2e63; padding: 8px 0 8px 14px; }
.pillar h4 { font-size: 17px; font-weight: 600; }
.pillar p { font-size: 12.5px; color: #8b93a7; margin-top: 2px; }
.col-art { display: flex; flex-direction: column; gap: 16px; }
.quote-card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09); border-radius: 6px; padding: 18px 20px; }
.quote-card p { font-size: 15px; line-height: 1.5; color: #e7eaf2; font-style: italic; }
.quote-card span { display: block; margin-top: 10px; font-size: 10px; letter-spacing: .2em; text-transform: uppercase; color: #ff2e63; }
.mini-duel { display: flex; align-items: center; justify-content: center; gap: 22px; }
.vs-mini { font-family: Rajdhani, sans-serif; font-size: 24px; font-weight: 700; color: #ff2e63; }

/* ── journey ── */
.journey { display: flex; align-items: stretch; justify-content: space-between; gap: 4px; flex: 1; min-height: 0; align-items: center; }
.jstep { flex: 1; text-align: center; padding: 20px 8px; border: 1px solid rgba(255,255,255,.09); border-radius: 6px; background: rgba(255,255,255,.03); }
.jstep.hero { border-color: rgba(255,46,99,.55); background: linear-gradient(180deg, rgba(255,46,99,.16), rgba(255,46,99,.03)); box-shadow: 0 0 34px rgba(255,46,99,.2); }
.jicon { display: block; font-size: 26px; color: #19e3ff; margin-bottom: 10px; }
.jstep.hero .jicon { color: #ff5c8a; }
.jstep h4 { font-size: 16px; font-weight: 600; }
.jstep p { font-size: 10.5px; color: #8b93a7; margin-top: 4px; line-height: 1.4; }
.jarrow { align-self: center; font-size: 22px; color: #3d4457; }
.journey-note { font-size: 13.5px; color: #99a1b4; margin-top: 22px; text-align: center; }
.journey-note b { color: #fff; }

/* ── anatomía ── */
.anatomy { display: grid; grid-template-columns: 286px 1fr; gap: 48px; flex: 1; min-height: 0; align-items: center; }
.anat-card { display: flex; flex-direction: column; align-items: center; }
.anat-row { display: flex; gap: 14px; padding: 9px 0; border-top: 1px solid rgba(255,255,255,.07); }
.anat-n { font-family: Rajdhani, sans-serif; font-size: 14px; font-weight: 700; color: #ff2e63; width: 22px; padding-top: 2px; }
.anat-row h4 { font-size: 15px; font-weight: 600; }
.anat-row p { font-size: 12px; color: #8b93a7; margin-top: 1px; line-height: 1.45; }
.anat-row p b { color: #dfe3ec; }
.warn { margin-top: 14px; font-size: 12px; color: #99a1b4; background: rgba(25,227,255,.07); border-left: 2px solid #19e3ff; padding: 10px 14px; border-radius: 0 4px 4px 0; line-height: 1.5; }
.warn b { color: #cdeef7; }

/* ── stats ── */
.stats3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; flex: 1; min-height: 0; }
.stat-card { border: 1px solid rgba(255,255,255,.1); border-top: 3px solid var(--c); border-radius: 6px; padding: 18px 20px; background: rgba(255,255,255,.03); }
.stat-abbr { font-family: Rajdhani, sans-serif; font-size: 34px; font-weight: 700; color: var(--c); line-height: 1; }
.stat-card h3 { font-size: 22px; font-weight: 600; margin-top: 2px; }
.stat-t { font-size: 13px; color: #dfe3ec; margin-top: 8px; font-weight: 500; }
.stat-s { font-size: 11.5px; color: #8b93a7; margin-top: 4px; line-height: 1.45; }
.stat-bars { margin-top: 16px; display: flex; flex-direction: column; gap: 5px; }
.sbar { display: grid; grid-template-columns: 62px 1fr 24px; align-items: center; gap: 8px; }
.sbar span { font-size: 9.5px; color: #8b93a7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sbar i { height: 5px; border-radius: 3px; background: var(--c); display: block; }
.sbar b { font-family: Rajdhani, sans-serif; font-size: 12px; font-weight: 700; text-align: right; }

/* ── matchup ── */
.matchup .mtable { margin-top: 22px; display: flex; flex-direction: column; gap: 12px; }
.mrow { display: flex; align-items: center; gap: 16px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09); border-radius: 6px; padding: 14px 18px; }
.mstat { flex: 1; font-family: Rajdhani, sans-serif; font-size: 20px; font-weight: 700; color: var(--c); letter-spacing: .04em; }
.mrow .mstat:last-child { text-align: right; }
.mlink { font-size: 22px; color: #ff2e63; }
.mex h4 { font-size: 13px; letter-spacing: .16em; text-transform: uppercase; color: #ff2e63; margin-bottom: 14px; }
.mex-row { display: flex; flex-direction: column; padding: 11px 0; border-top: 1px solid rgba(255,255,255,.07); }
.mex-row b { font-size: 15px; font-weight: 600; }
.mex-row span { font-size: 12.5px; color: #8b93a7; margin-top: 2px; }
.mex-note { margin-top: 16px; background: rgba(255,46,99,.09); border-left: 2px solid #ff2e63; padding: 12px 16px; border-radius: 0 4px 4px 0; }
.mex-note p { font-size: 13px; color: #d6dae5; line-height: 1.5; }

/* ── mazo ── */
.deck-view { display: grid; grid-template-columns: 1fr 268px; gap: 36px; flex: 1; min-height: 0; }
.deck-cards { display: grid; grid-template-columns: repeat(5, 92px); gap: 16px; align-content: center; }
.deck-side { border-left: 1px solid rgba(255,255,255,.09); padding-left: 26px; }
.dstat { display: flex; justify-content: space-between; align-items: baseline; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.07); }
.dstat span { font-size: 11.5px; color: #8b93a7; }
.dstat b { font-family: Rajdhani, sans-serif; font-size: 19px; font-weight: 700; }
.dstat.ok b { color: #37e6a0; font-size: 14px; letter-spacing: .06em; }
.deck-side h4 { font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: #ff2e63; margin: 18px 0 8px; }
.drole { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center; padding: 5px 0; font-size: 12px; color: #b9c0d0; }
.drole i { font-style: normal; color: #37e6a0; font-size: 9px; letter-spacing: 2px; }
.drole b { font-family: Rajdhani, sans-serif; font-size: 13px; }
.dcov { display: grid; grid-template-columns: 22px 1fr; gap: 8px; align-items: center; margin-bottom: 8px; }
.dcov span { font-size: 11px; font-weight: 800; }
.dcov i { display: block; height: 6px; background: rgba(255,255,255,.09); border-radius: 3px; overflow: hidden; }
.dcov i b { display: block; height: 100%; border-radius: 3px; }
.dcov em { grid-column: 2; font-size: 9.5px; color: #6f778b; font-style: normal; }

/* ── válido/inválido ── */
.vsdeck { gap: 34px; }
.deckbox { border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 20px 22px; background: rgba(255,255,255,.03); display: flex; flex-direction: column; }
.deckbox.ok { border-color: rgba(55,230,160,.35); }
.deckbox.bad { border-color: rgba(255,46,99,.35); }
.dbh { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.dbh h3 { font-size: 22px; font-weight: 600; flex: 1; }
.dbh b { font-family: Rajdhani, sans-serif; font-size: 11px; letter-spacing: .14em; }
.deckbox.ok .dbh b { color: #37e6a0; }
.deckbox.bad .dbh b { color: #ff2e63; }
.tick { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 14px; font-weight: 700; }
.tick.ok { background: rgba(55,230,160,.16); color: #37e6a0; }
.tick.bad { background: rgba(255,46,99,.16); color: #ff2e63; }
.mini-grid { display: grid; grid-template-columns: repeat(5, 68px); gap: 10px; margin-bottom: 16px; }
.dlist { list-style: none; display: flex; flex-direction: column; gap: 7px; }
.dlist li { font-size: 12.5px; color: #b9c0d0; padding-left: 18px; position: relative; line-height: 1.4; }
.dlist li::before { content: "✓"; position: absolute; left: 0; color: #37e6a0; font-size: 11px; }
.dlist.err li::before { content: "✕"; color: #ff2e63; }
.rolecount { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.rc { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-radius: 4px; background: rgba(255,255,255,.04); font-size: 12.5px; color: #b9c0d0; }
.rc b { font-family: Rajdhani, sans-serif; font-size: 14px; color: #37e6a0; }
.rc.err { background: rgba(255,46,99,.1); }
.rc.err b { color: #ff2e63; }

/* ── mockups ── */
.mock2 { display: grid; grid-template-columns: 300px 1fr; gap: 52px; flex: 1; min-height: 0; align-items: center; }
.mock2.big { grid-template-columns: 300px 1fr; }
.mock2.wide-left { grid-template-columns: 300px 1fr; }
.steps2 { display: grid; grid-template-columns: 300px 1fr; gap: 52px; flex: 1; min-height: 0; align-items: center; }
.mock-notes h3, .step-notes h3 { font-size: 26px; font-weight: 600; margin-bottom: 10px; }
.mock-notes > p, .step-notes > p { font-size: 13.5px; color: #99a1b4; line-height: 1.55; }
.mock-notes b, .step-notes b { color: #fff; }
.note-list { display: flex; flex-direction: column; gap: 0; margin-top: 16px; }
.note-list > div { display: grid; grid-template-columns: 192px 1fr; gap: 14px; padding: 9px 0; border-top: 1px solid rgba(255,255,255,.07); align-items: baseline; }
.note-list b { font-size: 13.5px; font-weight: 600; }
.note-list span { font-size: 12px; color: #8b93a7; line-height: 1.45; }
.tbd-line { margin-top: 16px; font-size: 12px; color: #7d859a; }
.tbd { display: inline-block; font-size: 9.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
  color: #ffd35c; border: 1px solid rgba(255,211,92,.45); background: rgba(255,211,92,.1); border-radius: 3px; padding: 1px 6px; }
.step-notes { position: relative; }
.step-n { font-family: Rajdhani, sans-serif; font-size: 66px; font-weight: 700; color: rgba(255,46,99,.22); line-height: .8; display: block; margin-bottom: 6px; }
.tip { margin-top: 18px; border: 1px solid rgba(25,227,255,.28); background: rgba(25,227,255,.06); border-radius: 6px; padding: 14px 18px; }
.tip b { display: block; font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: #19e3ff; margin-bottom: 6px; }
.tip p { font-size: 13px; color: #d3d9e6; line-height: 1.5; }

/* ── teléfono ── */
.phone { width: var(--pw); height: var(--ph); border-radius: 30px; padding: 7px; background: linear-gradient(160deg,#222635,#0d0f18);
  box-shadow: 0 26px 60px -18px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.07); }
.phone-screen { width: 100%; height: 100%; border-radius: 24px; overflow: hidden; background:
  radial-gradient(500px 260px at 50% -8%, rgba(255,46,99,.16), transparent 60%), #06070d;
  display: flex; flex-direction: column; }
.phone-status { display: flex; justify-content: space-between; padding: 5px 14px 1px; font-size: 8px; color: #7d859a; font-weight: 600; }
.phone-top { display: flex; justify-content: space-between; align-items: center; padding: 5px 14px 6px; border-bottom: 1px solid rgba(255,255,255,.07); }
.brand { display: inline-flex; align-items: center; gap: 6px; font-family: Rajdhani, sans-serif; font-size: 12px; font-weight: 700; letter-spacing: .2em; }
.brand .brand-mark { width: 7px; height: 7px; box-shadow: 0 0 8px #ff2e63; }
.orbs { font-size: 9.5px; font-weight: 600; color: #ffd35c; }
.phone-body { flex: 1; min-height: 0; padding: 9px 10px; display: flex; flex-direction: column; gap: 7px; overflow: hidden; }
.phone-nav { display: flex; justify-content: space-around; padding: 5px 4px 7px; border-top: 1px solid rgba(255,255,255,.07); background: rgba(11,13,24,.9); }
.phone-nav span { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 7px; color: #565e73; font-weight: 600; }
.phone-nav span i { font-style: normal; font-size: 13px; }
.phone-nav span.on { color: #ff2e63; }
.phone-label { text-align: center; font-size: 10px; color: #6f778b; margin-top: 10px; letter-spacing: .1em; text-transform: uppercase; }

.p-hero { border: 1px solid rgba(255,46,99,.4); border-radius: 8px; padding: 14px; background: linear-gradient(155deg, rgba(255,46,99,.2), rgba(255,46,99,.03)); }
.p-eyebrow { font-size: 7.5px; letter-spacing: .2em; color: #ff9ab6; font-weight: 700; }
.p-h1 { font-size: 30px; font-weight: 700; line-height: 1; margin-top: 3px; }
.p-sub { font-size: 9.5px; color: #b9c0d0; margin-top: 5px; line-height: 1.4; }
.p-cta { display: block; width: 100%; margin-top: 11px; padding: 9px; border: 0; border-radius: 6px; background: #ff2e63; color: #fff;
  font-family: Rajdhani, sans-serif; font-size: 13px; font-weight: 700; letter-spacing: .16em; box-shadow: 0 0 20px rgba(255,46,99,.45); }
.p-cta.ghost { background: transparent; border: 1px dashed rgba(255,255,255,.25); color: #8b93a7; box-shadow: none; }
.p-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.p-tile { border: 1px solid rgba(255,255,255,.1); border-radius: 6px; padding: 10px; background: rgba(255,255,255,.03); }
.p-tile i { font-style: normal; font-size: 14px; color: #19e3ff; display: block; }
.p-tile span { display: block; font-size: 10px; font-weight: 600; margin-top: 4px; }
.p-tile em { font-style: normal; font-size: 8px; color: #7d859a; }
.p-sect { font-size: 7.5px; letter-spacing: .2em; text-transform: uppercase; color: #565e73; font-weight: 700; margin-top: 2px; }
.p-list { display: flex; flex-direction: column; gap: 6px; }
.p-li { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border-radius: 6px; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.07); }
.p-li i { font-style: normal; font-size: 13px; color: #19e3ff; }
.p-li span { flex: 1; font-size: 10px; font-weight: 600; }
.p-li em { font-style: normal; font-size: 8.5px; color: #7d859a; }
.p-li.muted { opacity: .55; }
.p-title { font-family: Rajdhani, sans-serif; font-size: 13px; font-weight: 700; letter-spacing: .16em; display: flex; justify-content: space-between; align-items: baseline; }
.p-title em { font-style: normal; font-size: 9px; color: #7d859a; letter-spacing: .06em; }
.p-deck { border: 1px solid rgba(255,255,255,.1); border-radius: 6px; padding: 9px 10px; background: rgba(255,255,255,.03); }
.p-deck.bad { border-color: rgba(255,46,99,.3); }
.p-deck-h { display: flex; justify-content: space-between; align-items: center; }
.p-deck-h b { font-size: 11px; font-weight: 600; }
.p-pill { font-size: 7px; font-weight: 700; letter-spacing: .1em; padding: 2px 6px; border-radius: 99px; background: rgba(255,255,255,.08); color: #b9c0d0; }
.p-pill.ok { background: rgba(55,230,160,.16); color: #37e6a0; }
.p-pill.bad { background: rgba(255,46,99,.16); color: #ff2e63; }
.p-deck-cards { display: flex; gap: 4px; margin: 7px 0; }
.p-deck-f { display: flex; justify-content: space-between; font-size: 8px; color: #7d859a; }
.p-deck-f b { color: #b9c0d0; }
.p-slots { display: flex; flex-direction: column; gap: 4px; }
.p-slot { display: grid; grid-template-columns: 58px 1fr 24px; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 5px; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.07); }
.p-slot.need { border-color: rgba(255,46,99,.35); background: rgba(255,46,99,.07); }
.p-slot-r { font-size: 8.5px; color: #b9c0d0; font-weight: 600; }
.p-slot-c { display: flex; gap: 4px; }
.p-empty { width: 30px; height: 42px; border-radius: 6px; border: 1px dashed rgba(255,255,255,.2); display: grid; place-items: center; color: #565e73; font-size: 14px; }
.p-slot b { font-family: Rajdhani, sans-serif; font-size: 11px; text-align: right; }
.p-slot b.ok { color: #37e6a0; } .p-slot b.need { color: #ff2e63; }
.p-picker { border-top: 1px solid rgba(255,255,255,.09); padding-top: 8px; margin-top: 2px; }
.p-picker-h { font-size: 8px; letter-spacing: .16em; color: #565e73; font-weight: 700; display: flex; justify-content: space-between; }
.p-picker-c { display: flex; gap: 6px; margin-top: 7px; }
.p-prep { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.p-prep-side { width: 100%; border: 1px solid rgba(255,255,255,.1); border-radius: 6px; padding: 9px 10px; background: rgba(255,255,255,.03); }
.p-prep-side.rival { border-color: rgba(255,46,99,.28); }
.p-prep-h { display: flex; align-items: baseline; gap: 8px; }
.p-prep-lab { font-size: 7px; letter-spacing: .16em; color: #ff2e63; font-weight: 700; }
.p-prep-h b { flex: 1; font-size: 10.5px; }
.p-prep-h em { font-style: normal; font-size: 8px; color: #7d859a; }
.p-prep-cards { display: flex; gap: 4px; margin-top: 7px; }
.p-prep-vs { font-family: Rajdhani, sans-serif; font-size: 15px; font-weight: 700; color: #ff2e63; }
.p-first { border: 1px solid rgba(255,255,255,.1); border-radius: 6px; padding: 9px 11px; background: rgba(255,255,255,.03); }
.p-first > span { font-size: 7.5px; letter-spacing: .18em; color: #565e73; font-weight: 700; }
.p-first-opts { display: flex; gap: 6px; margin: 6px 0 4px; }
.p-first-opts b { flex: 1; text-align: center; font-family: Rajdhani, sans-serif; font-size: 11px; padding: 5px; border-radius: 5px; background: rgba(255,255,255,.05); color: #8b93a7; letter-spacing: .1em; }
.p-first-opts b.on { background: #ff2e63; color: #fff; }
.p-first em { font-style: normal; font-size: 8px; color: #7d859a; }
.p-score { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; padding: 9px 10px; border-radius: 8px;
  background: linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.02)); border: 1px solid rgba(255,255,255,.1); }
.p-score.compact { padding: 7px 10px; }
.ps-side { display: flex; align-items: center; gap: 7px; }
.ps-side.bot { justify-content: flex-end; }
.ps-side span { font-size: 8px; letter-spacing: .14em; color: #8b93a7; font-weight: 700; }
.ps-side b { font-family: Rajdhani, sans-serif; font-size: 26px; font-weight: 700; line-height: 1; }
.ps-side.you b { color: #37e6a0; } .ps-side.bot b { color: #ff2e63; }
.ps-mid { text-align: center; }
.ps-mid span { font-size: 6.5px; letter-spacing: .18em; color: #565e73; display: block; }
.ps-mid b { font-family: Rajdhani, sans-serif; font-size: 13px; }
.ps-mid em { display: block; font-style: normal; font-size: 7px; color: #ff2e63; letter-spacing: .1em; font-weight: 700; }
.p-track { display: flex; gap: 3px; }
.p-track i, .sb-track i { flex: 1; height: 5px; border-radius: 2px; background: rgba(255,255,255,.1); }
.p-track i.tA, .sb-track i.tA { background: #37e6a0; }
.p-track i.tB, .sb-track i.tB { background: #ff2e63; }
.p-track i.tTIE, .sb-track i.tTIE { background: #7d859a; }
.p-track i.now { background: #19e3ff; box-shadow: 0 0 8px #19e3ff; }
.p-field { flex: 1; display: flex; flex-direction: column; gap: 5px; min-height: 0; }
.p-field-lab { font-size: 7px; letter-spacing: .18em; color: #565e73; font-weight: 700; }
.p-hand { display: flex; gap: 5px; }
.p-hand.rival { gap: 4px; }
.p-hand.pick { gap: 10px; justify-content: center; margin: 4px 0; }
.p-center { flex: 1; min-height: 74px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px dashed rgba(255,255,255,.14); border-radius: 8px; margin: 3px 0; }
.p-await { font-size: 9px; color: #7d859a; text-align: center; padding: 8px 20px 0; line-height: 1.4; }
.p-slots2 { display: flex; align-items: center; justify-content: center; gap: 12px; }
.p-ghost { width: 52px; height: 72.8px; border-radius: 6px; border: 1px dashed rgba(255,255,255,.18);
  display: grid; place-items: center; font-size: 6.5px; letter-spacing: .1em; color: #4b5266; text-align: center; }
.p-slots2 b { font-family: Rajdhani, sans-serif; font-size: 13px; color: #ff2e63; }
.ha-back { width: 44px; height: 61.6px; border-radius: 6px; background: linear-gradient(155deg,#1b2030,#0c0e18);
  border: 1px solid rgba(255,46,99,.3); display: inline-block; position: relative; }
.ha-back::after { content: ""; position: absolute; inset: 6px; border: 1px solid rgba(255,46,99,.25); border-radius: 3px; }
.ha-back.sm { width: 34px; height: 47.6px; }
.ha-back.xs { width: 28px; height: 39.2px; }
.ha-back.md { width: 92px; height: 128.8px; }
.p-more { display: grid; place-items: center; font-family: Rajdhani, sans-serif; font-size: 10px; font-weight: 700;
  color: #7d859a; border: 1px dashed rgba(255,255,255,.2); border-radius: 4px; width: 26px; align-self: stretch; }
.p-more.tall { width: 30px; font-size: 11px; }
.p-more.xs { width: 20px; font-size: 8px; }
.p-stepbar { display: flex; gap: 4px; }
.p-stepbar b { flex: 1; text-align: center; font-size: 7px; letter-spacing: .1em; font-weight: 700; padding: 5px 2px; border-radius: 4px; background: rgba(255,255,255,.05); color: #565e73; }
.p-stepbar b.on { background: rgba(255,46,99,.2); color: #ff9ab6; }
.p-picked { border: 1px solid rgba(255,46,99,.35); border-radius: 6px; padding: 9px 11px; background: rgba(255,46,99,.08); text-align: center; }
.p-picked span { font-size: 7px; letter-spacing: .18em; color: #ff9ab6; font-weight: 700; }
.p-picked b { display: block; font-family: Rajdhani, sans-serif; font-size: 17px; font-weight: 700; }
.p-picked em { font-style: normal; font-size: 8.5px; color: #8b93a7; }
.p-declare { display: grid; grid-template-columns: 92px 1fr; gap: 12px; align-items: center; margin: auto 0; }
.p-declare-opts { display: flex; flex-direction: column; gap: 6px; }
.p-stat { display: grid; grid-template-columns: 22px 1fr; gap: 6px; align-items: baseline; text-align: left; padding: 7px 9px; border-radius: 5px;
  border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.03); color: #eef1f8; }
.p-stat.on { border-color: var(--c); background: color-mix(in srgb, var(--c) 16%, transparent); }
.p-stat span { font-size: 9px; font-weight: 800; color: var(--c); }
.p-stat b { font-family: Rajdhani, sans-serif; font-size: 15px; font-weight: 700; }
.p-stat em { grid-column: 1 / -1; font-style: normal; font-size: 7.5px; color: #7d859a; }
.p-warnbox { border-left: 2px solid #19e3ff; background: rgba(25,227,255,.08); padding: 8px 11px; border-radius: 0 4px 4px 0; font-size: 9px; color: #cfe9f2; line-height: 1.45; }
.p-vs-stage { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center; margin: auto 0; }
.p-vs-you, .p-vs-rival { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.p-vs-lab { font-size: 7px; letter-spacing: .14em; color: #565e73; font-weight: 700; }
.p-vs-mid { font-family: Rajdhani, sans-serif; font-size: 15px; font-weight: 700; color: #ff2e63; }
.flip { position: relative; display: grid; place-items: center; }
.flip-q { position: absolute; font-family: Rajdhani, sans-serif; font-size: 30px; font-weight: 700; color: rgba(255,46,99,.55); }
.chip { display: inline-flex; align-items: baseline; gap: 4px; font-size: 8.5px; font-weight: 800; color: var(--c);
  border: 1px solid var(--c); border-radius: 4px; padding: 2px 6px; }
.chip b { font-family: Rajdhani, sans-serif; font-size: 12px; color: #fff; }
.chip.big { font-size: 10px; padding: 3px 9px; } .chip.big b { font-size: 15px; }
.chip.ghost { opacity: .55; }
.p-turnres { border-radius: 8px; padding: 12px; text-align: center; border: 1px solid rgba(55,230,160,.4); background: linear-gradient(180deg, rgba(55,230,160,.14), rgba(55,230,160,.02)); }
.p-tr-lab { font-size: 7px; letter-spacing: .2em; color: #8b93a7; font-weight: 700; }
.p-tr-verdict { display: block; font-family: Rajdhani, sans-serif; font-size: 19px; font-weight: 700; color: #37e6a0; margin-top: 2px; }
.p-tr-line { display: flex; align-items: center; justify-content: center; gap: 5px; margin-top: 8px; font-size: 8px; color: #b9c0d0; }
.p-tr-line i { font-style: normal; font-weight: 800; font-size: 8.5px; }
.p-tr-line em { font-style: normal; color: #565e73; }
.p-tr-score { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 8px; font-family: Rajdhani, sans-serif; font-size: 24px; font-weight: 700; }
.p-tr-score span { color: #565e73; font-size: 16px; }
.p-tr-next { margin-top: 8px; font-size: 8px; letter-spacing: .12em; color: #7d859a; font-weight: 700; }
.p-replay-head { display: flex; gap: 6px; }
.p-timeline { display: flex; gap: 3px; }
.p-timeline i { flex: 1; font-style: normal; font-size: 8px; font-weight: 700; text-align: center; padding: 4px 0; border-radius: 3px; background: rgba(255,255,255,.07); color: #7d859a; }
.p-timeline i.tA { background: rgba(55,230,160,.22); color: #37e6a0; }
.p-timeline i.tB { background: rgba(255,46,99,.2); color: #ff9ab6; }
.p-timeline i.tTIE { background: rgba(255,255,255,.12); color: #b9c0d0; }
.p-timeline i.cur { outline: 1px solid #19e3ff; }
.p-replay-card { border: 1px solid rgba(255,255,255,.1); border-radius: 7px; padding: 10px; background: rgba(255,255,255,.03); }
.p-rc-lab { font-size: 7px; letter-spacing: .16em; color: #565e73; font-weight: 700; }
.p-rc-duel { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; margin: 8px 0; }
.p-rc-mid { text-align: center; font-size: 9px; font-weight: 700; }
.p-rc-mid b { display: block; font-family: Rajdhani, sans-serif; font-size: 16px; color: #37e6a0; }
.p-rc-res { font-size: 8.5px; color: #37e6a0; font-weight: 700; letter-spacing: .06em; text-align: center; }
.p-controls { display: flex; justify-content: center; align-items: center; gap: 14px; padding-top: 4px; }
.p-controls i, .p-controls b { font-style: normal; font-size: 11px; color: #8b93a7; }
.p-controls b { font-size: 17px; color: #ff2e63; }

/* ── dificultad ── */
.diff { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; flex: 1; min-height: 0; }
.dcard-diff { border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 24px 24px 22px; background: rgba(255,255,255,.03); display: flex; flex-direction: column; }
.dcard-diff.lv1 { border-top: 3px solid #37e6a0; }
.dcard-diff.lv2 { border-top: 3px solid #ffd35c; }
.dcard-diff.lv3 { border-top: 3px solid #ff2e63; box-shadow: 0 0 40px rgba(255,46,99,.14); }
.diff-n { font-family: Rajdhani, sans-serif; font-size: 40px; font-weight: 700; line-height: 1; letter-spacing: .04em; }
.lv1 .diff-n { color: #37e6a0; } .lv2 .diff-n { color: #ffd35c; } .lv3 .diff-n { color: #ff2e63; }
.dcard-diff h3 { font-size: 21px; font-weight: 600; margin-top: 6px; }
.dcard-diff p { font-size: 13px; color: #99a1b4; margin-top: 10px; line-height: 1.55; }
.diff-how { list-style: none; margin-top: 18px; display: flex; flex-direction: column; gap: 9px; flex: 1; }
.diff-how li { font-size: 12.5px; color: #b9c0d0; padding-left: 18px; position: relative; line-height: 1.35; }
.diff-how li::before { content: ""; position: absolute; left: 0; top: .5em; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .5; }
.lv1 .diff-how li::before { background: #37e6a0; } .lv2 .diff-how li::before { background: #ffd35c; } .lv3 .diff-how li::before { background: #ff2e63; }
.diff-bars { display: flex; gap: 5px; margin-top: 18px; }
.diff-bars i { flex: 1; height: 5px; border-radius: 3px; background: rgba(255,255,255,.1); }
.lv1 .diff-bars i.on { background: #37e6a0; } .lv2 .diff-bars i.on { background: #ffd35c; } .lv3 .diff-bars i.on { background: #ff2e63; }
.fairbar { margin-top: 24px; border: 1px solid rgba(25,227,255,.3); background: rgba(25,227,255,.07); border-radius: 6px; padding: 16px 22px; display: flex; align-items: baseline; gap: 18px; }
.fairbar b { font-size: 17px; font-weight: 600; color: #9fe9f7; white-space: nowrap; }
.fairbar span { font-size: 13px; color: #99a1b4; }

/* ── información oculta ── */
.fair-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; }
.fcol h4 { font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: #ff2e63; margin-bottom: 12px; }
.ok-list, .no-list { list-style: none; display: flex; flex-direction: column; gap: 9px; }
.ok-list li, .no-list li { font-size: 13px; color: #b9c0d0; padding-left: 22px; position: relative; line-height: 1.4; }
.ok-list li::before { content: "◉"; position: absolute; left: 0; color: #37e6a0; }
.no-list li::before { content: "◌"; position: absolute; left: 0; color: #ff2e63; }
.fair-note { margin-top: 26px; border-left: 2px solid #ff2e63; background: rgba(255,46,99,.08); padding: 14px 18px; border-radius: 0 4px 4px 0; }
.fair-note p { font-size: 14px; color: #dfe3ec; line-height: 1.55; }
.hidden-art { display: flex; flex-direction: column; gap: 22px; justify-content: center; }
.ha-row { display: flex; align-items: center; gap: 8px; }
.ha-lab { font-size: 9px; letter-spacing: .16em; text-transform: uppercase; color: #565e73; font-weight: 700; width: 74px; }

/* ── diez turnos ── */
.ten { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; flex: 1; min-height: 0; align-content: center; }
.tn { border: 1px solid rgba(255,255,255,.1); border-radius: 6px; padding: 13px 13px; background: rgba(255,255,255,.03); }
.tn.w { border-left: 3px solid #37e6a0; } .tn.l { border-left: 3px solid #ff2e63; } .tn.t { border-left: 3px solid #7d859a; }
.tn-h { display: flex; justify-content: space-between; align-items: baseline; }
.tn-h span { font-family: Rajdhani, sans-serif; font-size: 11px; font-weight: 700; letter-spacing: .1em; }
.tn-h i { font-style: normal; font-size: 8px; color: #6f778b; }
.tn-body { display: grid; grid-template-columns: 1fr auto 1fr; gap: 6px; align-items: center; margin: 7px 0; }
.tn-p b { display: block; font-size: 10px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tn-p span { font-size: 9px; font-weight: 800; }
.tn-p.r { text-align: right; }
.tn-op { font-family: Rajdhani, sans-serif; font-size: 15px; font-weight: 700; color: #565e73; }
.tn-f { display: flex; justify-content: space-between; align-items: baseline; border-top: 1px solid rgba(255,255,255,.07); padding-top: 5px; }
.tn-res { font-size: 8px; font-weight: 700; letter-spacing: .1em; }
.tn.w .tn-res { color: #37e6a0; } .tn.l .tn-res { color: #ff2e63; } .tn.t .tn-res { color: #b9c0d0; }
.tn-f b { font-family: Rajdhani, sans-serif; font-size: 12px; }

/* ── marcador ── */
.scoreboard { position: relative; width: 100%; height: 100%; padding: 54px 68px 44px; display: flex; flex-direction: column; justify-content: center; }
.reveal-kicker { font-size: 11px; font-weight: 600; letter-spacing: .24em; text-transform: uppercase; color: #ff2e63; }
.sb-main { display: grid; grid-template-columns: 1fr 400px 1fr; align-items: center; gap: 30px; margin-top: 26px; }
.sb-side { text-align: center; border-radius: 10px; padding: 26px 20px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.03); }
.sb-side.you { border-color: rgba(55,230,160,.4); background: linear-gradient(180deg, rgba(55,230,160,.12), transparent); }
.sb-side.bot { border-color: rgba(255,46,99,.4); background: linear-gradient(180deg, rgba(255,46,99,.12), transparent); }
.sb-lab { font-size: 12px; letter-spacing: .22em; font-weight: 700; color: #8b93a7; }
.sb-num { display: block; font-size: 128px; font-weight: 700; line-height: .86; margin: 6px 0; }
.sb-side.you .sb-num { color: #37e6a0; text-shadow: 0 0 46px rgba(55,230,160,.45); }
.sb-side.bot .sb-num { color: #ff2e63; text-shadow: 0 0 46px rgba(255,46,99,.45); }
.sb-deck { font-size: 12px; color: #7d859a; }
.sb-mid { text-align: center; }
.sb-vs { font-family: Rajdhani, sans-serif; font-size: 34px; font-weight: 700; color: #565e73; letter-spacing: .1em; }
.sb-turn { font-family: Rajdhani, sans-serif; font-size: 22px; font-weight: 700; letter-spacing: .14em; margin-top: 4px; }
.sb-track { display: flex; gap: 5px; margin-top: 18px; }
.sb-track i { height: 9px; border-radius: 3px; }
.sb-legend { display: flex; justify-content: center; gap: 16px; margin-top: 12px; }
.sb-legend span { display: inline-flex; align-items: center; gap: 5px; font-size: 9.5px; color: #7d859a; }
.sb-legend i { width: 10px; height: 6px; border-radius: 2px; background: rgba(255,255,255,.1); display: inline-block; }
.sb-foot { display: flex; justify-content: center; gap: 60px; margin-top: 42px; }
.sb-foot div { text-align: center; }
.sb-foot span { display: block; font-size: 10px; letter-spacing: .16em; text-transform: uppercase; color: #565e73; }
.sb-foot b { font-family: Rajdhani, sans-serif; font-size: 24px; font-weight: 700; }

/* ── revelación ── */
.reveal { position: relative; width: 100%; height: 100%; padding: 50px 68px 44px; display: flex; flex-direction: column; }
.reveal::after { content: ""; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(620px 420px at 50% 52%, rgba(255,46,99,.18), transparent 65%); }
.reveal-stage { position: relative; z-index: 1; flex: 1; display: grid; grid-template-columns: 1fr 300px 1fr; align-items: center; justify-items: center; gap: 20px; }
.reveal-side { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.reveal-side.lose { opacity: .78; }
.reveal-val { text-align: center; }
.reveal-val span { display: block; font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: var(--c); font-weight: 700; }
.reveal-val b { font-family: Rajdhani, sans-serif; font-size: 74px; font-weight: 700; line-height: .9; color: #fff; }
.reveal-side.win .reveal-val b { text-shadow: 0 0 40px rgba(255,255,255,.35); }
.reveal-owner { font-size: 11px; letter-spacing: .24em; color: #7d859a; font-weight: 700; }
.reveal-mid { text-align: center; }
.reveal-vs { font-family: Rajdhani, sans-serif; font-size: 30px; font-weight: 700; color: #565e73; letter-spacing: .12em; }
.reveal-verdict { margin: 18px 0; border: 1px solid rgba(55,230,160,.5); background: rgba(55,230,160,.1); border-radius: 8px; padding: 18px 10px; }
.reveal-verdict span { font-size: 12px; letter-spacing: .2em; font-weight: 700; color: #37e6a0; }
.reveal-verdict b { display: block; font-family: Rajdhani, sans-serif; font-size: 52px; font-weight: 700; color: #37e6a0; line-height: 1; margin: 4px 0; }
.reveal-verdict em { font-style: normal; font-size: 13px; color: #b9c0d0; }
.reveal-turn { font-size: 11px; letter-spacing: .2em; color: #7d859a; font-weight: 700; }
.reveal-foot { position: relative; z-index: 1; text-align: center; font-size: 13.5px; color: #99a1b4; }

/* ── resultado del turno ── */
.outcomes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.oc { border-radius: 6px; padding: 13px 14px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.03); }
.oc.win { border-color: rgba(55,230,160,.4); } .oc.lose { border-color: rgba(255,46,99,.4); } .oc.tie { border-color: rgba(255,255,255,.2); }
.oc span { font-size: 10px; letter-spacing: .16em; font-weight: 700; }
.oc.win span { color: #37e6a0; } .oc.lose span { color: #ff2e63; } .oc.tie span { color: #b9c0d0; }
.oc b { display: block; font-family: Rajdhani, sans-serif; font-size: 24px; font-weight: 700; margin-top: 2px; }
.oc em { font-style: normal; font-size: 10.5px; color: #7d859a; }
.tiebox { margin-top: 20px; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; padding: 16px 18px; background: rgba(255,255,255,.03); }
.tiebox-lab { font-size: 10px; letter-spacing: .16em; font-weight: 700; color: #b9c0d0; }
.tiebox-row { display: flex; align-items: center; justify-content: center; gap: 24px; margin: 14px 0 12px; }
.tiebox-row > div { display: flex; flex-direction: column; align-items: center; gap: 7px; }
.eq { font-family: Rajdhani, sans-serif; font-size: 34px; font-weight: 700; color: #7d859a; }
.tiebox p { font-size: 12.5px; color: #99a1b4; line-height: 1.5; }
.afterturn { display: flex; flex-direction: column; }
.afterturn .phone { margin: 0 auto; }

/* ── flujo ── */
.flow { flex: 1; display: grid; grid-template-columns: 206px 26px 1fr 26px 206px; gap: 0; align-items: center; min-height: 0; }
.fjoin { text-align: center; font-size: 22px; color: #3d4457; }
.flow-pre, .flow-end { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.fbox { border: 1px solid rgba(255,255,255,.12); border-radius: 6px; padding: 18px 14px; background: rgba(255,255,255,.04); text-align: center; width: 100%; }
.fbox.pre { display: flex; align-items: center; gap: 10px; font-size: 13.5px; color: #b9c0d0; text-align: left; }
.fbox.pre span { font-family: Rajdhani, sans-serif; font-size: 12px; color: #ff2e63; font-weight: 700; }
.fbox.loop { width: auto; flex: 1; padding: 30px 10px; display: flex; flex-direction: column; justify-content: center; }
.fbox.loop b { display: block; font-size: 13px; font-weight: 600; }
.fbox.loop em { font-style: normal; font-size: 9.5px; color: #7d859a; }
.fbox.end { border-color: rgba(25,227,255,.4); background: rgba(25,227,255,.08); }
.fbox.final { border-color: rgba(255,46,99,.5); background: rgba(255,46,99,.12); }
.fbox.end b, .fbox.final b { display: block; font-family: Rajdhani, sans-serif; font-size: 15px; font-weight: 700; letter-spacing: .08em; }
.fbox.end em, .fbox.final em { font-style: normal; font-size: 10px; color: #99a1b4; }
.fdown { font-style: normal; color: #3d4457; font-size: 11px; }
.fright { font-style: normal; color: #3d4457; font-size: 20px; align-self: center; }
.flow-loop { border: 1px dashed rgba(255,46,99,.4); border-radius: 10px; padding: 24px 20px 20px; background: rgba(255,46,99,.05); }
.loop-head { text-align: center; font-size: 10.5px; letter-spacing: .2em; text-transform: uppercase; color: #ff9ab6; font-weight: 700; margin-bottom: 14px; }
.loop-steps { display: flex; align-items: stretch; gap: 4px; }
.loop-back { text-align: center; font-size: 10.5px; color: #8b93a7; margin-top: 12px; }

/* ── empates ── */
.ladder { display: flex; flex-direction: column; gap: 0; }
.lstep { display: flex; gap: 14px; padding: 10px 0; border-top: 1px solid rgba(255,255,255,.08); }
.lnum { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-family: Rajdhani, sans-serif; font-size: 13px; font-weight: 700;
  background: rgba(255,46,99,.16); color: #ff2e63; flex: 0 0 auto; }
.lstep.end .lnum { background: rgba(255,255,255,.1); color: #b9c0d0; }
.lstep b { font-size: 15px; font-weight: 600; }
.lstep p { font-size: 12px; color: #8b93a7; margin-top: 2px; line-height: 1.45; }
.rulebox { border-left: 2px solid #ff2e63; background: rgba(255,46,99,.08); padding: 13px 17px; border-radius: 0 4px 4px 0; margin-bottom: 22px; }
.rulebox b { font-size: 15px; font-weight: 600; }
.rulebox p { font-size: 12.5px; color: #99a1b4; margin-top: 6px; line-height: 1.5; }
.drawcard { border: 1px solid rgba(255,255,255,.14); border-radius: 8px; padding: 18px 20px; background: rgba(255,255,255,.03); }
.dr-row { display: grid; grid-template-columns: 1fr auto 70px; gap: 12px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.07); }
.dr-row span { font-size: 12.5px; color: #b9c0d0; }
.dr-row b { font-family: Rajdhani, sans-serif; font-size: 17px; font-weight: 700; }
.dr-row i { font-style: normal; font-size: 10px; color: #7d859a; text-align: right; letter-spacing: .1em; text-transform: uppercase; }
.dr-final { font-family: Rajdhani, sans-serif; font-size: 40px; font-weight: 700; letter-spacing: .16em; text-align: center; color: #ffd35c; margin: 14px 0 8px; }
.drawcard p { font-size: 12px; color: #8b93a7; line-height: 1.5; }
.freq { display: grid; grid-template-columns: 1fr auto 1fr; gap: 14px; align-items: center; margin-top: 20px; }
.freq > div { text-align: center; }
.freq b { display: block; font-family: Rajdhani, sans-serif; font-size: 19px; font-weight: 700; color: #fff; }
.freq span { font-size: 10.5px; color: #7d859a; line-height: 1.4; display: block; margin-top: 3px; }
.freq .arr { font-size: 22px; color: #ff2e63; }

/* ── resultados ── */
.results3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; flex: 1; min-height: 0; }
.resbox { border-radius: 8px; padding: 22px 22px 20px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.03); display: flex; flex-direction: column; }
.resbox.win { border-color: rgba(55,230,160,.45); background: linear-gradient(180deg, rgba(55,230,160,.13), rgba(255,255,255,.02)); }
.resbox.lose { border-color: rgba(255,46,99,.45); background: linear-gradient(180deg, rgba(255,46,99,.12), rgba(255,255,255,.02)); }
.resbox.draw { border-color: rgba(255,211,92,.45); background: linear-gradient(180deg, rgba(255,211,92,.12), rgba(255,255,255,.02)); }
.res-t { font-family: Rajdhani, sans-serif; font-size: 30px; font-weight: 700; letter-spacing: .16em; }
.resbox.win .res-t { color: #37e6a0; } .resbox.lose .res-t { color: #ff2e63; } .resbox.draw .res-t { color: #ffd35c; }
.res-score { display: flex; align-items: baseline; gap: 10px; margin: 8px 0 14px; font-family: Rajdhani, sans-serif; font-size: 46px; font-weight: 700; }
.res-score span { color: #565e73; font-size: 28px; }
.res-rows > div { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 0; border-top: 1px solid rgba(255,255,255,.08); }
.res-rows span { font-size: 11.5px; color: #8b93a7; }
.res-rows b { font-family: Rajdhani, sans-serif; font-size: 14px; }
.res-why { font-size: 12px; color: #99a1b4; margin-top: 12px; flex: 1; line-height: 1.45; }
.res-btns { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.res-btns b { text-align: center; font-family: Rajdhani, sans-serif; font-size: 12px; font-weight: 700; letter-spacing: .14em; padding: 8px; border-radius: 5px; background: #ff2e63; }
.res-btns span { text-align: center; font-size: 10.5px; letter-spacing: .12em; padding: 6px; border-radius: 5px; border: 1px solid rgba(255,255,255,.16); color: #b9c0d0; }

/* ── arquitectura ── */
.arch { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 0; }
.abox { width: 460px; border: 1px solid rgba(255,255,255,.12); border-radius: 6px; padding: 9px 18px; background: rgba(255,255,255,.04);
  display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.abox b { font-size: 14px; font-weight: 600; }
.abox em { font-style: normal; font-size: 10.5px; color: #7d859a; }
.abox.key { border-color: rgba(255,46,99,.55); background: rgba(255,46,99,.13); box-shadow: 0 0 28px rgba(255,46,99,.18); }
.abox.ui { border-color: rgba(25,227,255,.45); background: rgba(25,227,255,.09); }
.adown { font-style: normal; color: #3d4457; font-size: 10px; }
.arch-claim { margin-top: 20px; text-align: center; }
.arch-claim b { display: block; font-family: Rajdhani, sans-serif; font-size: 24px; font-weight: 600; }
.arch-claim span { display: block; font-size: 12.5px; color: #8b93a7; margin-top: 6px; max-width: 760px; margin-inline: auto; line-height: 1.5; }

/* ── construido / siguiente / fuera ── */
.built { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px 18px; flex: 1; min-height: 0; align-content: center; }
.bitem { display: flex; gap: 11px; align-items: flex-start; padding: 10px 0; border-top: 1px solid rgba(255,255,255,.08); }
.bt { width: 19px; height: 19px; border-radius: 50%; background: rgba(55,230,160,.16); color: #37e6a0; display: grid; place-items: center; font-size: 10px; font-weight: 700; flex: 0 0 auto; }
.bitem b { font-size: 14px; font-weight: 600; display: block; }
.bitem em { font-style: normal; font-size: 10.5px; color: #7d859a; }
.next { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 24px; flex: 1; min-height: 0; align-content: center; }
.nitem { display: flex; gap: 14px; align-items: flex-start; padding: 12px 0; border-top: 1px solid rgba(255,255,255,.08); }
.nn { font-family: Rajdhani, sans-serif; font-size: 20px; font-weight: 700; color: #ff2e63; line-height: 1; }
.nitem b { font-size: 16px; font-weight: 600; display: block; }
.nitem em { font-style: normal; font-size: 11px; color: #8b93a7; }
.notin { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; flex: 1; min-height: 0; align-content: center; }
.ni { border: 1px dashed rgba(255,255,255,.18); border-radius: 6px; padding: 18px 16px; background: rgba(255,255,255,.02); }
.ni b { display: block; font-family: Rajdhani, sans-serif; font-size: 19px; font-weight: 600; color: #b9c0d0; }
.ni em { font-style: normal; font-size: 11px; color: #6f778b; display: block; margin-top: 4px; line-height: 1.4; }
.notin-foot { margin-top: 22px; text-align: center; }
.notin-foot b { font-size: 17px; color: #ffd35c; font-weight: 600; }
.notin-foot span { display: block; font-size: 12.5px; color: #8b93a7; margin-top: 8px; max-width: 820px; margin-inline: auto; line-height: 1.5; }

/* ── cierre ── */
.closing { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 40px; }
.close-h { font-size: 108px; font-weight: 700; line-height: .9; letter-spacing: -.02em; margin-top: 14px; }
.close-sub { font-family: Rajdhani, sans-serif; font-size: 30px; font-weight: 600; letter-spacing: .34em; color: #19e3ff; margin-top: 8px; }
.close-tag { font-size: 17px; color: #b9c0d0; font-style: italic; margin-top: 22px; }
.close-cards { display: flex; gap: 12px; margin: 34px 0 26px; }
.close-cards .dcard:nth-child(odd) { transform: translateY(10px); }
`;

// ═══════════════════════════════ SALIDA ═══════════════════════════════

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>NEXUS VALORANT CARDS — Duel Gameplay · Product Preview 2026</title>
<style>${embeddedFonts()}</style>
<style>${CSS}</style>
</head>
<body>
${slides.join("\n")}
</body>
</html>`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "duel-gameplay.html"), html, "utf8");
console.log(`[duel-doc] ${PAGE} diapositivas → docs/product/duel-gameplay.html`);
