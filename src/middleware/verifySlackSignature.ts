import crypto from "crypto";
import { Request, Response, NextFunction } from "express";

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET!;

export function verifySlackSignature(req: Request, res: Response, next: NextFunction) {
    try {
       
        const timestamp = req.headers["x-slack-request-timestamp"];
        const slackSignature = req.headers["x-slack-signature"];

        if (!timestamp || !slackSignature) {
            return res.status(400).send("Missing Slack signature headers.");
        }

        // Prevent replay attacks (older than 5 minutes = reject)
        const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
        if (Number(timestamp) < fiveMinutesAgo) {
            return res.status(400).send("Slack request timestamp expired.");
        }

        const rawBody = (req as any).rawBody; // we will add this in Express
        const sigBaseString = `v0:${timestamp}:${rawBody}`;

        const mySignature =
            "v0=" +
            crypto
                .createHmac("sha256", SLACK_SIGNING_SECRET)
                .update(sigBaseString)
                .digest("hex");

        if (crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(slackSignature as string))) {
            return next(); // 👍 Verified OK
        }

        return res.status(401).send("Slack signature mismatch.");
    } catch (err) {
        console.error("Slack signature verification failed:", err);
        return res.status(500).send("Signature verification error.");
    }
}