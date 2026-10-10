export interface SectionDefinition { name: string; aliases: string[] }
export interface UpdateSection { name: string; heading: string; content: string; line: number; known: boolean }
export interface SectionParse { original: string; sections: UpdateSection[]; issues: string[] }
export const sectionKey = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();
/** Exact configured names/aliases only. No fuzzy matching or rewriting. Fenced code is content. */
export function parseSections(original: string, definitions: SectionDefinition[]): SectionParse {
  const parsed: SectionParse = { original, sections: [], issues: [] };
  if (original.length > 100_000) { parsed.issues.push("Update exceeds the supported parsing size of 100000 characters."); return parsed; }
  const names = new Map<string, string>();
  for (const d of definitions) for (const n of [d.name, ...d.aliases]) names.set(sectionKey(n), d.name);
  let current: UpdateSection | undefined;
  let fence: string | undefined;
  const lines = original.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!; const trimmed = line.trim();
    const marker = /^(`{3,}|~{3,})/.exec(trimmed)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && trimmed === marker) fence = undefined;
      if (current) current.content += line + "\n";
      else parsed.issues.push(`Content before the first section at line ${i + 1}.`);
      continue;
    }
    if (fence) { if (current) current.content += line + "\n"; continue; }
    const markdown = /^#{1,6}\s+(.+?)(?:\s+#+)?$/.exec(trimmed);
    const colon = /^([^:#\n]{1,80}):$/.exec(trimmed);
    const candidate = (markdown?.[1] ?? colon?.[1] ?? trimmed).replace(/:$/, "");
    const known = names.get(sectionKey(candidate));
    const heading = Boolean(markdown || colon || known);
    if (/^#/.test(trimmed) && !markdown || /^[:#]+$/.test(trimmed)) parsed.issues.push(`Malformed heading at line ${i + 1}.`);
    if (heading) {
      current = { name: known ?? candidate, heading: line, content: "", line: i + 1, known: Boolean(known) };
      parsed.sections.push(current);
    } else if (current) current.content += line + "\n";
    else if (trimmed) parsed.issues.push(`Content before the first section at line ${i + 1}.`);
  }
  if (fence) parsed.issues.push("Unclosed code fence.");
  return parsed;
}
