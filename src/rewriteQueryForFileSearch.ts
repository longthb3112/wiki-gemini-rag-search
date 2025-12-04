import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const rewriteModel = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL_TEXT_IMAGE_GENERATION! || "models/gemini-2.5-flash"
});

// Where your synonyms.json lives (output from generateSynonyms)
const SYNONYMS_FILE = path.join(process.cwd(), "config", "synonyms.json");

interface SynonymEntry {
  term: string;
  synonyms: string[];
}

// Load synonyms once
let synonymEntries: SynonymEntry[] = [];
if (fs.existsSync(SYNONYMS_FILE)) {
  synonymEntries = JSON.parse(fs.readFileSync(SYNONYMS_FILE, "utf8"));
  console.log(`🔍 Loaded ${synonymEntries.length} synonym entries for query rewrite.`);
} else {
  console.warn("⚠️ synonyms.json not found; rewrite will work without synonym guidance.");
}

function findRelevantSynonyms(question: string): SynonymEntry[] {
  const lowerQ = question.toLowerCase();
  const matches: SynonymEntry[] = [];

  for (const entry of synonymEntries) {
    const term = entry.term.toLowerCase();

    const termHit = lowerQ.includes(term);
    const synonymHit =
      Array.isArray(entry.synonyms) &&
      entry.synonyms.some(s => lowerQ.includes(s.toLowerCase()));

    if (termHit || synonymHit) {
      matches.push(entry);
    }
  }

  return matches;
}

function buildSynonymContext(entries: SynonymEntry[]): string {
  if (!entries.length) return "None found for this question.";

  return entries
    .map(e => {
      const syns = e.synonyms.join(", ");
      return `- ${e.term}: ${syns}`;
    })
    .join("\n");
}
export async function rewriteUserQuestionForFileSearch(
  originalQuestion: string
): Promise<string> {
  const relevant = findRelevantSynonyms(originalQuestion);
  const synonymContext = buildSynonymContext(relevant);
  
//Build 
const prompt = `
You are a query rewriting assistant for an internal IT documentation search.

Rules:
- You MUST rewrite the user question into a FileSearch-friendly search instruction.
- ALWAYS start with the phrase: Search document title, content, metadata that contains term
- Extract the 3 to 5 most important search terms from the question.
- Include matching synonyms from provided synonym list.
- For every extracted search term or synonym, wrap the term in double quotes.
- Terms must be separated by commas.
- After the list of quoted terms, add a short phrase describing the user's intent
  such as: and summarize how to <user intent>.
- Output MUST be plain text, one sentence only.
- NO markdown. NO JSON. NO bullet points.

Relevant domain terms and synonyms for expansion:
${synonymContext}

User question:
"${originalQuestion}"

Rewrite the instruction now.
`;

  const res = await rewriteModel.generateContent(prompt);
  const rewritten = res.response.text().trim();

  return rewritten;
}