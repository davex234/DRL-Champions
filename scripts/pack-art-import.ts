/**
 * IMPORTA LOS ARTES OFICIALES DE SOBRE — de `sobres/*.png` a `public/packs/pack-<packId>.webp`.
 *
 *   npx tsx scripts/pack-art-import.ts [--only=champions] [--dry]
 *
 * Los originales que entrega el equipo de arte son láminas de 1024 × 1536 CON FONDO (negro plano,
 * gris claro o el propio resplandor del sobre). La convención de esta casa —`public/packs/README.md`—
 * es la contraria y por un motivo concreto: el sobre se compone sobre el escenario oscuro de la
 * apertura Y sobre la vitrina de la tienda, que no comparten fondo, así que un fondo horneado
 * recorta un rectángulo visible en las dos.
 *
 * Este instrumento NO redibuja nada: recorta el fondo y reencuadra.
 *
 *   1. FONDO CONECTADO. Se toma el color del borde (mediana) y se marca lo que se le parece y
 *      además está CONECTADO con el borde. Así, una zona oscura DENTRO del sobre —la cara negra
 *      de Champions, por ejemplo— no se vuelve transparente por parecerse al fondo.
 *   2. ALFA SUAVE. Dentro de esa región, el alfa sube con la distancia al color de fondo, de modo
 *      que un resplandor horneado (oro, Masters) se desvanece en vez de cortarse con un filo.
 *   3. REENCUADRE SIN DEFORMAR. Se recorta al contenido y se centra en el lienzo 780 × 1140 (13:19)
 *      que dibuja `SealedPack`, manteniendo la proporción original: el relleno es transparente.
 *
 * Verifica lo que escribe: esquinas transparentes, centro opaco y silueta de una sola pieza.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** ORIGEN → `packId` del catálogo. Cada línea es una correspondencia declarada, no adivinada. */
export const IMPORT_MAP: { file: string; packId: string; nota: string }[] = [
  { file: "Amercias.png", packId: "americas", nota: "VALORANT AMERICAS" },
  { file: "Emea.png", packId: "emea", nota: "VCT EMEA" },
  { file: "Pacific.png", packId: "pacific", nota: "VALORANT PACIFIC" },
  { file: "China.png", packId: "china", nota: "VCT CN · STAGE 2" },
  { file: "Masters.png", packId: "masters", nota: "VALORANT MASTERS (ya traía alfa)" },
  { file: "Champions.png", packId: "champions", nota: "VALORANT CHAMPIONS" },
  { file: "Icono.png", packId: "icon", nota: "VALORANT ICON (foil, sin escalón)" },
  { file: "EWC.png", packId: "ewc", nota: "VALORANT / ESPORTS WORLD CUP" },
  { file: "TeamHeretics.png", packId: "team-heretics", nota: "TEAM HERETICS · logo oficial" },
  { file: "FNC.png", packId: "team-fnatic", nota: "FNATIC · logo oficial" },
  { file: "TL.png", packId: "team-liquid", nota: "TEAM LIQUID · logo oficial" },
  { file: "KC.png", packId: "team-karmine", nota: "KARMINE CORP · logo oficial" },
  { file: "G2.png", packId: "team-g2", nota: "G2 ESPORTS · logo oficial (sustituye el troquel de monograma)" },
  /*
   * LA GAMA BASE (Packs Base 4.0). Los productos NO cambiaron de identificador: `estandar` y
   * `premium` pasaron a llamarse «Sobre Bronce» y «Sobre Plata» EN SITIO —inventarios,
   * recompensas e historial siguen apuntando al mismo `packId`—, así que su arte va al fichero
   * de su id, no al del nombre nuevo. `oro` sí es producto nuevo.
   */
  { file: "inicial.png", packId: "inicial", nota: "NEXUS BIENVENIDO → Sobre Inicial" },
  { file: "Bronze.png", packId: "estandar", nota: "ICON BRONZE → Sobre Bronce (packId histórico `estandar`)" },
  { file: "Plata.png", packId: "premium", nota: "ICON SILVER → Sobre Plata (packId histórico `premium`)" },
  { file: "oro.png", packId: "oro", nota: "ICON GOLD → Sobre Oro (producto nuevo)" },
];

const PY = String.raw`
import sys, json
import numpy as np
from PIL import Image

W, H = 780, 1140          # el lienzo de SealedPack (13:19)

def propaga(cand):
    """Lo que, siendo candidato a fondo, ESTÁ CONECTADO con el borde de la lámina."""
    m = np.zeros_like(cand)
    m[0, :] |= cand[0, :]; m[-1, :] |= cand[-1, :]
    m[:, 0] |= cand[:, 0]; m[:, -1] |= cand[:, -1]
    while True:
        n = m.copy()
        n[1:, :] |= m[:-1, :]; n[:-1, :] |= m[1:, :]
        n[:, 1:] |= m[:, :-1]; n[:, :-1] |= m[:, 1:]
        n &= cand
        if n.sum() == m.sum():
            return m
        m = n

def erosiona(m, k):
    for _ in range(k):
        n = m.copy()
        n[1:, :] &= m[:-1, :]; n[:-1, :] &= m[1:, :]
        n[:, 1:] &= m[:, :-1]; n[:, :-1] &= m[:, 1:]
        m = n
    return m

def nucleo(fuerte):
    """Franja interior del sobre: entre el primer y el último pixel con color propio, por filas y
    por columnas, y luego encogida. Protege el NEGRO DE DENTRO (la cara de Champions, el foil de
    Icon) de que el relleno del fondo se cuele por un corredor oscuro. No toca el borde dentado."""
    h, w = fuerte.shape
    filas = np.zeros_like(fuerte); cols = np.zeros_like(fuerte)
    idx = np.arange(w)
    for y in range(h):
        f = fuerte[y]
        if f.any():
            filas[y, f.argmax():w - f[::-1].argmax()] = True
    idy = np.arange(h)
    for x in range(w):
        f = fuerte[:, x]
        if f.any():
            cols[f.argmax():h - f[::-1].argmax(), x] = True
    return erosiona(filas & cols, 16)

def recorta(src, dst):
    im = Image.open(src).convert("RGBA")
    a = np.asarray(im).astype(np.int16)
    rgb, alpha = a[..., :3], a[..., 3].astype(np.float32) / 255.0
    h, w = alpha.shape

    borde = np.concatenate([rgb[0, :], rgb[-1, :], rgb[:, 0], rgb[:, -1]])
    base = np.median(borde, axis=0)
    ruido = float(borde.std())
    dist = np.abs(rgb - base).max(axis=2).astype(np.float32)

    # el umbral se ajusta al ruido del propio fondo: negro plano pide poco, un resplandor pide más
    t_con = float(np.clip(round(4 * ruido + 8), 8, 30))
    t0, t1 = t_con * 0.5, t_con * 2.2

    fondo = propaga((dist <= t_con) & ~nucleo(dist > 45))
    suave = np.clip((dist - t0) / max(1.0, t1 - t0), 0.0, 1.0)
    nueva = np.where(fondo, suave, 1.0) * alpha   # respeta el alfa que ya trajera el original
    im2 = Image.fromarray(np.dstack([rgb.astype(np.uint8), (nueva * 255).astype(np.uint8)]), "RGBA")

    caja = im2.getbbox()                          # recorte al contenido: encuadra, no deforma
    if caja:
        im2 = im2.crop(caja)
    escala = min(W / im2.width, H / im2.height)   # «contain»: se respeta la proporción original
    im2 = im2.resize((max(1, round(im2.width * escala)), max(1, round(im2.height * escala))), Image.LANCZOS)
    lienzo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    lienzo.paste(im2, ((W - im2.width) // 2, (H - im2.height) // 2))
    lienzo.save(dst, "WEBP", quality=90, method=6, exact=True)

    v = np.asarray(Image.open(dst).convert("RGBA"))[..., 3]
    dentro = v[H // 2 - 300:H // 2 + 300, W // 2 - 200:W // 2 + 200]
    return {"ancho": im2.width, "alto": im2.height, "ruido": round(ruido, 1), "umbral": t_con,
            "esquinaAlfa": int(max(v[0, 0], v[0, -1], v[-1, 0], v[-1, -1])),
            "centroAlfa": int(np.percentile(dentro, 1)),
            "opaco": float((v > 250).mean()), "transparente": float((v < 5).mean())}

print(json.dumps(recorta(sys.argv[1], sys.argv[2])))
`;

export function convertir(src: string, dst: string): Record<string, number> {
  const dir = mkdtempSync(join(tmpdir(), "packart-"));
  const py = join(dir, "recorta.py");
  try {
    writeFileSync(py, PY, "utf8");
    return JSON.parse(execFileSync("python", [py, src, dst], { encoding: "utf8" }).trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1]?.includes("pack-art-import")) {
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
  const dry = process.argv.includes("--dry");
  for (const m of IMPORT_MAP) {
    if (only && m.packId !== only) continue;
    const src = join(process.cwd(), "sobres", m.file);
    const dst = join(process.cwd(), "public", "packs", `pack-${m.packId}.webp`);
    if (dry) { console.log(`· ${m.file} → pack-${m.packId}.webp (${m.nota})`); continue; }
    const r = convertir(src, dst);
    const ok = r.esquinaAlfa <= 8 && r.centroAlfa >= 250;
    console.log(`${ok ? "✓" : "✗"} pack-${m.packId}.webp ${r.ancho}×${r.alto} · ruido=${r.ruido} umbral=${r.umbral} · esquina=${r.esquinaAlfa} centro=${r.centroAlfa} · opaco ${(r.opaco * 100).toFixed(0)}% · ${m.nota}`);
  }
}
