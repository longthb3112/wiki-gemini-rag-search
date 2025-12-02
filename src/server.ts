import express, { Request, Response } from "express";
import { getAllWikiPagesWithContent, getRawPagesResponse, getLimitedWikiPages, exportAllWikiPagesToFiles, exportLimitedWikiPagesToFiles } from "./wikiService";
import {
    syncWikiToGeminiRag,
    searchWiki,
    listRagDocuments,
    analyzeImageWithGemini
} from "./geminiService";
import { handleSlackQuestion } from "./slackController";
import { verifySlackSignature } from "./middleware/verfifySlackSignature";
import {rateLimiter} from "./middleware/rateLimiter";

import bodyParser from "body-parser";
import qs from "querystring";

const app = express();
/************************************************************************************
 * 🔐 SLACK ENDPOINT — MUST CAPTURE RAW BODY BEFORE ANY BODY PARSER
 ************************************************************************************/
app.post(
  "/slack",

  // 1️⃣ Capture raw body for signature
  bodyParser.raw({ type: "*/*" }),

  // 2️⃣ Convert raw body to string, verify signature
  (req: any, res, next) => {
    req.rawBody = req.body.toString("utf8");   // Save raw for signature
    next();
  },

  verifySlackSignature,

  // 3️⃣ MANUALLY PARSE Slack urlencoded payload
  (req: any, res, next) => {
    const bodyString = req.rawBody;
    req.body = qs.parse(bodyString); // ← Converts into key/value object
    next();
  },
  rateLimiter,
  // 4️⃣ Handle Slack command
  handleSlackQuestion
);

/************************************************************************************
 * 🌐 NORMAL ROUTES — safe to use JSON body parser after Slack route
 ************************************************************************************/
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));


// ------------------ CUSTOM LOGGER ------------------
import { writeLog } from "./utils/logger";

// Save original console methods
const nativeLog = console.log;
const nativeError = console.error;

console.log = (...args: any[]) => {
    const msg = args.map(a =>
        typeof a === "string" ? a : JSON.stringify(a)
    ).join(" ");

    writeLog(msg);
    nativeLog(...args);
};

console.error = (...args: any[]) => {
    const msg = args.map(a =>
        typeof a === "string" ? a : JSON.stringify(a)
    ).join(" ");

    writeLog("ERROR: " + msg);
    nativeError(...args);
};

// ------------------ HEALTH CHECK ------------------
app.get("/health", (_req, res) => {
    console.log("Health check received");
    res.json({ status: "OK", service: "Wiki RAG Server" });
});

// ------------------ WIKI EXPORT ENDPOINTS ------------------
app.get("/wikis", async (_req: Request, res: Response) => {
    try {
        const pages = await getAllWikiPagesWithContent();
        res.json(pages);
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get("/debug-pages-raw", async (_req: Request, res: Response) => {
    try {
        const raw = await getRawPagesResponse();
        res.json(raw);
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});
/**
 * Test endpoint - returns first 5 wiki pages only
 */
app.get("/wikis/test", async (_req, res) => {
    try {
        const pages = await getLimitedWikiPages(5);
        res.json({
            count: pages.length,
            pages
        });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Export all wiki pages to files for Gemini File Search Tool
 */
app.post("/wikis/export", async (_req, res) => {
    try {
        const result = await exportAllWikiPagesToFiles();
        res.json({
            message: "Wiki pages exported successfully",
            ...result
        });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * TEST: Export only 5 wiki pages to files
 */
app.get("/wikis/export-test", async (_req, res) => {
    try {
        const result = await exportLimitedWikiPagesToFiles(5);
        res.json({
            message: "Test export completed (5 pages)",
            ...result
        });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});


// ------------------ GEMINI RAG ENDPOINTS ------------------

// Sync local wiki files to Gemini RAG store
app.post("/gemini/sync", async (_req, res) => {
    try {
        const result = await syncWikiToGeminiRag();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});


// Query Gemini RAG knowledge base
app.post("/gemini/query", async (req, res) => {
    try {
        const { query , customPrompt } = req.body; 
        if (!query) {
            return res.status(400).json({ error: "Query is required" });
        }
        console.log(req.body);
        const result = await searchWiki(query,customPrompt);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// List all documents currently stored in Gemini RAG
app.get("/gemini/documents", async (_req, res) => {
    try {
        const docs = await listRagDocuments();
        res.json(docs);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// Analyze an image using Gemini's image analysis capabilities
app.post("/gemini/analyze-image", async (req, res) => {
    try {
        const { imagePath } = req.body; 
        if (!imagePath) {
            return res.status(400).json({ error: "imagePath is required" });
        };
        const result = await analyzeImageWithGemini(imagePath);
        res.json({ analysis: result });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }   
});    


// Start the server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));