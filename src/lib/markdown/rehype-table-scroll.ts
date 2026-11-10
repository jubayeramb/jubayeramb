/**
 * Wraps every Markdown table in a horizontally scrollable region.
 *
 * A table can't shrink below its longest unbreakable cell (inline code like
 * `Promise.allSettled`), so on a phone it pushed the whole page sideways.
 * Inside the wrapper only the table scrolls. The wrapper is focusable and
 * labelled so keyboard users can scroll it too.
 */
import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";

export default function rehypeTableScroll() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "table" || !parent || index === undefined) return;
      const wrapper: Element = {
        type: "element",
        tagName: "div",
        properties: {
          className: ["table-scroll"],
          tabIndex: 0,
          role: "region",
          ariaLabel: "Table",
        },
        children: [node],
      };
      parent.children[index] = wrapper;
      // Skip the table we just moved inside the wrapper.
      return index + 1;
    });
  };
}
