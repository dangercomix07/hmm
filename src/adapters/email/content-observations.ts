import { convert, type DomNode } from "html-to-text";
import type { ContentObservations, ImagePart } from "../../domain/content-observations.js";
const text = (node: DomNode): string => node.type === "text" ? node.data ?? "" : node.name === "br" ? "\n" : (node.children ?? []).map(text).join("");
export function observeContent(html: string | undefined, imageParts: ImagePart[]): ContentObservations {
  const facts: ContentObservations = { htmlQuote: "none", htmlCodeLines: [], htmlCodeAmbiguous: false, images: [], imageParts, mimeComplete: true };
  if (!html) return facts;
  const output = convert(html, {
    wordwrap: false, limits: { maxInputLength: 2 * 1024 * 1024, maxDepth: 100, ellipsis: "[hmm: observations truncated]" },
    selectors: ["*", "img", "pre", "code", "blockquote", "div", "span", "p", ".gmail_quote", ".yahoo_quoted"].map(selector => ({ selector, format: "observe" })),
    formatters: { observe(node, walk, builder) {
      if (["script", "style", "iframe", "object", "embed"].includes(node.name ?? "")) return;
      const attrs = node.attribs as Record<string, string> | undefined;
      const classes = (attrs?.class ?? "").split(/\s+/);
      if (classes.some(c => ["gmail_quote", "yahoo_quoted"].includes(c)) || node.name === "blockquote" && attrs?.type === "cite") facts.htmlQuote = "clear";
      else if (node.name === "blockquote" && facts.htmlQuote !== "clear") facts.htmlQuote = "ambiguous";
      if (node.name === "img") facts.images.push({ source: attrs?.src ?? "" });
      if (node.name === "pre") {
        const code = text(node).replace(/\r\n/g, "\n").replace(/^\n|\n$/g, "");
        facts.htmlCodeLines.push(code ? code.split("\n").length : 0);
      }
      if (node.name === "code" && node.parent?.name !== "pre" && text(node).includes("\n")) facts.htmlCodeAmbiguous = true;
      walk(node.children ?? [], builder);
    } },
  });
  if (output.includes("[hmm: observations truncated]")) throw new Error("HTML observations exceed supported limit");
  return facts;
}
