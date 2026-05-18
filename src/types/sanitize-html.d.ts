// Minimal ambient declarations for sanitize-html — the package ships no
// types and we only use a small slice of its surface (the default
// callable, `simpleTransform`, and `defaults`).
declare module "sanitize-html" {
  type Transformer = (
    tagName: string,
    attribs: Record<string, string>
  ) => { tagName: string; attribs: Record<string, string>; text?: string };

  interface Options {
    allowedTags?: string[] | false;
    allowedAttributes?: Record<string, string[]> | false;
    allowedSchemes?: string[];
    transformTags?: Record<string, Transformer>;
    [key: string]: unknown;
  }

  interface SanitizeHtml {
    (html: string, options?: Options): string;
    simpleTransform(
      newTagName: string,
      newAttribs: Record<string, string>,
      merge?: boolean
    ): Transformer;
    defaults: { allowedTags: string[]; [key: string]: unknown };
  }

  const sanitizeHtml: SanitizeHtml;
  export default sanitizeHtml;
}
