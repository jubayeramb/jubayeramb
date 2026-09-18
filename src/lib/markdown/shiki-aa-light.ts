import type { ShikiConfig } from "astro";

type ShikiTransformer = NonNullable<ShikiConfig["transformers"]>[number];

/**
 * github-light has four token colors under 4.5:1 on our light code surface
 * (--code-surface). Swap each for the nearest shade of the same hue that
 * clears AA; the dark theme is untouched.
 */
const REPLACEMENTS: Record<string, string> = {
  "#6A737D": "#5A636E", // comments
  "#E36209": "#B04800", // orange: list markers, params
  "#22863A": "#1B7C34", // green: tags, inserted
  "#D73A49": "#C4303F", // red: keywords
};

export const shikiAaLight: ShikiTransformer = {
  name: "aa-light",
  span(node) {
    const style = node.properties.style;
    if (typeof style !== "string") return;
    node.properties.style = style.replace(
      /--shiki-light:(#[0-9A-Fa-f]{6})/,
      (_, hex: string) => `--shiki-light:${REPLACEMENTS[hex.toUpperCase()] ?? hex}`,
    );
  },
};
