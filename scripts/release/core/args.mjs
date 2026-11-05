/**
 * RELEASE/CORE/ARGS — parser de argumentos CLI (única implementación; antes `opt/has` y `arg`).
 */
export function parseArgs(argv = process.argv.slice(2)) {
  const has = (flag) => argv.includes(`--${flag}`);
  const opt = (name, def = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
  };
  return { has, opt, argv };
}
