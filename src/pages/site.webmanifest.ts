import type { APIRoute } from "astro";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify(
      {
        name: SITE_NAME,
        short_name: "Jubayer",
        description: SITE_DESCRIPTION,
        start_url: "/",
        scope: "/",
        display: "browser",
        // Matches --canvas (light) in src/styles/tokens.css.
        background_color: "#f6f8fb",
        theme_color: "#f6f8fb",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      null,
      2,
    ),
    { headers: { "content-type": "application/manifest+json; charset=utf-8" } },
  );
