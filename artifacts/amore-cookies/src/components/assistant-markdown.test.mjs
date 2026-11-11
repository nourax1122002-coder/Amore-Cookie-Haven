import assert from "node:assert/strict";
import test from "node:test";
import { parseAssistantInline, parseAssistantMarkdown } from "./assistant-markdown.ts";

test("parses headings, paragraphs, and unordered and ordered lists", () => {
  const blocks = parseAssistantMarkdown(
    "# Cookie tips\n\nBake from frozen.\nKeep the oven warm.\n\n- Preheat\n- Bake\n\n1. Cool\n2. Serve",
  );
  assert.deepEqual(blocks, [
    { type: "heading", level: 1, text: "Cookie tips" },
    { type: "paragraph", text: "Bake from frozen. Keep the oven warm." },
    { type: "list", ordered: false, items: ["Preheat", "Bake"] },
    { type: "list", ordered: true, items: ["Cool", "Serve"] },
  ]);
});

test("renders Arabic and English bold spans without retaining markdown markers", () => {
  assert.deepEqual(parseAssistantInline("Bake **from frozen** ثم **اخبزيها**."), [
    { text: "Bake ", bold: false },
    { text: "from frozen", bold: true },
    { text: " ثم ", bold: false },
    { text: "اخبزيها", bold: true },
    { text: ".", bold: false },
  ]);
});
