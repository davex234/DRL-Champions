/**
 * F59 · MANIFIESTO DE ARTE DE AGENTES — FICHERO GENERADO por `npm run agent-art:import`. No se edita a mano.
 *
 * Una fila por agente del roster real (`roster.ts`); `null` = esa pieza no existe y el componente pinta su
 * respaldo sin pedir nada. `source` es el original en `personajes/` (intacto); `sourceSha` detecta si cambió.
 * `?v=` es el hash del derivado: cambia sólo si cambia la imagen.
 */
export interface AgentArtAsset {
  src: string;
  width: number;
  height: number;
  /** ¿El derivado tiene transparencia? Los cuerpos opacos traen fondo de estudio y se funden con máscara. */
  alpha: boolean;
  source: string;
  sourceSha: string;
  /** Se quitó un fondo blanco liso conectado al borde (sólo caras opacas). */
  backdrop?: "white-removed";
  /** Cara de 96 px para tamaños pequeños (`srcset` y fichas del mapa). */
  small?: { src: string; width: number; height: number };
}

export const AGENT_ART_MANIFEST: Readonly<Record<string, { face: AgentArtAsset | null; full: AgentArtAsset | null }>> = {
  "astra": {
    face: {src: "/agents/astra/face.webp?v=236536e6d3", width: 250, height: 250, alpha: true, source: "personajes/cara/astra.webp", sourceSha: "a2f0bc94c2e89fb5", small: {src: "/agents/astra/face-96.webp?v=04a64fbc30", width: 96, height: 96}},
    full: {src: "/agents/astra/full.webp?v=8bee91dbe3", width: 352, height: 470, alpha: false, source: "personajes/entero/astra.avif", sourceSha: "74c90c6c76863af6"},
  },
  "breach": {
    face: {src: "/agents/breach/face.webp?v=6f8da100de", width: 250, height: 250, alpha: true, source: "personajes/cara/breach.webp", sourceSha: "6283b8f3db38c46e", small: {src: "/agents/breach/face-96.webp?v=31b13374f9", width: 96, height: 96}},
    full: {src: "/agents/breach/full.webp?v=2bc89f8785", width: 352, height: 470, alpha: false, source: "personajes/entero/breach.avif", sourceSha: "3f68cd2026a011f7"},
  },
  "brimstone": {
    face: {src: "/agents/brimstone/face.webp?v=b67d60990e", width: 250, height: 250, alpha: true, source: "personajes/cara/brimstone.webp", sourceSha: "8ba40a4d3cbc727d", small: {src: "/agents/brimstone/face-96.webp?v=e11ef071b0", width: 96, height: 96}},
    full: {src: "/agents/brimstone/full.webp?v=19346d92fe", width: 352, height: 470, alpha: false, source: "personajes/entero/brimstone.avif", sourceSha: "82f848e3b511e2eb"},
  },
  "chamber": {
    face: {src: "/agents/chamber/face.webp?v=caffb6d9a1", width: 250, height: 250, alpha: true, source: "personajes/cara/chamber.webp", sourceSha: "f05921895e52b24e", small: {src: "/agents/chamber/face-96.webp?v=93e123a777", width: 96, height: 96}},
    full: {src: "/agents/chamber/full.webp?v=be1bbff3d8", width: 352, height: 470, alpha: false, source: "personajes/entero/chamber.avif", sourceSha: "7084f963b023f2da"},
  },
  "clove": {
    face: {src: "/agents/clove/face.webp?v=9f47fb305f", width: 250, height: 250, alpha: true, source: "personajes/cara/clove.webp", sourceSha: "e3d5ccf30e52fe37", small: {src: "/agents/clove/face-96.webp?v=e9e5fbe21b", width: 96, height: 96}},
    full: {src: "/agents/clove/full.webp?v=62884a287d", width: 352, height: 470, alpha: false, source: "personajes/entero/clove.avif", sourceSha: "5a12470ada25922f"},
  },
  "cypher": {
    face: {src: "/agents/cypher/face.webp?v=b7fc279e2a", width: 250, height: 250, alpha: true, source: "personajes/cara/cypher.webp", sourceSha: "8fd42bef6749a430", small: {src: "/agents/cypher/face-96.webp?v=ad21a77a7d", width: 96, height: 96}},
    full: {src: "/agents/cypher/full.webp?v=729304df09", width: 352, height: 470, alpha: false, source: "personajes/entero/cypher.avif", sourceSha: "c5b07ee282967dcb"},
  },
  "deadlock": {
    face: {src: "/agents/deadlock/face.webp?v=fc3d43ee56", width: 250, height: 250, alpha: true, source: "personajes/cara/deadlock.webp", sourceSha: "cdc3189109fae579", small: {src: "/agents/deadlock/face-96.webp?v=b75fafde2f", width: 96, height: 96}},
    full: {src: "/agents/deadlock/full.webp?v=8e0295cf4e", width: 352, height: 470, alpha: false, source: "personajes/entero/deadlock.avif", sourceSha: "0d7998ede02594d8"},
  },
  "fade": {
    face: {src: "/agents/fade/face.webp?v=5d201e8de7", width: 250, height: 250, alpha: true, source: "personajes/cara/fade.jpeg", sourceSha: "1d7ba1bf2b73779e", backdrop: "white-removed", small: {src: "/agents/fade/face-96.webp?v=d9295e88f4", width: 96, height: 96}},
    full: {src: "/agents/fade/full.webp?v=b68d685454", width: 352, height: 470, alpha: false, source: "personajes/entero/fade.avif", sourceSha: "531796b06a1af97e"},
  },
  "gekko": {
    face: {src: "/agents/gekko/face.webp?v=2fc31f51d7", width: 250, height: 250, alpha: true, source: "personajes/cara/gekko.webp", sourceSha: "a873d0511edc5d62", small: {src: "/agents/gekko/face-96.webp?v=7aeecc62b0", width: 96, height: 96}},
    full: {src: "/agents/gekko/full.webp?v=b33d8fad58", width: 352, height: 470, alpha: false, source: "personajes/entero/geko.avif", sourceSha: "a819aca69b39c2fc"},
  },
  "harbor": {
    face: {src: "/agents/harbor/face.webp?v=15597131cc", width: 250, height: 250, alpha: true, source: "personajes/cara/harbor.webp", sourceSha: "ddf7d89d99a3fc2c", small: {src: "/agents/harbor/face-96.webp?v=f32eb8815a", width: 96, height: 96}},
    full: {src: "/agents/harbor/full.webp?v=15513ab7c0", width: 352, height: 470, alpha: false, source: "personajes/entero/harbor.avif", sourceSha: "7b509bf97c54fb69"},
  },
  "iso": {
    face: {src: "/agents/iso/face.webp?v=10f4f7f69e", width: 250, height: 250, alpha: true, source: "personajes/cara/iso.jpeg", sourceSha: "6d8b59e1ce577b0e", backdrop: "white-removed", small: {src: "/agents/iso/face-96.webp?v=f14efbfcd9", width: 96, height: 96}},
    full: {src: "/agents/iso/full.webp?v=946fb272e2", width: 352, height: 470, alpha: false, source: "personajes/entero/iso.avif", sourceSha: "29ba86ca01382561"},
  },
  "jett": {
    face: {src: "/agents/jett/face.webp?v=5292a0501f", width: 256, height: 256, alpha: true, source: "personajes/cara/jett.png", sourceSha: "04d5f6b623ebb3f4", small: {src: "/agents/jett/face-96.webp?v=a4a297c6c0", width: 96, height: 96}},
    full: {src: "/agents/jett/full.webp?v=15796b3c3b", width: 352, height: 470, alpha: false, source: "personajes/entero/jett.avif", sourceSha: "e8ca348c30eb051c"},
  },
  "kayo": {
    face: {src: "/agents/kayo/face.webp?v=82d39e4658", width: 250, height: 250, alpha: true, source: "personajes/cara/kayo.webp", sourceSha: "1b986c897db50cfd", small: {src: "/agents/kayo/face-96.webp?v=c78bd534eb", width: 96, height: 96}},
    full: {src: "/agents/kayo/full.webp?v=eaa1db905d", width: 352, height: 470, alpha: false, source: "personajes/entero/kayo.avif", sourceSha: "528e5b26fa06f4c1"},
  },
  "killjoy": {
    face: {src: "/agents/killjoy/face.webp?v=782cfd29e5", width: 256, height: 256, alpha: true, source: "personajes/cara/killjoy.jpeg", sourceSha: "b66401513160918c", backdrop: "white-removed", small: {src: "/agents/killjoy/face-96.webp?v=34540df02a", width: 96, height: 96}},
    full: {src: "/agents/killjoy/full.webp?v=ebfea2305f", width: 352, height: 470, alpha: false, source: "personajes/entero/killjoy.png", sourceSha: "b69f99b453e309e8"},
  },
  "miks": {
    face: {src: "/agents/miks/face.webp?v=e4e15d6e03", width: 250, height: 250, alpha: true, source: "personajes/cara/miks.webp", sourceSha: "8623011d9dfadc80", small: {src: "/agents/miks/face-96.webp?v=7102a80c90", width: 96, height: 96}},
    full: {src: "/agents/miks/full.webp?v=94d05be564", width: 352, height: 540, alpha: true, source: "personajes/entero/miks.avif", sourceSha: "07a827aa26edb1b1"},
  },
  "neon": {
    face: {src: "/agents/neon/face.webp?v=f88c1dc607", width: 256, height: 256, alpha: true, source: "personajes/cara/neon.webp", sourceSha: "b2ef0be1c320774a", small: {src: "/agents/neon/face-96.webp?v=b7dc8bb5a2", width: 96, height: 96}},
    full: {src: "/agents/neon/full.webp?v=8ce47d13d1", width: 352, height: 470, alpha: false, source: "personajes/entero/neon.avif", sourceSha: "66c95d10000c641e"},
  },
  "omen": {
    face: {src: "/agents/omen/face.webp?v=d7e6ffe052", width: 250, height: 250, alpha: true, source: "personajes/cara/Omen.webp", sourceSha: "3a30b21359c577e1", small: {src: "/agents/omen/face-96.webp?v=ca03606deb", width: 96, height: 96}},
    full: {src: "/agents/omen/full.webp?v=8f897e7b31", width: 352, height: 470, alpha: false, source: "personajes/entero/omen.avif", sourceSha: "9dde03d4e4b71830"},
  },
  "phoenix": {
    face: {src: "/agents/phoenix/face.webp?v=d3026fe9d6", width: 185, height: 185, alpha: true, source: "personajes/cara/phoenix.webp", sourceSha: "3d4497730bc852dd", small: {src: "/agents/phoenix/face-96.webp?v=a0963810ef", width: 96, height: 96}},
    full: {src: "/agents/phoenix/full.webp?v=38ac418e04", width: 352, height: 470, alpha: false, source: "personajes/entero/phoenix.avif", sourceSha: "982364f8dc0307e3"},
  },
  "raze": {
    face: {src: "/agents/raze/face.webp?v=45ee35e26f", width: 250, height: 250, alpha: true, source: "personajes/cara/raze.webp", sourceSha: "606b5ff18d638361", small: {src: "/agents/raze/face-96.webp?v=5f2e4dc88a", width: 96, height: 96}},
    full: {src: "/agents/raze/full.webp?v=33fee8a168", width: 352, height: 470, alpha: false, source: "personajes/entero/raze.avif", sourceSha: "8a7666783052792a"},
  },
  "reyna": {
    face: {src: "/agents/reyna/face.webp?v=b34d7717b8", width: 250, height: 250, alpha: true, source: "personajes/cara/reyna.webp", sourceSha: "ccebaa2772f73524", small: {src: "/agents/reyna/face-96.webp?v=a003d6c741", width: 96, height: 96}},
    full: {src: "/agents/reyna/full.webp?v=29b6233a3f", width: 352, height: 470, alpha: false, source: "personajes/entero/reyna.avif", sourceSha: "2d8a2e1751295f47"},
  },
  "sage": {
    face: {src: "/agents/sage/face.webp?v=232d4031bf", width: 185, height: 185, alpha: true, source: "personajes/cara/sage.webp", sourceSha: "24f6fc564353e065", small: {src: "/agents/sage/face-96.webp?v=bf0b336111", width: 96, height: 96}},
    full: {src: "/agents/sage/full.webp?v=1384123bac", width: 352, height: 470, alpha: false, source: "personajes/entero/sage.avif", sourceSha: "db344f4cc518596e"},
  },
  "skye": {
    face: {src: "/agents/skye/face.webp?v=c065220f11", width: 256, height: 256, alpha: true, source: "personajes/cara/skye.png", sourceSha: "96b7997f91b5f7cc", small: {src: "/agents/skye/face-96.webp?v=c2224be1b2", width: 96, height: 96}},
    full: {src: "/agents/skye/full.webp?v=a2aab04808", width: 352, height: 470, alpha: false, source: "personajes/entero/skye.avif", sourceSha: "c0433997c01a6e89"},
  },
  "sova": {
    face: {src: "/agents/sova/face.webp?v=b290d35afb", width: 250, height: 250, alpha: true, source: "personajes/cara/sova.webp", sourceSha: "541a19f5da7e1a85", small: {src: "/agents/sova/face-96.webp?v=68b92623c7", width: 96, height: 96}},
    full: {src: "/agents/sova/full.webp?v=ccdf925afc", width: 352, height: 470, alpha: false, source: "personajes/entero/sova.avif", sourceSha: "bd11cab733650c36"},
  },
  "tejo": {
    face: {src: "/agents/tejo/face.webp?v=4bf8439b24", width: 250, height: 250, alpha: true, source: "personajes/cara/tejo.webp", sourceSha: "6602147cb188c13e", small: {src: "/agents/tejo/face-96.webp?v=a8fd36921b", width: 96, height: 96}},
    full: {src: "/agents/tejo/full.webp?v=6dcb919c05", width: 352, height: 540, alpha: false, source: "personajes/entero/tejo.avif", sourceSha: "be2ce6393504f66d"},
  },
  "veto": {
    face: {src: "/agents/veto/face.webp?v=78a08f2095", width: 250, height: 250, alpha: true, source: "personajes/cara/veto.webp", sourceSha: "3d700995246f4092", small: {src: "/agents/veto/face-96.webp?v=fbbf9e1ba0", width: 96, height: 96}},
    full: {src: "/agents/veto/full.webp?v=f4945cec11", width: 352, height: 540, alpha: true, source: "personajes/entero/veto.avif", sourceSha: "9dd5a2db3f528ae2"},
  },
  "viper": {
    face: {src: "/agents/viper/face.webp?v=9cc19d3b95", width: 250, height: 250, alpha: true, source: "personajes/cara/viper.webp", sourceSha: "2f004074965d1b9e", small: {src: "/agents/viper/face-96.webp?v=d8c8a891b2", width: 96, height: 96}},
    full: {src: "/agents/viper/full.webp?v=33ff516e00", width: 352, height: 470, alpha: false, source: "personajes/entero/viper.avif", sourceSha: "5282e1cf8ac7b2d9"},
  },
  "vyse": {
    face: {src: "/agents/vyse/face.webp?v=89c657a0a9", width: 250, height: 250, alpha: true, source: "personajes/cara/vyse.webp", sourceSha: "cb56e802b241340a", small: {src: "/agents/vyse/face-96.webp?v=3f1dfe3790", width: 96, height: 96}},
    full: {src: "/agents/vyse/full.webp?v=aa3fda9de0", width: 352, height: 540, alpha: true, source: "personajes/entero/vyse.avif", sourceSha: "d6799745794c311e"},
  },
  "waylay": {
    face: {src: "/agents/waylay/face.webp?v=342c076769", width: 250, height: 250, alpha: true, source: "personajes/cara/waylay.webp", sourceSha: "35e3831646c7083c", small: {src: "/agents/waylay/face-96.webp?v=135184cf09", width: 96, height: 96}},
    full: {src: "/agents/waylay/full.webp?v=07088dd83e", width: 352, height: 540, alpha: true, source: "personajes/entero/waylay.avif", sourceSha: "82ea01e72582768d"},
  },
  "yoru": {
    face: {src: "/agents/yoru/face.webp?v=97a55e33e4", width: 256, height: 256, alpha: true, source: "personajes/cara/yoru.png", sourceSha: "1ca02a8e6fb437fb", small: {src: "/agents/yoru/face-96.webp?v=f7f4df5cb0", width: 96, height: 96}},
    full: {src: "/agents/yoru/full.webp?v=0584c8fa9a", width: 352, height: 470, alpha: false, source: "personajes/entero/yoru.avif", sourceSha: "41d00b8eea27644d"},
  },
};
