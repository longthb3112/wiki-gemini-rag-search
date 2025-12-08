// geminiService.ts (Safe, Idempotent, No-Duplicate Version)

import fs from "fs";
import path from "path";
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import {rewriteUserQuestionForFileSearch} from "./rewriteQueryForFileSearch";
import crypto from "crypto";
import { generateSynonyms } from "./optimizeExtractSynonyms";

// ================= CONFIG =================

const DATASET_NAME = process.env.DATASET_NAME || "IT_Wiki";
const FILES_DIR = path.join(process.cwd(), "config", "wiki-files");
const IMAGES_DIR = path.join(process.cwd(), "config", "wiki-images");
const IMAGE_HASH_FILE = path.join(process.cwd(), "config", "image-hash-cache.json");
const SYNONYMS_FILE = path.join(process.cwd(), "config","synonyms.json");
interface SynonymConfig {
  term: string;
  synonyms: string[];
}
interface FileSearchPart {
  fileSearchResults?: unknown;
}

// Load once at startup
const synonymConfigs: SynonymConfig[] = fs.existsSync(SYNONYMS_FILE)
  ? JSON.parse(fs.readFileSync(SYNONYMS_FILE, "utf8"))
  : [];


let ai: GoogleGenAI;
let syncRunning = false; // prevents parallel execution

// ================= UTILITIES =================
function getImageHash(filePath: string): string {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash("md5").update(buffer).digest("hex");
}

function loadHashCache(): Record<string, string> {
    if (!fs.existsSync(IMAGE_HASH_FILE)) return {};
    return JSON.parse(fs.readFileSync(IMAGE_HASH_FILE, "utf8"));
}

function saveHashCache(cache: Record<string, string>) {
    fs.writeFileSync(IMAGE_HASH_FILE, JSON.stringify(cache, null, 2), "utf8");
}
function clearImageHashCache() {
    if (fs.existsSync(IMAGE_HASH_FILE)) {
        fs.unlinkSync(IMAGE_HASH_FILE);
        console.log("🧹 Image hash cache cleared");
    }
}
function generateGuid(): string {
    return crypto.randomUUID(); // Node 16+
}
function getSynonymsForContent(content: string): string[] {
  const lower = content.toLowerCase();
  const found = new Set<string>();

  for (const entry of synonymConfigs) {
    const termLower = entry.term.toLowerCase();

    const termInText = lower.includes(termLower);
    const synonymInText =
      Array.isArray(entry.synonyms) &&
      entry.synonyms.some(s => lower.includes(s.toLowerCase()));

    // If doc mentions the term OR any of its synonyms → attach the whole cluster
    if (termInText || synonymInText) {
      found.add(termLower);
      if (Array.isArray(entry.synonyms)) {
        entry.synonyms.forEach(s => found.add(s.toLowerCase()));
      }
    }
  }

  return Array.from(found);
}
function chunkSynonyms(
  synonyms: string[],
  maxLen = 255
): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const syn of synonyms) {
    const trimmed = syn.trim();
    if (!trimmed) continue;

    const addition = (current ? ", " : "") + trimmed;

    // If adding this synonym would exceed limit, start a new chunk
    if (current.length + addition.length > maxLen) {
      if (current) {
        chunks.push(current);
      }
      // If a single synonym is longer than maxLen (rare), just push it alone
      if (trimmed.length > maxLen) {
        chunks.push(trimmed.slice(0, maxLen));
        current = "";
      } else {
        current = trimmed;
      }
    } else {
      current += addition;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}
// ================= INIT =================

export function initializeGemini() {
    if (!ai) {
        ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    }
}

// ================= STORE HELPERS =================

export async function findRagStoreByDisplayName(displayName: string) {
    const storesPager = await ai.fileSearchStores.list();
    for await (const store of storesPager) {
        if (store.displayName === displayName) return store;
    }
    return null;
}

export async function getOrCreateRagStore(): Promise<string> {
    const existingStore = await findRagStoreByDisplayName(DATASET_NAME);
    if (existingStore?.name) return existingStore.name;

    const newStore = await ai.fileSearchStores.create({
        config: { displayName: DATASET_NAME }
    });

    if (!newStore.name) throw new Error("Failed to create RAG store");
    return newStore.name;
}

// ================= IMAGE → PAGE MAPPING =================

function buildImagePageMap(): Record<string, string> {
    const map: Record<string, string> = {};
    if (!fs.existsSync(FILES_DIR)) return map;

    const textFiles = fs.readdirSync(FILES_DIR).filter(f => f.endsWith(".json"));

    for (const file of textFiles) {
        const json = JSON.parse(fs.readFileSync(path.join(FILES_DIR, file), "utf8"));
        const pagePath = json.title || json.path || json.source || file;
        const content = json.content || "";


        const regex = /!\[[^\]]*]\(([^)]+)\)/g;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(content)) !== null) {
            const imageName = path.basename(match[1]);
            if (imageName) map[imageName] = pagePath;
        }
    }
    return map;
}

// ================= IMAGE ANALYSIS =================
export async function analyzeImageWithGemini(imagePath: string): Promise<string> {
    initializeGemini();

    const buffer = fs.readFileSync(imagePath);
    const base64 = buffer.toString("base64");
    const ext = path.extname(imagePath).toLowerCase();

    // Auto-detect MIME type
    const mimeMap: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".bmp": "image/bmp",
        ".webp": "image/webp",
        ".tif": "image/tiff",
        ".tiff": "image/tiff"
    };

    const mimeType = mimeMap[ext] || "image/png";

    try {
        const response = await ai.models.generateContent({
            model: process.env.GEMINI_MODEL_TEXT_IMAGE_GENERATION || "gemini-2.5-flash-lite",
            contents: [{
                role: "user",
                parts: [
                    {
                        text: `
                            You are in OCR+Summary mode.

                            Extract **two things** from this image:

                            1. A short summary (2–3 sentences) describing what the image shows. Remove all patient information.
                            2. All readable text from the image (OCR).

                            Return STRICT JSON ONLY:

                            {
                            "summary": "...",
                            "ocr": "..."
                            }
                            `
                    },
                    { inlineData: { mimeType, data: base64 } }
                ]
            }]
        });

        const output = response.text || "";

        // Validate that output is JSON
        try {
            JSON.parse(output);
            return output;   // return as JSON string
        } catch {
            // Fallback: wrap raw text into JSON if model hallucinated slightly
            return JSON.stringify({
                summary: "Parsing failed; raw output returned.",
                ocr: output
            }, null, 2);
        }

    } catch (err: any) {
        console.log(err);
        console.error("Gemini OCR error:", err.message || err);
        return JSON.stringify({
            summary: "",
            ocr: "",
            error: err.message || "Unknown error"
        }, null, 2);
    }
}

// ================= UPLOAD =================

async function uploadTextToRag(
    storeName: string,
    content: string,
    filename: string,
    metadata: any[]
) {
    const buffer = Buffer.from(content, "utf8");

    const uniqueId = crypto.randomUUID();
    const safeFilename = `${filename}`;

    console.log(`⬆ Uploading to RAG:
                File: ${safeFilename}
                Size: ${buffer.length} bytes
                Metadata: ${JSON.stringify(metadata)}
                Store: ${storeName}`);

    try {
        const response = await ai.fileSearchStores.uploadToFileSearchStore({
            fileSearchStoreName: storeName,
            file: new File([buffer], safeFilename, { type: "text/plain" }),
            config: {
                displayName: safeFilename,
                mimeType: "text/plain",
                customMetadata: metadata
            }
        });

        console.log("✅ Upload successful:", {
            displayName: safeFilename,
            store: storeName,
            response
        });

        return response;

    } catch (error: any) {
        console.error("❌ Upload FAILED for:", safeFilename);

        if (error?.response) {
            console.error("🔴 Gemini API Response:");
            console.error(JSON.stringify(error.response, null, 2));
        }

        if (error?.message) {
            console.error("🔴 Error message:", error.message);
        }

        if (error?.stack) {
            console.error("🔴 Stack trace:");
            console.error(error.stack);
        }

        throw error; // rethrow so sync can handle it if needed
    }
}

// ================= IMAGE PROCESSOR =================
export async function processImagesToRag(storeName: string) {
    const imagePageMap = buildImagePageMap();
    const images = fs.readdirSync(IMAGES_DIR).filter(f => /\.(png|jpg|jpeg|gif)$/i.test(f));

    let uploadedImages = 0;
    const hashCache = loadHashCache();
    const processedInThisRun = new Set<string>();

    for (const image of images) {

        if (processedInThisRun.has(image)) {
            console.warn(`⚠ Runtime duplicate skipped: ${image}`);
            continue;
        }
        processedInThisRun.add(image);

        const imgPath = path.join(IMAGES_DIR, image);
        const hash = getImageHash(imgPath);

        if (hashCache[image] === hash) {
            console.log(`⏭ Skipped duplicate image (hash match): ${image}`);
            continue;
        }

        console.log(`🖼 Analysing image: ${image}`);

        try {
            const description = await analyzeImageWithGemini(imgPath);
            const sourcePage = imagePageMap[image] || "Unknown";

            const content =
                `SOURCE PAGE: ${sourcePage}\n` +
                `IMAGE: ${image}\n\n` +
                `DESCRIPTION:\n${description}`;

            const outputName = image.replace(/\.(png|jpg|jpeg|gif)$/i, ".txt");
            const guid = generateGuid();
            await uploadTextToRag(storeName, content, outputName, [
                { key: "type", stringValue: "wiki-image" },
                { key: "source_page", stringValue: sourcePage },
                { key: "image_name", stringValue: image + "-" + guid },
                { key: "image_guid", stringValue: guid } // ✅ unique lightweight identifier
            ]);

            hashCache[image] = hash;
            saveHashCache(hashCache);
            uploadedImages++;

        } catch (err: any) {
            console.error(`💥 Failed to process image ${image}:`, err?.message || err);
        }
    }

    return { uploadedImages, store: storeName };
}

// ================= MASTER SYNC =================
async function SetUpFileSearchStore() {
    // ================= DELETE OLD STORE =================

    const existingStore = await findRagStoreByDisplayName(DATASET_NAME);

    if (existingStore?.name) {
        console.log(`🗑 Deleting existing RAG store: ${DATASET_NAME}`);
        await ai.fileSearchStores.delete({
            name: existingStore.name,
            config: { force: true }
        });
    }

    // ================= CREATE NEW STORE =================

    const newStore = await ai.fileSearchStores.create({
        config: { displayName: DATASET_NAME }
    });

    if (!newStore.name) {
        throw new Error("Failed to create new RAG store");
    }
    console.log(`✅ New RAG store created: ${newStore.name}`);
    return newStore.name;
}
export async function syncWikiToGeminiRag() {
    if (syncRunning) {
        console.warn("⚠ Sync already running. Skipping duplicate call.");
        return;
    }

    syncRunning = true;
    initializeGemini();

    console.log("🚀 Starting full Wiki → Gemini RAG sync (text + images)...");

    try {
        // ================= VALIDATION FIRST =================

        if (!fs.existsSync(FILES_DIR)) {
            throw new Error(`Wiki export folder not found: ${FILES_DIR}`);
        }

        const textFiles = fs.readdirSync(FILES_DIR).filter(f => f.endsWith(".json"));

        if (textFiles.length === 0) {
            throw new Error(
                "No wiki text files found. Aborting Gemini sync to protect store."
            );
        }

        // ✅ Only after validation we touch the store
        console.log("🧹 Clearing image hash cache...");
        clearImageHashCache();

        // ================= SETUP STORE =================
        const storeName = await SetUpFileSearchStore();

        await generateSynonyms(); // refresh synonyms before upload

        // ================= UPLOAD TEXT FILES =================
        let textFilesUploaded = 0;
        for (const file of textFiles) {
            const json = JSON.parse(fs.readFileSync(path.join(FILES_DIR, file), "utf8"));
            const content = `TITLE: ${json.title} \nSOURCE: ${json.source} \n\n${json.content} `;
            const synonyms = getSynonymsForContent(content);

            const metadata: { key: string; stringValue: string }[] = [
                { key: "type", stringValue: "wiki-text" },
                { key: "wiki_title", stringValue: json.title },
                { key: "wiki_file", stringValue: file }
            ];
            
           const MAX_SYNONYM_GROUPS = 15; // metadata limit safety
           if (synonyms.length > 0) {
                const synonymChunks = chunkSynonyms(synonyms).slice(0, MAX_SYNONYM_GROUPS); // enforce max allowed
                synonymChunks.forEach((chunk, index) => {
                    metadata.push({
                    key: index === 0 ? "synonyms" : `synonyms_${index + 1}`,
                    stringValue: chunk
                    });
                });
            }

            await uploadTextToRag(storeName, content, file, metadata);
            textFilesUploaded++;
        }

        // ================= UPLOAD IMAGE FILES =================
    
            const imagesProcessed = await processImagesToRag(storeName);       
            console.log("✅ Sync complete. Images processed:", imagesProcessed);

       
   
        return {
            message: "IT_Wiki RAG store updated",
            textFilesUploaded,
            imageFilesUploaded: imagesProcessed.uploadedImages, 
            store: storeName
        };

    } catch (err) {
        console.error("🔥 Gemini sync error:", err);
    } finally {
        syncRunning = false;
    }
}
// ================= SEARCH =================
function extractText(response: any): string {
  const parts =
    response?.candidates?.[0]?.content?.parts ?? [];

  return parts
    .map((p: any) => p.text || "")
    .join("\n");
}

export async function searchWiki(query: string, customPrompt: string = "") {
    initializeGemini();
    

    const store = await findRagStoreByDisplayName(DATASET_NAME);
    if (!store?.name) throw new Error(`RAG store ${DATASET_NAME} not found`);

    const rewriteQuestion = await rewriteUserQuestionForFileSearch(query);

  
    const systemInstructionPrompt = customPrompt != "" ? customPrompt : `You are an expert IT knowledge assistant for internal wiki documentation queries. Your primary directive is to provide comprehensive, accurate, and well-structured answers strictly based on the company's wiki documentation provided by the File Search tool.
        RULES AND WORKFLOW:

        1️⃣ Always call fileSearch BEFORE answering.
        2️⃣ Answer ONLY using retrieved wiki content.
        3️⃣ ALWAYS rewrite in your own words. Do NOT copy content or lists verbatim.
        4️⃣ Keep the final answer under 250 words.
        5️⃣ If nothing is found, reply: "I could not find information about this in the wiki."

        FORMAT:
        - Clear section headers
        - Bullet lists
        - Numbered steps
        - **Bold** for emphasis
        - No citations, no file names, no paths, no headings from wiki
        At the very end of your response, list "Relevant Wiki Pages" using the exact titles of the cited documents.`
    
    let retryCounter = 1;
    while(retryCounter >= 0) {
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: process.env.GEMINI_MODEL_QA || "gemini-2.5-flash",
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            text: rewriteQuestion
                        }
                    ]
                }],
            config: {
               systemInstruction: {               
                parts: [{ text: systemInstructionPrompt }]
                },
                tools: [
                    {
                        fileSearch: {
                            fileSearchStoreNames: [store.name]
                        }
                    }
                ],          
            }
        });
        var answerText = extractText(response);
        if (answerText && answerText.trim().length > 0) {
            if(process.env.DEBUG_LOGS === "1"){
                console.log("🧠 Gemini raw response:", JSON.stringify(response, null, 2));
            }
           
            retryCounter = -1;
            return { answer: answerText || "No answer found." };
        }
     
        setTimeout(() => {}, 1000); // brief pause before retry
        retryCounter--;
    }
    return { answer: "No answer found." };
}

// ================= DOCUMENT LIST =================

export async function listRagDocuments() {
    initializeGemini();

    const store = await findRagStoreByDisplayName(DATASET_NAME);
    if (!store?.name) throw new Error("RAG store not found");

    const docsPager = await ai.fileSearchStores.documents.list({
        parent: store.name,
        config: {
            'pageSize': 10,
        },
    });
    const docs = [];

    for await (const doc of docsPager) {
        docs.push({
            name: doc.name,
            displayName: doc.displayName,
            metadata: doc.customMetadata,
        });
    }

    console.log("📦 Total documents:", docs.length);
    return docs;
}

