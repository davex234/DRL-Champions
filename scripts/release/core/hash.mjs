/**
 * RELEASE/CORE/HASH — hashing (única implementación; antes duplicado en release-core y changes).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** SHA256 hex de un Buffer/Uint8Array/string. */
export const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** SHA256 hex del contenido de un fichero. */
export const sha256File = (path) => sha256Hex(readFileSync(path));
