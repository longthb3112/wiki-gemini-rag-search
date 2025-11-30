import fs from "fs";
import path from "path";

const LOG_DIR = path.join(process.cwd(), "logs");
const MAX_SIZE_BYTES = 30 * 1024 * 1024; // 30 MB

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getDailyLogFile() {
    const date = new Date().toISOString().substring(0, 10); // YYYY-MM-DD
    return path.join(LOG_DIR, `${date}.log`);
}

// Rotate on size only (NO COMPRESSION)
function rotateIfTooLarge(filePath: string) {
    if (!fs.existsSync(filePath)) return;

    const { size } = fs.statSync(filePath);

    if (size >= MAX_SIZE_BYTES) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const rotatedName = filePath.replace(".log", `-${timestamp}.old.log`);
        fs.renameSync(filePath, rotatedName); // just move the file
    }
}

export function writeLog(message: string) {
    const filePath = getDailyLogFile();

    rotateIfTooLarge(filePath);

    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;

    fs.appendFile(filePath, line, (err) => {
        if (err) console.error("Failed to write log:", err);
    });
}