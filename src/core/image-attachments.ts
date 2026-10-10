import type { ContentObservations } from "../domain/content-observations.js";
import type { RuleResult } from "../domain/evaluation.js";
const cid = (value: string) => value.replace(/^cid:/i, "").replace(/^<|>$/g, "");
/** Metadata matching only. An inline MIME part is not an attachment unless disposition says so. */
export function imageAttachmentStatus(facts: ContentObservations | undefined, body: string): RuleResult["result"] {
  if (!facts) return /!\[[^\]]*\]\s*\(|<img\b|!\[[^\]]*\]\s*\[/i.test(body) ? "UNCERTAIN" : "PASS";
  if (!facts.mimeComplete) return "UNCERTAIN";
  const parts = facts.imageParts;
  const references = [...new Set(facts.images.map(i => i.source))];
  const inlines: { filename: string | null; contentId?: string }[] = [];
  const usedInline = new Set<number>();
  for (const source of references) {
    if (!source) return "UNCERTAIN";
    if (/^cid:/i.test(source)) {
      let id: string; try { id = cid(decodeURIComponent(source)); } catch { return "UNCERTAIN"; }
      const matches = parts.map((p, i) => ({ p, i })).filter(({ p }) => p.contentId && cid(p.contentId) === id);
      if (matches.length !== 1) return "UNCERTAIN";
      inlines.push(matches[0]!.p); usedInline.add(matches[0]!.i);
    } else inlines.push({ filename: null }); // No remote fetch or filename guess from a URL.
  }
  parts.forEach((p, i) => { if (p.disposition === "inline" && !usedInline.has(i)) inlines.push(p); });
  if (!inlines.length) return "PASS";
  const attachments = parts.filter(p => p.disposition === "attachment" && p.size > 0);
  if (parts.some(p => !["inline", "attachment"].includes(p.disposition ?? ""))) return "UNCERTAIN";
  if (!attachments.length) return "FAIL";
  const names = inlines.map(i => i.filename).filter(Boolean);
  if (new Set(names).size !== names.length) return "UNCERTAIN";
  const available = new Set(attachments.map((_, i) => i));
  const unmatched: typeof inlines = [];
  for (const image of inlines) {
    const matchBy = (predicate: (p: typeof attachments[number]) => boolean) => [...available].filter(i => predicate(attachments[i]!));
    let candidates = image.filename ? matchBy(p => p.filename === image.filename) : [];
    if (!candidates.length && image.contentId) candidates = matchBy(p => Boolean(p.contentId) && cid(p.contentId!) === cid(image.contentId!));
    if (candidates.length > 1) return "UNCERTAIN";
    if (candidates.length === 1) available.delete(candidates[0]!);
    else unmatched.push(image);
  }
  if (!unmatched.length) return "PASS";
  if (unmatched.length > available.size) return "FAIL";
  // Count fallback is permitted only when neither side offers an exact identity to compare.
  if (unmatched.every(i => !i.filename && !i.contentId) && [...available].every(i => !attachments[i]!.filename && !attachments[i]!.contentId)) return "PASS";
  if (unmatched.every(i => i.filename) && [...available].every(i => attachments[i]!.filename)) return "FAIL";
  return "UNCERTAIN";
}
