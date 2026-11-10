/*
 * WALKOUT 0.9 · PANEL DE PREVISUALIZACIÓN (solo existe en el proxy de la previsualización; NO forma parte del release).
 * Se inyecta en /design-system/pack-walkout de la build 0.9 y la maneja con lo que esa build ya expone:
 *   window.__walkout.seek(t)  congela un instante  → este panel lleva su propio reloj (play/pausa/velocidad/barra)
 *   window.__walkout.replay() la escena nativa completa CON sonido
 *   ?cele=…  la celebración      ?cam=x,y,z,lx,ly,lz  cámara fija relativa a la persona (la lee la escena al montarse)
 * Sin red, sin economía: la página es la demo local del walkout (fixtures de cartas, sin servidor).
 */
(() => {
  if (window.__previewPanel) return;
  window.__previewPanel = true;
  const q = new URLSearchParams(location.search);
  const CELES = [["POINT_SKY", "Point to sky"], ["SHUSH", "Shush"], ["HYPE_JUMP", "Hype jump"], ["ARMS_CROSSED", "Arms crossed"]];
  // cámaras relativas a la persona (mira a +Z; su brazo derecho está en −X)
  const VIEWS = [
    ["escena", "Escena (cámara real)", null],
    ["frente", "Frente", "0,1.3,4.4,0,1.1,0"],
    ["lateral", "Lateral", "-3.0,1.3,0.01,0,1.15,0"],
    ["tres", "Tres cuartos", "-2.3,1.4,2.4,0,1.15,0"],
    ["cerca", "Primer plano", "-0.7,1.62,1.5,0,1.45,0"],
  ];
  const TL = { WALKOUT: { cele: 8.3, card: 10.6, end: 12.6 }, MEGA_WALKOUT: { cele: 9.7, card: 12.4, end: 14.6 } };
  const intensity = TL[q.get("i")] ? q.get("i") : "WALKOUT";
  const tl = TL[intensity];
  const cele = CELES.some((c) => c[0] === q.get("cele")) ? q.get("cele") : "POINT_SKY";
  const view = VIEWS.some((v) => v[0] === q.get("view")) ? q.get("view") : "escena";

  /** Recarga con otros parámetros (la escena lee celebración y cámara al montarse) y retoma en `pt`. */
  const go = (patch, keepT = true) => {
    const n = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(patch)) { if (v === null) n.delete(k); else n.set(k, v); }
    const vw = VIEWS.find((v) => v[0] === (n.get("view") || "escena"));
    if (vw && vw[2]) n.set("cam", vw[2]); else n.delete("cam");
    if (keepT) n.set("pt", String(state.t.toFixed(2))); else n.delete("pt");
    n.set("panel", "0"); n.set("reduced", "0"); n.set("stage", "3d");
    location.search = n.toString();
  };

  const state = { t: Number(q.get("pt") || 0), playing: false, speed: 1, last: 0 };
  const seek = (t) => { state.t = Math.max(0, Math.min(tl.end, t)); window.__walkout?.seek(state.t); paint(); };
  const tick = (now) => {
    if (!state.playing) return;
    const dt = state.last ? (now - state.last) / 1000 : 0;
    state.last = now;
    seek(state.t + dt * state.speed);
    if (state.t >= tl.end) { state.playing = false; paint(); return; }
    requestAnimationFrame(tick);
  };
  const play = () => { if (state.t >= tl.end - 0.01) state.t = 0; state.playing = true; state.last = 0; requestAnimationFrame(tick); paint(); };
  const pause = () => { state.playing = false; seek(state.t); };

  const css = `#pv09{position:fixed;right:12px;top:12px;z-index:2147483000;width:min(340px,calc(100vw - 24px));font:12px/1.35 system-ui,sans-serif;color:#e8edf5;background:rgba(6,9,16,.86);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:10px;backdrop-filter:blur(6px)}
#pv09 h1{font-size:12px;margin:0 0 2px;letter-spacing:.12em;text-transform:uppercase}#pv09 .sub{color:#9aa6b8;font-size:10.5px;margin-bottom:8px}
#pv09 .row{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0}#pv09 button{font:inherit;color:inherit;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:5px;padding:6px 8px;cursor:pointer;min-height:32px}
#pv09 button[aria-pressed=true]{background:rgba(25,227,255,.18);border-color:rgba(25,227,255,.7);color:#7ff0ff}#pv09 button:focus-visible{outline:2px solid #7ff0ff;outline-offset:1px}
#pv09 label{display:block;color:#9aa6b8;font-size:10.5px;text-transform:uppercase;letter-spacing:.1em;margin-top:8px}#pv09 input[type=range]{width:100%}
#pv09 .t{font-family:ui-monospace,monospace;color:#cfe}#pv09 .min{position:absolute;right:8px;top:6px;min-height:0;padding:2px 6px}`;
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
  const el = document.createElement("div"); el.id = "pv09"; el.setAttribute("role", "region"); el.setAttribute("aria-label", "Previsualización Walkout 0.9");
  el.innerHTML = `<button class="min" type="button" data-a="min" aria-label="Plegar panel">–</button>
<h1>Walkout 0.9 · Previsualización</h1><div class="sub" data-info>build …</div>
<div data-body>
<label>Celebración</label><div class="row">${CELES.map(([id, l]) => `<button type="button" data-cele="${id}" aria-pressed="${id === cele}">${l}</button>`).join("")}</div>
<label>Vista</label><div class="row">${VIEWS.map(([id, l]) => `<button type="button" data-view="${id}" aria-pressed="${id === view}">${l}</button>`).join("")}</div>
<label>Reproducción <span class="t" data-t></span></label>
<div class="row"><button type="button" data-a="play">▶ Reproducir</button><button type="button" data-a="pause">❚❚ Pausa</button><button type="button" data-a="restart">↺ Repetir desde el inicio</button></div>
<div class="row"><button type="button" data-a="cele">⏭ Ir a la celebración</button><button type="button" data-a="card">⏭ Ir al revelado</button></div>
<input type="range" min="0" max="${tl.end}" step="0.01" data-a="bar" aria-label="Instante de la escena">
<label>Velocidad</label><div class="row">${[1, 0.5, 0.25].map((s) => `<button type="button" data-speed="${s}" aria-pressed="${s === 1}">${s}×</button>`).join("")}</div>
<label>Intensidad</label><div class="row">${Object.keys(TL).map((i) => `<button type="button" data-int="${i}" aria-pressed="${i === intensity}">${i === "WALKOUT" ? "Walkout" : "Mega walkout"}</button>`).join("")}</div>
<div class="row"><button type="button" data-a="native">♪ Escena completa con sonido (reproductor real)</button></div>
<div class="sub" style="margin-top:6px">Demo local con cartas de ejemplo: no abre sobres, no gasta créditos, sin servidor de juego. La pausa y la barra son de esta previsualización (sin sonido).</div>
</div>`;
  document.body.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const paint = () => {
    $("[data-t]").textContent = `t = ${state.t.toFixed(2)} s · celebración a ${tl.cele} s · ${state.playing ? "reproduciendo" : "en pausa"}`;
    const bar = $("[data-a=bar]"); if (document.activeElement !== bar) bar.value = String(state.t);
    for (const b of el.querySelectorAll("[data-speed]")) b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === state.speed));
  };
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.cele) return go({ cele: b.dataset.cele }, false);
    if (b.dataset.view) return go({ view: b.dataset.view });
    if (b.dataset.int) return go({ i: b.dataset.int, fx: b.dataset.int === "MEGA_WALKOUT" ? "japan" : "turkey" }, false);
    if (b.dataset.speed) { state.speed = Number(b.dataset.speed); return paint(); }
    switch (b.dataset.a) {
      case "play": return play();
      case "pause": return pause();
      case "restart": state.t = 0; return play();
      case "cele": state.t = tl.cele - 0.6; return play();
      case "card": state.t = tl.card - 0.4; return play();
      case "native": state.playing = false; window.__walkout?.replay(); return;
      case "min": { const body = $("[data-body]"); body.hidden = !body.hidden; b.textContent = body.hidden ? "+" : "–"; return; }
    }
  });
  $("[data-a=bar]").addEventListener("input", (e) => { state.playing = false; seek(Number(e.target.value)); });
  window.addEventListener("keydown", (e) => { if (e.key === " " && e.target === document.body) { e.preventDefault(); state.playing ? pause() : play(); } });
  fetch("/__preview/info").then((r) => r.json()).then((i) => { $("[data-info]").textContent = `build ${i.buildId} · persona ${i.asset.slice(0, 12)}… · clips ${i.clips.join(", ")}`; }).catch(() => {});
  // espera a que la escena esté montada; luego se coloca en el instante pedido (por defecto, el principio)
  const boot = () => { if (!window.__walkout) return setTimeout(boot, 200); setTimeout(() => { seek(state.t); if (q.get("pt") === null) play(); }, 600); };
  boot();
  // en pausa, si la escena se reinicia al terminar de montarse (carga de la persona), vuelve al instante pedido
  setInterval(() => {
    if (state.playing || !window.__walkout) return;
    const cur = Number(document.querySelector("[data-testid=walkout]")?.dataset.t ?? NaN);
    if (Number.isFinite(cur) && Math.abs(cur - state.t) > 0.05) window.__walkout.seek(state.t);
  }, 400);
  paint();
})();
