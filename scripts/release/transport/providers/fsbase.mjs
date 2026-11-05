/**
 * FS-BASE PROVIDER — base compartida de los providers respaldados por un sistema de ficheros
 * (Local y Filesystem comparten TODA la mecánica; solo cambian el nombre y la raíz de destino).
 *
 * Un Provider expone el CONTRATO mínimo que el Transport Engine necesita para mover bytes a un
 * destino, sin conocer su naturaleza (disco local, share de red, bucket, release de GitHub…):
 *
 *   configured() · health() · put() · getBytes() · list() · remove() · copy() · url()
 *
 * `key` es SIEMPRE una ruta relativa al destino, con "/" (p.ej. "stable/latest.json"). Cada
 * canal vive bajo su propio prefijo → aislamiento total entre canales.
 */
import { join, dirname } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { sha256Hex } from "../../core/hash.mjs";

const toAbs = (root, key) => join(root, key.split("/").join("/"));
const ensureParent = (abs) => mkdirSync(dirname(abs), { recursive: true });

/** Crea un provider de filesystem sobre `root`. `requireConfig`: si la raíz debe existir/declararse. */
export function makeFsProvider({ name, root, requireConfig = false, urlBase = null }) {
  return {
    name,
    root,

    configured() {
      // Local siempre disponible (crea la raíz). Filesystem requiere raíz declarada.
      return requireConfig ? !!root : true;
    },

    async health() {
      try {
        if (!root) return { ok: false, detail: `${name}: destino no configurado` };
        mkdirSync(root, { recursive: true });
        // Prueba de escritura/lectura real (no asumimos: lo comprobamos).
        const probe = join(root, ".drl-health");
        writeFileSync(probe, name);
        const ok = readFileSync(probe, "utf8") === name;
        rmSync(probe, { force: true });
        return { ok, detail: ok ? `${name}: escribible (${root})` : `${name}: lectura/escritura inconsistente` };
      } catch (e) {
        return { ok: false, detail: `${name}: ${e.message}` };
      }
    },

    async put({ key, path = null, bytes = null }) {
      const abs = toAbs(root, key);
      ensureParent(abs);
      const buf = bytes ?? readFileSync(path);
      writeFileSync(abs, buf);
      return { key, size: buf.length, sha256: sha256Hex(buf), url: this.url(key) };
    },

    async getBytes(key) {
      const abs = toAbs(root, key);
      return existsSync(abs) ? readFileSync(abs) : null;
    },

    async list(prefix = "") {
      const base = toAbs(root, prefix);
      const out = [];
      const walk = (dir, rel) => {
        if (!existsSync(dir)) return;
        for (const e of readdirSync(dir).sort()) {
          const abs = join(dir, e);
          const r = rel ? `${rel}/${e}` : e;
          if (statSync(abs).isDirectory()) walk(abs, r);
          else out.push({ key: prefix ? `${prefix}/${r}` : r, size: statSync(abs).size });
        }
      };
      walk(base, "");
      return out;
    },

    async remove(key) {
      const abs = toAbs(root, key);
      if (existsSync(abs)) rmSync(abs, { recursive: true, force: true });
    },

    async copy(fromKey, toKey) {
      const from = toAbs(root, fromKey);
      const to = toAbs(root, toKey);
      if (!existsSync(from)) return false;
      ensureParent(to);
      copyFileSync(from, to);
      return true;
    },

    url(key) {
      if (urlBase) return `${urlBase.replace(/\/$/, "")}/${key}`;
      return pathToFileURL(toAbs(root, key)).href;
    },
  };
}

export default { makeFsProvider };
