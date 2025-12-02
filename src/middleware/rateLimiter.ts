import { Request, Response, NextFunction } from "express";

const userRateLimit: Record<string, { count: number; lastReset: number }> = {};
const LIMIT = 10; // max 10 requests
const WINDOW_MS = 60 * 1000; // per minute

export function rateLimiter(req: Request, res: Response, next: NextFunction) {
    const userId = req.body.user_id || "unknown";
    const responseUrl = req.body.response_url;

    const now = Date.now();
    const entry = userRateLimit[userId];

    if (!entry) {
        userRateLimit[userId] = { count: 1, lastReset: now };
        return next();
    }

    // Reset window
    if (now - entry.lastReset > WINDOW_MS) {
        userRateLimit[userId] = { count: 1, lastReset: now };
        return next();
    }

    // Check limit
    if (entry.count >= LIMIT) {
        // Send message to Slack
        if (responseUrl) {
            fetch(responseUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    response_type: "ephemeral",
                    text: "⛔ You are sending too many requests. Try again in a minute."
                })
            });
        }

        // MUST return 200 for Slack
        return res.status(200).send();
    }

    entry.count++;
    next();
}