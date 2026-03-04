// metricsLogger.js - JSONL metrics appender for chat and research flows
import { appendFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, "logs");

let dirCreated = false;

function getLogPath() {
	const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
	return join(LOGS_DIR, `chat-${date}.jsonl`);
}

async function ensureDir() {
	if (dirCreated) return;
	await mkdir(LOGS_DIR, { recursive: true });
	dirCreated = true;
}

/**
 * Append a metric record to the daily JSONL log. Fire-and-forget.
 * @param {Object} record - Metric data to log
 */
export function logMetric(record) {
	const line = JSON.stringify(record) + "\n";
	ensureDir()
		.then(() => appendFile(getLogPath(), line))
		.catch((err) => console.warn("[Metrics] Write failed:", err.message));
}
