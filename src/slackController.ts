import axios from "axios";
import { parseGeminiResponse } from "./parseGeminiResponse";
import { searchWiki } from "./geminiService";
const SLACK_MAX_MESSAGE_SIZE = 2800; // Slack limit is 2800 chars per message

async function sendSlackAnswer(responseUrl: string, answer: string) {
  if (answer.length <= SLACK_MAX_MESSAGE_SIZE) {
    // ✔ Short answer → send normally
    return axios.post(responseUrl, {
      response_type: "in_channel",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: answer
          }
        }
      ]
    });
  }

  // ✔ Long answer → split into chunks
  const chunks = splitIntoSlackChunks(answer, SLACK_MAX_MESSAGE_SIZE);

  for (let i = 0; i < chunks.length; i++) {
    const num = i + 1;
    const total = chunks.length;

    await axios.post(responseUrl, {
      response_type: "in_channel",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Part ${num} of ${total}*\n\n${chunks[i]}`
          }
        }
      ]
    });
  }
}

function splitIntoSlackChunks(text: string, maxSize = SLACK_MAX_MESSAGE_SIZE) {
  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > maxSize) {
    let slice = remaining.slice(0, maxSize);

    // Try to break at sentence end
    const lastPeriod = slice.lastIndexOf(".");
    if (lastPeriod !== -1 && lastPeriod > 2000) {
      slice = slice.slice(0, lastPeriod + 1);
    }

    parts.push(slice);
    remaining = remaining.slice(slice.length).trim();
  }

  if (remaining.length > 0) {
    parts.push(remaining);
  }

  return parts;
}

export async function handleSlackQuestion(req: any, res: any) {
  try {
    // Acknowledge Slack
    res.status(200).send("⏳ Processing your question...");

    // 1. Query Gemini
    const raw = await searchWiki(req.body.text);

    // 2. Parse / normalize
    const parsed = parseGeminiResponse(raw);

    // 3. Send either normal or chunked
    await sendSlackAnswer(req.body.response_url, parsed.answer);

  } catch (error) {
    console.error("Slack error:", error);

    await axios.post(req.body.response_url, {
      response_type: "ephemeral",
      text: "❌ Bot failed to answer the question."
    });
  }
}