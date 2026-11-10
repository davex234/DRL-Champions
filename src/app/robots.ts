/**
 * F67 · robots.txt. Por defecto (beta cerrada) NADA se indexa. Con `NEXUS_PUBLIC_INDEXING=1` en el build de la release
 * pública se permite el sitio salvo panel, API y arneses de QA. Se decide en build (página estática).
 */
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  if (process.env.NEXUS_PUBLIC_INDEXING === "1") {
    return { rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/design-system"] } };
  }
  return { rules: { userAgent: "*", disallow: "/" } };
}
