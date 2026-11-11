export type AssistantMarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] };

type InlinePart = { text: string; bold: boolean };

export function parseAssistantInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const boldPattern = /\*\*([^*\n]+)\*\*|__([^_\n]+)__/g;
  let lastIndex = 0;
  for (const match of text.matchAll(boldPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push({ text: text.slice(lastIndex, index), bold: false });
    parts.push({ text: match[1] ?? match[2] ?? "", bold: true });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex), bold: false });
  return parts.length ? parts : [{ text, bold: false }];
}

function listLine(line: string): { ordered: boolean; text: string } | null {
  const unordered = line.match(/^\s{0,3}[-+*]\s+(.+?)\s*$/);
  if (unordered) return { ordered: false, text: unordered[1] };
  const ordered = line.match(/^\s{0,3}\d+[.)]\s+(.+?)\s*$/);
  return ordered ? { ordered: true, text: ordered[1] } : null;
}

function headingLine(line: string): { level: number; text: string } | null {
  const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
  return match ? { level: match[1].length, text: match[2] } : null;
}

export function parseAssistantMarkdown(markdown: string): AssistantMarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: AssistantMarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trimEnd();
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = headingLine(line);
    if (heading) {
      blocks.push({ type: "heading", ...heading });
      index += 1;
      continue;
    }

    const firstListItem = listLine(line);
    if (firstListItem) {
      const items = [firstListItem.text];
      index += 1;
      while (index < lines.length) {
        const next = listLine(lines[index]);
        if (!next || next.ordered !== firstListItem.ordered) break;
        items.push(next.text);
        index += 1;
      }
      blocks.push({ type: "list", ordered: firstListItem.ordered, items });
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim()) {
      if (headingLine(lines[index]) || listLine(lines[index])) break;
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}
