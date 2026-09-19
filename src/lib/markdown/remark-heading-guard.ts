/**
 * Fails the build when a Markdown document breaks the heading outline:
 *
 *   - a `#` heading, because the page layout already renders the title as
 *     the one <h1>;
 *   - a skipped level, e.g. `##` followed directly by `####`.
 *
 * Search engines and answer engines read the outline to understand a
 * page's structure, and both mistakes have shipped here before. Walking
 * mdast (not the raw text) means headings inside code fences are ignored.
 */
import type { Root, Heading } from "mdast";
import type { VFile } from "vfile";

export default function remarkHeadingGuard() {
  return (tree: Root, file: VFile) => {
    let previous = 1;
    for (const node of tree.children) {
      if (node.type !== "heading") continue;
      const { depth } = node as Heading;
      const where = node.position ? `line ${node.position.start.line}` : "unknown line";
      if (depth === 1) {
        file.fail(
          `Heading level 1 at ${where}. The layout renders the page title as the only <h1>; use "##" instead.`,
        );
      }
      if (depth > previous + 1) {
        file.fail(
          `Heading jumps from level ${previous} to ${depth} at ${where}. Don't skip levels.`,
        );
      }
      previous = depth;
    }
  };
}
