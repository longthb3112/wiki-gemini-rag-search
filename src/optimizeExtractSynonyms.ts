import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Cheaper model still
const model = ai.getGenerativeModel({
    model: process.env.GEMINI_MODEL_QA! || "models/gemini-2.5-flash"
});

const WIKI_JSON_DIR = path.join(process.cwd(), "config", "wiki-files");
const OUTPUT_FILE = path.join(process.cwd(), "config", "synonyms.json");

// token usage (beware of costs and limits)
const MAX_CHARS_PER_BATCH = 20000;

interface SynonymEntry {
    term: string;
    synonyms: string[];
    sources?: string[];
}

// 🧹 Remove markdown + junk syntax
function cleanWikiText(text: string): string {
    return text
        .replace(/!\[.*?\]\(.*?\)/g, "")              // remove image markdown
        .replace(/\[.*?\]\(.*?\)/g, "")               // remove links
        .replace(/\[\[_.*?_\]\]/g, "")               // remove TOC macros
        .replace(/`([^`]+)`/g, "$1")                 // remove code ticks
        .replace(/#+\s?/g, "")                       // remove markdown headings
        .replace(/\s+/g, " ")                        // normalize whitespace
        .trim();
}

async function extractBatch(batch: { name: string; text: string }[], attempt = 1): Promise<SynonymEntry[]> {
    console.log(`🔍 Extracting batch of ${batch.length} files (attempt ${attempt})`);

    const combined = batch
        .map(b => `SOURCE: ${b.name}\n${b.text}`)
        .join("\n\n");
    //Custom this prompt to ouput for your specific use case
    const prompt = `
You are analyzing internal technical documentation related to IT software development.

Your task:
1️⃣ Extract important TECHNICAL TERMS and CONCEPTS a developer/support engineer would search for.
2️⃣ Include MULTI-WORD concepts (e.g., "restart container", "push remote branch", "order sync logic").
3️⃣ Include synonyms, variants, acronyms, abbreviations, common search terms users might type.
4️⃣ Focus on:
   - Software architecture & components
   - Application development (backend + frontend)
   - Web development, hosting, frameworks
   - DevOps & CI/CD pipelines
   - Deployment strategies (containers, IIS, cloud)
   - APIs & system integrations
   - Database objects and sync workflows
5️⃣ Prefer:
   - Actionable + searchable terminology (task verbs + systems)
   - System names, service names, key database entities
   - Troubleshooting/workflow terminology

STRICT DATA CLEANUP RULES:
❌ DO NOT include entries where synonyms array is empty  
❌ DO NOT include synonyms that equal the term  
❌ DO NOT include blank terms  
❌ Deduplicate and lowercase all synonyms  
✔ Only include entries where synonyms.length > 0

OUTPUT FORMAT (STRICT JSON, NO markdown fences):
[
  {
    "term": "string",
    "synonyms": ["string1", "string2"]
  }
]

CONTENT:
${combined}
`;

    // 🚨 Timeout wrapper (180s max per request for extracting)
    const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("⏱️ Gemini timeout")), 180000)
    );

    try {
        const res = await Promise.race([
            model.generateContent(prompt),
            timeout
        ]);

        const raw = res.response.text().trim();

        try {
            return JSON.parse(raw);
        } catch {
            const cleaned = raw.replace(/```json|```/g, "").trim();
            return JSON.parse(cleaned);
        }
    } catch (error: any) {
        console.error(`⚠️ Batch request failed: ${error.message}`);

        // 🔁 Retry once then skip
        if (attempt < 2) {
            console.log("↻ Retrying batch once...");
            return extractBatch(batch, attempt + 1);
        }

        console.error("❌ Giving up on this batch");
        return []; // Avoid infinite waiting
    }
}

function splitDocIntoChunks(doc: { name: string; text: string }) {
    const chunks: { name: string; text: string }[] = [];
    let start = 0;
    let index = 1;

    while (start < doc.text.length) {
        const chunkText = doc.text.slice(start, start + MAX_CHARS_PER_BATCH);
        chunks.push({
            name: `${doc.name}#${index}`,
            text: chunkText
        });
        start += MAX_CHARS_PER_BATCH;
        index++;
    }
    return chunks;
}
export async function generateSynonyms(): Promise<SynonymEntry[] | null> {
    try {
        console.log("🧹 Removing old synonyms.json if exists...");
        if (fs.existsSync(OUTPUT_FILE)) {
            fs.unlinkSync(OUTPUT_FILE);
            console.log("🗑️ Old synonyms.json removed.");
        }

        console.log("📂 Reading wiki files...");
        const files = fs.readdirSync(WIKI_JSON_DIR).filter(f => f.endsWith(".json"));
        console.log(`📑 Found ${files.length} wiki pages.`);

        const wikiDocs: { name: string; text: string }[] = [];

        for (const [i, file] of files.entries()) {
            try {
                const json = JSON.parse(
                    fs.readFileSync(path.join(WIKI_JSON_DIR, file), "utf8")
                );

                const content = cleanWikiText(json.content || "");

                if (content.length > 20) {
                    wikiDocs.push({ name: file, text: content });
                }
                console.log(`➡️ Loaded ${i + 1}/${files.length}: ${file}`);
            } catch (err) {
                console.error(`⚠️ Failed processing file: ${file}`, err);
            }
        }

        console.log(`📚 ${wikiDocs.length} docs with real content`);

        const results: SynonymEntry[] = [];
        let batch: { name: string; text: string }[] = [];
        let size = 0;
        let processed = 0;

        for (const doc of wikiDocs) {
            const docsToInsert =
                doc.text.length > MAX_CHARS_PER_BATCH
                    ? splitDocIntoChunks(doc)
                    : [doc];

            for (const sub of docsToInsert) {
                if (size + sub.text.length > MAX_CHARS_PER_BATCH) {
                    try {
                        const batchResult = await extractBatch(batch);
                        results.push(...batchResult);
                    } catch (err) {
                        console.error("❌ Failed extracting batch:", err);
                    }

                    processed += batch.length;
                    console.log(`✅ Processed ${processed}/${wikiDocs.length} docs`);

                    batch = [];
                    size = 0;
                    await new Promise(res => setTimeout(res, 5000));
                }

                batch.push(sub);
                size += sub.text.length;
            }
        }

        // Final batch
        if (batch.length > 0) {
            try {
                const batchResult = await extractBatch(batch);
                results.push(...batchResult);
            } catch (err) {
                console.error("❌ Failed extracting final batch:", err);
            }
            processed += batch.length;
            console.log(`🎯 Final batch processed → ${processed}/${wikiDocs.length}`);
        }

        console.log("📊 Deduping & cleaning extracted terms...");

        const map = new Map<string, Set<string>>();

        for (const entry of results) {
            if (!entry || !entry.term) continue;

            const term = entry.term.trim().toLowerCase();
            if (!term) continue;

            if (!map.has(term)) map.set(term, new Set());

            if (Array.isArray(entry.synonyms)) {
                entry.synonyms
                    .map(s => s.trim().toLowerCase())
                    .filter(s => s.length > 0 && s !== term)
                    .forEach(s => map.get(term)!.add(s));
            }
        }

        const finalOutput = Array.from(map.entries())
            .map(([term, syns]) => ({
                term,
                synonyms: Array.from(syns)
            }))
            .filter(x => Array.isArray(x.synonyms) && x.synonyms.length > 0);

        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalOutput, null, 2));

        console.log("✨ Synonym extraction complete!");
        console.log(`📌 Total Terms: ${finalOutput.length}`);
        console.log(`🔗 Terms w/ synonyms: ${finalOutput.filter(x => x.synonyms.length > 0).length}`);
        console.log(`📁 Output saved at: ${OUTPUT_FILE}`);
        console.log("🏁 Done.\n");

        return finalOutput;
    } catch (error) {
        console.error("🚨 Fatal error in generateSynonyms():", error);
        return null;
    }
}