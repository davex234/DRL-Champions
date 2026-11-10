/**
 * GITHUB RELEASE PROVIDER — publica los artefactos como assets de una GitHub Release rodante por
 * canal (tag `drl-<channel>`). Reutiliza la CLI `gh` (ya usada en el entorno) vía core/proc, sin
 * añadir dependencias ni credenciales propias: usa `GITHUB_TOKEN`/`GH_TOKEN` y `GITHUB_REPOSITORY`.
 *
 * Como una Release de GitHub tiene assets PLANOS (sin carpetas), la `key` con "/" se aplana a
 * "<canal>__<archivo>" para conservar el aislamiento entre canales dentro del mismo repo.
 */
import { join, basename } from "node:path";
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { capture } from "../../core/proc.mjs";
import { sha256Hex } from "../../core/hash.mjs";

const flat = (key) => key.split("/").join("__");
const ghAvailable = () => capture("gh --version").ok;

export function createGitHubProvider({ env = process.env, root = process.cwd() } = {}) {
  const repo = env.GITHUB_REPOSITORY || env.DRL_PUBLISH_GH_REPO || null;
  const token = env.GITHUB_TOKEN || env.GH_TOKEN || null;
  const tmp = join(root, "dist", ".gh-staging");
  const tagFor = (key) => `drl-${(key.split("/")[0] || "stable")}`;

  return {
    name: "github",
    repo,

    configured() {
      return !!repo && !!token && ghAvailable();
    },

    async health() {
      if (!this.configured()) return { ok: false, detail: "github: faltan gh/token/repo" };
      const r = capture(`gh repo view ${repo} --json name`, { cwd: root });
      return { ok: r.ok, detail: r.ok ? `github: ${repo} accesible` : `github: ${r.out || "no accesible"}` };
    },

    async _ensureRelease(tag) {
      const view = capture(`gh release view ${tag} --repo ${repo}`, { cwd: root });
      if (!view.ok) capture(`gh release create ${tag} --repo ${repo} --title ${tag} --notes "DRL Champions ${tag}"`, { cwd: root });
    },

    async put({ key, path = null, bytes = null }) {
      const tag = tagFor(key);
      await this._ensureRelease(tag);
      mkdirSync(tmp, { recursive: true });
      const asset = join(tmp, flat(key));
      const buf = bytes ?? readFileSync(path);
      writeFileSync(asset, buf);
      const r = capture(`gh release upload ${tag} "${asset}" --repo ${repo} --clobber`, { cwd: root });
      rmSync(asset, { force: true });
      if (!r.ok) throw new Error(`github upload falló: ${r.out}`);
      return { key, size: buf.length, sha256: sha256Hex(buf), url: this.url(key) };
    },

    async getBytes(key) {
      const tag = tagFor(key);
      mkdirSync(tmp, { recursive: true });
      const out = join(tmp, `dl-${flat(key)}`);
      const r = capture(`gh release download ${tag} --repo ${repo} --pattern "${flat(key)}" --output "${out}" --clobber`, { cwd: root });
      if (!r.ok || !existsSync(out)) return null;
      const buf = readFileSync(out);
      rmSync(out, { force: true });
      return buf;
    },

    async list(prefix = "") {
      const tag = tagFor(prefix || "stable");
      const r = capture(`gh release view ${tag} --repo ${repo} --json assets`, { cwd: root });
      if (!r.ok) return [];
      try {
        const assets = JSON.parse(r.out).assets ?? [];
        return assets.map((a) => ({ key: a.name.split("__").join("/"), size: a.size }));
      } catch { return []; }
    },

    async remove(key) {
      const tag = tagFor(key);
      capture(`gh release delete-asset ${tag} ${flat(key)} --repo ${repo} --yes`, { cwd: root });
    },

    async copy(fromKey, toKey) {
      const buf = await this.getBytes(fromKey);
      if (!buf) return false;
      await this.put({ key: toKey, bytes: buf });
      return true;
    },

    url(key) {
      return `https://github.com/${repo}/releases/download/${tagFor(key)}/${flat(key)}`;
    },
  };
}

export default { createGitHubProvider };
