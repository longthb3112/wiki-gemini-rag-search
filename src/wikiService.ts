// src/wikiService.ts
import { azureWikiClient } from "./azureClient";
import fs from "fs";
import path from "path";
import axios from "axios";

const wikiId = process.env.WIKI_ID || "";
const apiVersion = process.env.API_VERSION || "7.1-preview.1";

// Use same org/project as azureClient (or override via env)
const org = process.env.AZ_ORG || "";
const project = process.env.AZ_PROJECT || "";

/* ================= IMAGE HELPERS ================= */

/**
 * Extract image paths from markdown content
 * e.g. ![alt](.attachments/image-xxx.png)
 */
function extractImagePaths(content: string): string[] {
  const regex = /!\[.*?\]\((.*?)\)/g;
  const matches = [...content.matchAll(regex)];
  return matches
    .map((m) => m[1])
    .filter((p) => p && p.includes(".attachments"));
}

/**
 * Download wiki image using the EXACT Git URL you tested manually.
 * This should produce a valid, openable PNG/JPG.
 */
async function downloadWikiImage(imagePath: string) {
  const imageDir = path.join(process.cwd(), "config", "wiki-images");
  if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir, { recursive: true });
  }

  const pat = process.env.AZ_PAT;
  if (!pat) {
    throw new Error("AZ_PAT environment variable is not set");
  }

  const authHeader = Buffer.from(`:${pat}`).toString("base64");
  const url = process.env.IMAGE_REPO_URL || `https://dev.azure.com/${org}/${project}` +
    `/_apis/git/repositories/${wikiId}/items`;

  const response = await axios.get(url, {
    params: {
      path: imagePath,
      download: true,
      $format: "octetStream",
      "api-version": apiVersion,
    },
    headers: {
      Authorization: `Basic ${authHeader}`,
      Accept: "application/octet-stream",
    },
    responseType: "arraybuffer",
  });

  const fileName = path.basename(imagePath);
  const filePath = path.join(imageDir, fileName);

  fs.writeFileSync(filePath, Buffer.from(response.data));

  return filePath;
}

/* ================= CORE PAGE FETCH ================= */

/**
 * Fetch page content by page PATH (more reliable than ID)
 */
async function getContentByPath(pagePath: string) {
  const res = await azureWikiClient.get(`/${wikiId}/pages`, {
    params: {
      path: pagePath,
      includeContent: true,
      apiVersion,
    },
  });

  return res.data?.content || "";
}

/**
 * Fetch all pages with content recursively
 */
export async function getAllWikiPagesWithContent(): Promise<any[]> {
  const res = await azureWikiClient.get(
    `/${wikiId}/pages?recursionLevel=full&api-version=${apiVersion}`
  );

  let roots: any[] = [];

  if (Array.isArray(res.data?.value)) {
    roots = res.data.value;
  } else if (res.data?.path) {
    roots = [res.data];
  } else {
    console.error("RAW RESPONSE:", res.data);
    throw new Error("Azure DevOps returned unknown page structure");
  }

  const pages: any[] = [];

  async function traverse(node: any) {
    if (node.path && node.path !== "/") {
      const content = await getContentByPath(node.path);

      pages.push({
        path: node.path,
        gitItemPath: node.gitItemPath,
        content,
        remoteUrl: node.remoteUrl,
      });
    }

    if (Array.isArray(node.subPages)) {
      for (const child of node.subPages) {
        await traverse(child);
      }
    }
  }

  for (const root of roots) {
    await traverse(root);
  }

  return pages;
}

/**
 * Get FIRST N wiki pages with content (for testing)
 */
export async function getLimitedWikiPages(limit: number): Promise<any[]> {
  const all = await getAllWikiPagesWithContent();
  return all.slice(0, limit);
}

/* ================= EXPORT FUNCTIONS ================= */

/**
 * Export ALL wiki pages + images
 */
export async function exportAllWikiPagesToFiles() {
  const pages = await getAllWikiPagesWithContent();

  const exportDir = path.join(process.cwd(), "config", "wiki-files");
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  for (const page of pages) {
    const safeFileName = page.path
      .replace(/\//g, "_")
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_]/g, "");

    const filePath = path.join(exportDir, `${safeFileName}.json`);

    // 🔍 find images in markdown
    const images = extractImagePaths(page.content);
    const savedImages: string[] = [];

    for (const img of images) {
      try {
        const savedPath = await downloadWikiImage(img);
        savedImages.push(savedPath);
      } catch (err) {
        console.error(`Failed to download image ${img}`, err);
      }
    }

    const fileContent = {
      title: page.path,
      source: page.remoteUrl,
      content: page.content,
      images: savedImages,
    };

    fs.writeFileSync(filePath, JSON.stringify(fileContent, null, 2), "utf8");
  }

  return {
    totalPages: pages.length,
    folder: exportDir,
  };
}

/**
 * Export ONLY N wiki pages + images (for testing)
 */
export async function exportLimitedWikiPagesToFiles(limit: number) {
  const pages = await getLimitedWikiPages(limit);

  const exportDir = path.join(process.cwd(), "config", "wiki-files");

  ensureEmptyDirectory(exportDir);

  for (const page of pages) {
    const safeFileName = page.path
      .replace(/\//g, "_")
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_]/g, "");

    const filePath = path.join(exportDir, `${safeFileName}.json`);

    const images = extractImagePaths(page.content);
    const savedImages: string[] = [];

    for (const img of images) {
      try {
        const savedPath = await downloadWikiImage(img);
        savedImages.push(savedPath);
      } catch (err) {
        console.error(`Failed to download image ${img}`, err);
      }
    }

    const fileContent = {
      title: page.path,
      source: page.remoteUrl,
      content: page.content,
      images: savedImages,
    };

    fs.writeFileSync(filePath, JSON.stringify(fileContent, null, 2), "utf8");
  }

  return {
    totalPages: pages.length,
    folder: exportDir,
  };
}

/**
 * Debug helper
 */
export async function getRawPagesResponse() {
  const res = await azureWikiClient.get(
    `/${wikiId}/pages?recursionLevel=full&api-version=${apiVersion}`
  );
  return res.data;
}

/**
 * Ensures a directory exists and is empty.
 * - If it exists: deletes all contents
 * - If not: creates it
 */
export function ensureEmptyDirectory(dirPath: string) {
  if (fs.existsSync(dirPath)) {
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      const fullPath = path.join(dirPath, file);

      if (fs.lstatSync(fullPath).isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(fullPath);
      }
    }
  } else {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}