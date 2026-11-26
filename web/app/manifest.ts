import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KeyScrow",
    short_name: "KeyScrow",
    description:
      "Motorbike deposits in escrow on BNB Chain. Rent the motorbike, keep your passport.",
    start_url: "/app",
    display: "standalone",
    background_color: "#0d0b2a",
    theme_color: "#0d0b2a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
