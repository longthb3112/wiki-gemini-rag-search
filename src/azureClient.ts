// src/azureClient.ts
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const org = process.env.AZ_ORG ?? "";
const project = process.env.AZ_PROJECT ?? "";
const pat = process.env.AZ_PAT;

if (!pat) {
  throw new Error("AZ_PAT is not set in .env");
}

const authHeader = Buffer.from(":" + pat).toString("base64");

// 👇 this client is for WIKI specifically
export const azureWikiClient = axios.create({
  baseURL: process.env.AZ_CLIENT_URL || `https://dev.azure.com/${org}/${project}/_apis/wiki/wikis`,
  headers: {
    Authorization: `Basic ${authHeader}`,
    "Content-Type": "application/json",
  },
});