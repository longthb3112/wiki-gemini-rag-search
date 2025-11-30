export function normalizeAzureDevOpsFormatting(text: string): string {
  if (!text) return text;

  let result = text;

  // Convert escaped newlines to real line breaks
  result = result.replace(/\\n/g, '\n');

  // Fix cases like ** Agent** -> *Agent*
  result = result.replace(/\*\*\s*(.*?)\s*\*\*/g, '*$1*');

  // Fix broken bold mixed with slashes like *Release/** pattern
  result = result.replace(/\*([^*\n]+?)\/\*\*/g, '*$1*');

  // Standard bold: **text** -> *text*
  result = result.replace(/\*\*(.*?)\*\*/g, '*$1*');

  // Underline simulation: __text__ -> _text_
  result = result.replace(/__(.*?)__/g, '_$1_');

  // Strikethrough: ~~text~~ -> ~text~
  result = result.replace(/~~(.*?)~~/g, '~$1~');

  // Headings: # Title -> *Title*
  result = result.replace(/^#+\s*(.*)$/gm, '*$1*');

  // Normalize bullet points for Slack
  result = result.replace(/^- /gm, '• ');

  // ✅ FINAL CLEANUP (removes stray formatting artifacts)
  result = result
    .replace(/\/\*{2,}/g, '')   // removes /**, /***, etc
    .replace(/\*{2,}/g, '')     // removes ** or ***
    .replace(/_{2,}/g, '')      // removes __
    .replace(/~{2,}/g, '');     // removes ~~ leftovers

  return result.trim();
}

export function parseGeminiResponse(raw: any) {
  const safe = normalizeAzureDevOpsFormatting(raw.answer?.trim() || "No answer found.");
  return { answer: safe };
}