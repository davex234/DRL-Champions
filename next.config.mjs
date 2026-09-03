/** @type {import('next').NextConfig} */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Build de ESCRITORIO (Tauri): export estático a `out/` para servirlo en el WebView.
// Se activa SOLO con NEXT_DESKTOP=1 → el build web por defecto queda intacto.
// Nota: en modo desktop las 5 API routes server-only (admin/esports/market) NO forman
// parte del juego (requieren Supabase) y deben excluirse del bundle estático.
const desktop = process.env.NEXT_DESKTOP === "1";

// ============================================================================
// BUILD ID REPRODUCIBLE — Y QUE CAMBIA CUANDO CAMBIA EL CÓDIGO
//
// EL PROBLEMA QUE TENÍA (auditoría de estabilidad)
//   La versión anterior devolvía `drl-${version}-${build}` leyendo solo
//   `version.json`. Es decir: DOS COMPILACIONES CON CÓDIGO DISTINTO COMPARTÍAN
//   BUILD_ID mientras no se tocara el número de versión. Medido: se cambió un
//   fichero de `src/`, se recompiló, y el id seguía siendo `drl-0.1.1-1`.
//
//   Eso no es un detalle cosmético. Next manda el build id en cada petición RSC y
//   el cliente compara: si no coincide, fuerza una recarga completa. Es su red de
//   seguridad para cuando se despliega mientras alguien tiene la pestaña abierta.
//   Con un id congelado esa red NUNCA se dispara, y un navegador que conserva
//   chunks o cargas Flight viejas cree que está al día. Combinado con un service
//   worker que cachea, es la receta de
//   `chunk.reason.enqueueModel is not a function`.
//
// LA SOLUCIÓN
//   Se conserva la intención original —dos compilaciones del MISMO código deben
//   dar `out/` byte-idéntico, para que los artefactos del Build Cloud sean
//   reproducibles— pero el id pasa a derivarse también del CONTENIDO. Mismo
//   código, mismo id; código distinto, id distinto. Que es lo que se esperaba.
//
//   Se recorre `src/` y los ficheros de configuración que afectan a la salida. El
//   coste es de decenas de milisegundos y solo se paga al compilar: Next llama a
//   esta función únicamente en `next build`.
// ============================================================================

/** Ficheros y carpetas cuyo contenido determina la salida de la compilación. */
const BUILD_INPUTS = [
  "src",
  "public/sw.js",
  "public/manifest.webmanifest",
  "package.json",
  "next.config.mjs",
  "tailwind.config.ts",
  "tsconfig.json",
  "version.json",
];

/** Rutas de fichero bajo una entrada, ordenadas para que el hash sea estable. */
function collectFiles(root, entry) {
  const abs = join(root, entry);
  let info;
  try {
    info = statSync(abs);
  } catch {
    return []; // la entrada puede no existir en un checkout parcial
  }
  if (info.isFile()) return [entry];

  const out = [];
  const walk = (rel) => {
    let items;
    try {
      items = readdirSync(join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    // El orden de `readdir` depende del sistema de ficheros: hay que ordenar o el
    // hash cambiaría de una máquina a otra y se perdería la reproducibilidad.
    for (const it of items.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const child = `${rel}/${it.name}`;
      if (it.isDirectory()) walk(child);
      else if (it.isFile()) out.push(child);
    }
  };
  walk(entry);
  return out;
}

function deterministicBuildId() {
  try {
    const root = fileURLToPath(new URL("./", import.meta.url));
    const v = JSON.parse(readFileSync(join(root, "version.json"), "utf8"));

    const hash = createHash("sha256");
    for (const entry of BUILD_INPUTS) {
      for (const rel of collectFiles(root, entry)) {
        // La RUTA entra en el hash además del contenido: renombrar un fichero
        // cambia la salida aunque los bytes sean los mismos.
        hash.update(rel);
        try {
          hash.update(readFileSync(join(root, rel)));
        } catch {
          /* ilegible: se ignora, el resto sigue identificando la compilación */
        }
      }
    }

    // Ocho caracteres bastan: no es un identificador criptográfico, solo tiene que
    // distinguir compilaciones y caber cómodamente en una URL.
    return `drl-${v.version}-${v.build}-${hash.digest("hex").slice(0, 8)}`;
  } catch {
    return null; // → Next usa su id por defecto
  }
}

// ============================================================================
// SEC-07 · CABECERAS DE SEGURIDAD (auditoría Fase A)
//
// La app no enviaba ninguna. Con la sesión de Supabase Auth guardada en el
// navegador, un XSS entregaba la cuenta completa. Esta es una PRIMERA capa
// razonable, deliberadamente permisiva donde hoy hace falta y documentada.
//
// EXCEPCIONES Y POR QUÉ EXISTEN
//   style-src 'unsafe-inline'   Next inyecta CSS en línea, y framer-motion y GSAP
//                               animan escribiendo `style` directamente. Quitarlo
//                               rompe la UI entera.
//   script-src 'unsafe-inline'  Next emite scripts de arranque y datos de hidratación
//                               en línea. Eliminarlo exige nonces por petición vía
//                               middleware → DEFERRED TO PHASE M. Aun así, la
//                               directiva ya impide cargar scripts de OTROS dominios,
//                               que es el vector de exfiltración habitual.
//   fonts.googleapis.com        Hoja de estilos de Rajdhani/Inter (src/app/layout.tsx).
//   fonts.gstatic.com           Ficheros de fuente que esa hoja referencia.
//   *.supabase.co (+ wss)       Auth, base de datos, Storage y realtime.
//   flagcdn.com                 Banderas de país (src/lib/assets.ts).
//   img-src https:              Las fotos de carta (`card_photos.url`) y los assets
//                               aprobados pueden apuntar a cualquier host; el panel
//                               de admin los previsualiza. Acotarlo exige normalizar
//                               los assets a un único bucket → DEFERRED TO PHASE C.
//
// NOTA: en el build de ESCRITORIO (output: "export") no se emiten cabeceras — un
// export estático no las soporta. Ahí la protección la da el WebView de Tauri.
// ============================================================================

// Origen del proyecto Supabase, para no abrir `*.supabase.co` cuando ya se conoce.
const supabaseOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin;
  } catch {
    return null;
  }
})();
const supabaseHttp = supabaseOrigin ?? "https://*.supabase.co";
const supabaseWs = supabaseOrigin
  ? supabaseOrigin.replace(/^https:/, "wss:")
  : "wss://*.supabase.co";

// En DESARROLLO, React y el HMR de Next compilan con `eval()`. Sin `'unsafe-eval'`
// el navegador bloquea el arranque del cliente y la aplicación se queda congelada en
// la pantalla de carga — con `npm run build` no ocurre, porque React nunca usa `eval()`
// en producción. La excepción vive SOLO en `next dev`: la política que se sirve en
// producción no cambia ni una directiva.
const dev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' ${supabaseHttp} ${supabaseWs} https://flagcdn.com`,
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  // Los navegadores ignoran HSTS sobre http://, así que es inocuo en local.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig = {
  reactStrictMode: true,
  generateBuildId: deterministicBuildId,
  // `next dev` bloquea por defecto los recursos de desarrollo (HMR, flight) pedidos
  // desde un host que no sea el que anuncia, y `http://127.0.0.1:3000` NO es el mismo
  // host que `http://localhost:3000` para esa comprobación. El síntoma es brutal y
  // silencioso: la página se sirve, pero el cliente nunca hidrata y la aplicación se
  // queda congelada en la pantalla de carga. Declarar ambos hosts evita que la demo
  // dependa de cuál de las dos direcciones se escriba en la barra del navegador.
  // Solo afecta a `next dev`: en producción esta opción se ignora.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  ...(desktop
    ? { output: "export", images: { unoptimized: true }, trailingSlash: true }
    : {
        async headers() {
          return [{ source: "/:path*", headers: securityHeaders }];
        },
      }),
};

export default nextConfig;
