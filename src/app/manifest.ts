import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DRL Champions",
    short_name: "DRL",
    description: "Juego de cartas coleccionables de Valorant.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#06070d",
    theme_color: "#06070d",
    lang: "es",
    categories: ["games", "entertainment"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Abrir sobres", short_name: "Tienda", url: "/tienda" },
      { name: "Mi colección", short_name: "Colección", url: "/coleccion" },
      { name: "Eventos", short_name: "Eventos", url: "/eventos" },
    ],
  };
}
