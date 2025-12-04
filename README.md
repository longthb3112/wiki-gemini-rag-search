# 🧠 Wiki RAG Search System

A robust **Retrieval-Augmented Generation (RAG)** search system that brings **intelligence** to internal documentation — especially **Azure DevOps Wiki**. It retrieves wiki content using **[Gemini’s FileSearchStore](https://blog.google/technology/developers/file-search-gemini-api/)** and applies **synonym-based query rewriting** to ensure accurate and complete results even when users use varied language.

 💡 Built for **Slack-first enterprise knowledge search** 💡

# 🧠 System workflow
```
flowchart
    A[Slack Command / API Request] --> B[Rewrite Query with Synonyms]
    B --> C[Gemini FileSearch Tool]
    C -->|Top-N Docs| D[Summarization with RAG]
    D --> E[Answer with References]
    E --> F[(Slack / API JSON Response)]
```
# 🚀 Project Features

🔍 **AI Wiki Search (RAG Enabled)**

* Natural-language search over Azure DevOps wiki content
* synonym-based query rewriting to ensure accurate and complete results
* Uses Gemini’s FileSearchStore (RAG) for highly accurate answers
* Returns structured markdown (headers, bullets, number lists)

📄 **Wiki Data Sync**

* Export all wiki pages to JSON
* Extract and upload all wiki images
* Link images → wiki page
* Metadata for filtering (title, type, image GUID, source_page)
* Build synonyms terms

🔁 **FileSearchStore Management**

* Automatic deletion & recreation of the store
* Idempotent uploads
* Duplicate-image prevention using local hash store
* Full pagination retrieval of all documents (20 per page)

💬 **Slack Integration**

* Responds to /wiki–style queries
* Auto-chunks long answers (≥2800 chars) into multiple Slack messages
* Sentence-aware splitting (no mid-sentence breaks)
* Markdown formatting supported (bold, italics, bullets, numbered lists)
* Rate limiter with 10 requests per minute
* Slack signing secret for Slack verification

🗂 **Logging**

* Daily log rotation (logs/YYYY-MM-DD.log)
* Max size: 30 MB per file
* Console + file output (no compression)

# 🏗 Architecture Overview
<pre>
Azure DevOps Wiki
      │
      ▼
Wiki Sync
  ├─ Export pages (JSON)
  ├─ Extract images
  ├─ Hash & Convert images
  └─ Upload all to Gemini FileSearchStore
      │
      ▼
Gemini RAG Search
      │
      ▼
Slack Slash Command
      │
      ▼
Formatted AI Answer (Markdown)
</pre>
📁 **Project Structure**
<pre>
  src/
│
├── middleware
    ├──rateLimiter.ts                 # Slack rate limiter
    ├──verifySlackSignature.ts        # Verify Slack Signature
├── utils
    ├──logger.ts                       # Log rotation system
├── azureClient.ts                     # Azure Client for WIKI
├── geminiService.ts                   # RAG store management + search
├── models.ts                          # Wiki models 
├── optimizeExtractSynonyms.ts         # Extract Synonyms
├── parseGeminiResponse.ts             # sanitize Gemini response
├── rewriteQueryForFileSearch.ts       # Rewrite end user query
├── server.ts                          # exponse endpoints and start server
├── slackController.ts                 # Slack command handler
├── wikiService.ts                     # Download wiki documents
│
config/
├── wiki-files/           # Exported wiki JSON files
├── wiki-images/          # Extracted wiki images
└── image-hash.json       # Prevents duplicate uploads
│
logs/
└── *.log                 # Rotating logs
</pre>

## 📦 Prerequisites
Before running this project, ensure you have the following installed and configured:

### 🔧 System Requirements
- **Node.js 18+**  
  The Gemini API and Slack SDK require modern Node versions for fetch, async/await, and TLS support  
  👉 https://nodejs.org/

- **npm or yarn**
  Used to install dependencies  
  (npm is included with Node)

### 🔑 Required Accounts & API Keys
- **Google Gemini API Key**  
  Required for File Search + LLM generation  
  👉 https://ai.google.dev/gemini-api

- **Slack App with Slash Command**  
  Needed to send answers to Slack channels  
  👉 https://api.slack.com/
  
# 📦 **Installation**

1️⃣ **Install Dependencies**
```
npm install
```

2️⃣ **Environment Variables**

Create .env:
```
PORT=PORT_NUMBER 
AZ_ORG=YOUR_ORG
AZ_PROJECT=YOUR_PROJECT
AZ_PAT=YOUR_PAT -- instruction below
AZ_CLIENT_URL=YOUR_AZURE_CLIENT_URL  -- Ex:https://dev.azure.com/YOUR_ORG/YOUR_PROJECT/_apis/wiki/wikis
IMAGE_REPO_URL=YOUR_AZURE_IMAGE_REPO --Ex: https://dev.azure.com/YOUR_ORG/YOUR_PROJECT/_apis/git/repositories/{YOUR_WIKI}/items
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
DATASET_NAME=YOUR_DATASET_NAME
GEMINI_MODEL_TEXT_IMAGE_GENERATION=gemini-2.5-flash-lite
GEMINI_MODEL_QA=gemini-2.5-flash
WIKI_ID=YOUR_WIKI  -- instruction below
API_VERSION=7.1-preview.1
SLACK_SIGNING_SECRET=YOUR_SLACK_APP_SIGNATURE -- instruction below
DEBUG_LOGS=1 -- flexible to turn on/off to debug log
```
**_Note:_**
- [How to get your wiki id/name](https://learn.microsoft.com/en-us/rest/api/azure/devops/wiki/pages/get-page?view=azure-devops-rest-7.1&tabs=HTTP)
- [How to get PAT](https://learn.microsoft.com/en-us/rest/api/azure/devops/wiki/pages/get-page?view=azure-devops-rest-7.1&tabs=HTTP) - Need to add Read **Wiki** and **Code** Permissions to PAT
- [How to get Slack Signing secret](https://docs.slack.dev/authentication/verifying-requests-from-slack/)

3️⃣ **Start Development Server**
```
npm run dev
```
# ⬆️ **Export the Wiki data**
- Use any tool as **Postman** to trigger this endpoint
```
POST http://localhost:yourport/wikis/export
```
_Export behaviors:_
* Export all text, images to wiki-files , wiki-images
* Log all exported data

# 📚 **List out wiki documents**
- Use any tool as **Postman** to trigger this endpoint
```
GET http://localhost:yourport/wikis/documents
```
<img width="726" height="480" alt="image" src="https://github.com/user-attachments/assets/536e443a-061d-4ef1-a08a-aede465f8ac0" />


# 🔁 **Syncing the Wiki to Gemini RAG**
- Use any tool as **Postman** to trigger this endpoint
```
POST http://localhost:yourport/gemini/sync
```
_Sync behaviors:_
* Delete any existing FileSearchStore that is set in DATASET_NAME .env file
* Create a new one
* Upload all wiki text documents
* Upload all images with metadata
* Log upload counts (textCount + imageCount)
  
_Note: If you don't use Azure Wiki devOps then you can also use sync as instructions below:_

_1. Create json files in folder config/wiki-files as structure_
 ```
  {
  "title": "/Archive",
  "source": "https://dev.azure.com/....",
  "content": "Archive of pages with information....",
  "images": [array of image names ]
  }
 ```
_2. Create folder config/wiki-images and add images into this folder_
    
<img width="456" height="402" alt="image" src="https://github.com/user-attachments/assets/23e2f93b-020a-4187-8b7e-dab30e21bfcb" />

# 🔍 **Searching the Wiki Using Gemini**

There is an endpoint /gemini/query

```
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
```

_Search behavior:_
* Uses Gemini model with fileSearch tool
* Limits results to your RAG dataset only
* Converts answer into Markdown
* Returns clean text (no retrieval metadata)
* Supports long-form chunking for Slack
* customPrompt can let you create your own prompt to extend your need
<img width="627" height="347" alt="image" src="https://github.com/user-attachments/assets/1900df5e-8f96-4fe1-9e6c-9f32a0356f66" />


# 💬 Slack Slash Command
1. [Setup Slack Command](https://docs.slack.dev/interactivity/implementing-slash-commands/)
   
   NOTE: Slack only accepts https for Slack Command. You can use tool as Cloudflare or deploy your endpoints with https server  

3. Go to your Slack app and type command to verify
   Sample Command 
   ```
   /wiki find documents with title, content relates to "PDMP" and summarize the information how to submit PDMP manually 
   ```
# FINAL RESULT (HOOORAY 🎉 🥳 🎇)
<img width="801" height="207" alt="image" src="https://github.com/user-attachments/assets/4d24aa88-f040-47d4-8599-5b00bb720f7f" />



# 🛠 **Troubleshooting**

❌ **"No answer found"**

* Gemini could not find matching info in uploaded documents
* Ensure wiki page exists
* Ensure sync ran successfully
* Check search phrasing (add more context)

# 🚀 Built With

* [Node.js](https://nodejs.org/) — Core runtime powering the backend  
* [TypeScript](https://www.typescriptlang.org/) — Strongly typed JavaScript for safer development  
* [Google Gemini File Search Store](https://ai.google.dev/gemini-api/docs/file-search#file-search-stores) — Vector search + multimodal grounding  
* [Google Generative AI (Gemini)](https://gemini.google.com/app) — LLM for answering Wiki knowledge questions  
* [Slack API](https://api.slack.com/) — Slash command integration for instant Q&A  
* [Axios](https://github.com/axios/axios) — HTTP client for external calls  
* [Node File System (fs)](https://nodejs.org/api/fs.html) — Handles export/import folder operations  
* [UUID](https://www.npmjs.com/package/uuid) — Lightweight GUID generation for metadata 

# Authors

* **Long Tran**
  
# 🎉 **Enjoy exploring and improving this project — and feel free to share ideas, report issues, or contribute enhancements anytime!** 💡
  
