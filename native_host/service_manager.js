// native_host/service_manager.js
// Native Messaging host - manages Express server and Crawl4AI service lifecycle
// Services are spawned detached so they survive native host restarts (MV3 idle cycles).
// Only an explicit 'stop' command kills services; stdin close does NOT.

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'service_manager.log');
const PID_FILE = path.join(LOG_DIR, 'pids.json');

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Open log stream (non-blocking writes; stdout is reserved for protocol)
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function log(msg) {
	logStream.write(`[${new Date().toISOString()}] ${msg}\n`);
}

// Load config
let config = {};
try {
	config = JSON.parse(fs.readFileSync(path.join(ROOT, 'webchat.config.json'), 'utf8'));
} catch (e) {
	log('Failed to load webchat.config.json, using defaults');
}

const SERVER_PORT = config.server?.port || 8787;
const CRAWL_PORT = config.crawlService?.port || 11235;
const HEALTH_INTERVAL = config.nativeHost?.healthCheckIntervalMs || 2000;
const HEALTH_MAX_ATTEMPTS = config.nativeHost?.healthCheckMaxAttempts || 15;

// Resolve python path from config or use system default
const PYTHON_CMD = config.nativeHost?.pythonPath || 'python';

// Current status
let status = { server: 'stopped', crawl: 'stopped' };
let pollCancelled = false;

// =============================================================================
// Native Messaging Protocol (4-byte length-prefixed JSON on stdin/stdout)
// =============================================================================

function sendMessage(obj) {
	const json = JSON.stringify(obj);
	const byteLen = Buffer.byteLength(json, 'utf8');
	const buf = Buffer.alloc(4 + byteLen);
	buf.writeUInt32LE(byteLen, 0);
	buf.write(json, 4, 'utf8');
	process.stdout.write(buf);
}

let inputBuffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
	inputBuffer = Buffer.concat([inputBuffer, chunk]);
	processInput();
});

function processInput() {
	while (inputBuffer.length >= 4) {
		const msgLen = inputBuffer.readUInt32LE(0);
		if (inputBuffer.length < 4 + msgLen) break;

		const jsonStr = inputBuffer.subarray(4, 4 + msgLen).toString('utf8');
		inputBuffer = inputBuffer.subarray(4 + msgLen);

		try {
			const msg = JSON.parse(jsonStr);
			log(`Received: ${JSON.stringify(msg)}`);
			handleMessage(msg);
		} catch (e) {
			log(`Failed to parse message: ${e.message}`);
		}
	}
}

// =============================================================================
// Message Handling
// =============================================================================

async function handleMessage(msg) {
	switch (msg.command) {
		case 'start':
			await startServices();
			break;
		case 'stop':
			await stopServices();
			break;
		case 'status':
			sendStatus();
			break;
		default:
			log(`Unknown command: ${msg.command}`);
			sendMessage({ type: 'error', message: `Unknown command: ${msg.command}` });
	}
}

function sendStatus() {
	sendMessage({ type: 'status', server: status.server, crawl: status.crawl });
}

// =============================================================================
// Health Checking
// =============================================================================

function healthCheck(port) {
	return new Promise((resolve) => {
		const req = http.get(`http://localhost:${port}/`, { timeout: 2000 }, (res) => {
			res.resume();
			resolve(res.statusCode >= 200 && res.statusCode < 500);
		});
		req.on('error', () => resolve(false));
		req.on('timeout', () => { req.destroy(); resolve(false); });
	});
}

// =============================================================================
// PID File (track detached children across native host restarts)
// =============================================================================

function savePids(serverPid, crawlPid) {
	const data = {};
	if (serverPid) data.server = serverPid;
	if (crawlPid) data.crawl = crawlPid;
	try {
		fs.writeFileSync(PID_FILE, JSON.stringify(data));
	} catch (_) {}
}

function loadPids() {
	try {
		return JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
	} catch (_) {
		return {};
	}
}

function clearPids() {
	try { fs.unlinkSync(PID_FILE); } catch (_) {}
}

// =============================================================================
// Service Spawning (detached, survives native host exit)
// =============================================================================

async function startServices() {
	log('Starting services...');

	// Check if already running
	const serverAlive = await healthCheck(SERVER_PORT);
	const crawlAlive = await healthCheck(CRAWL_PORT);

	if (serverAlive) {
		log(`Server already running on port ${SERVER_PORT}`);
		status.server = 'running';
	}
	if (crawlAlive) {
		log(`Crawl service already running on port ${CRAWL_PORT}`);
		status.crawl = 'running';
	}

	sendStatus();

	// Spawn server if not running
	if (!serverAlive) {
		status.server = 'starting';
		sendStatus();
		try {
			spawnServer();
		} catch (e) {
			log(`Failed to spawn server: ${e.message}`);
			status.server = 'error';
			sendStatus();
		}
	}

	// Spawn crawl service if not running
	if (!crawlAlive) {
		status.crawl = 'starting';
		sendStatus();
		try {
			spawnCrawl();
		} catch (e) {
			log(`Failed to spawn crawl service: ${e.message}`);
			status.crawl = 'error';
			sendStatus();
		}
	}

	// Poll until both are up
	await pollServices();
}

function spawnServer() {
	const serverDir = path.join(ROOT, 'server');
	log(`Spawning server: node server.js in ${serverDir}`);

	const proc = spawn('node', ['server.js'], {
		cwd: serverDir,
		stdio: 'ignore',
		windowsHide: true
	});
	proc.unref();

	log(`Server spawned with PID ${proc.pid}`);
	const pids = loadPids();
	pids.server = proc.pid;
	savePids(pids.server, pids.crawl);
}

function spawnCrawl() {
	const crawlDir = path.join(ROOT, 'crawl_service');
	log(`Spawning crawl service: ${PYTHON_CMD} crawl_service.py in ${crawlDir}`);

	const proc = spawn(PYTHON_CMD, ['crawl_service.py'], {
		cwd: crawlDir,
		stdio: 'ignore',
		windowsHide: true,
		env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
	});
	proc.unref();

	log(`Crawl service spawned with PID ${proc.pid}`);
	const pids = loadPids();
	pids.crawl = proc.pid;
	savePids(pids.server, pids.crawl);
}

async function pollServices() {
	pollCancelled = false;
	let lastSent = '';

	for (let i = 0; i < HEALTH_MAX_ATTEMPTS; i++) {
		if (pollCancelled) return;

		const serverOk = status.server === 'running' || await healthCheck(SERVER_PORT);
		const crawlOk = status.crawl === 'running' || await healthCheck(CRAWL_PORT);

		if (serverOk && status.server !== 'running') {
			status.server = 'running';
			log('Server is now running');
		}
		if (crawlOk && status.crawl !== 'running') {
			status.crawl = 'running';
			log('Crawl service is now running');
		}

		// Only send status when it changes
		const current = JSON.stringify(status);
		if (current !== lastSent) {
			sendStatus();
			lastSent = current;
		}

		if (status.server === 'running' && status.crawl === 'running') {
			log('All services running');
			return;
		}

		if (status.server === 'error' || status.crawl === 'error') {
			log('Service error detected, stopping poll');
			return;
		}

		await sleep(HEALTH_INTERVAL);
	}

	log('Health check polling exhausted');
	if (status.server !== 'running') status.server = 'error';
	if (status.crawl !== 'running') status.crawl = 'error';
	sendStatus();
}

// =============================================================================
// Service Stopping
// =============================================================================

async function stopServices() {
	log('Stopping services...');
	pollCancelled = true;

	const pids = loadPids();
	killPid(pids.server, 'server');
	killPid(pids.crawl, 'crawl');
	clearPids();

	status.server = 'stopped';
	status.crawl = 'stopped';
	sendStatus();
}

function killPid(pid, label) {
	if (!pid || !Number.isInteger(pid)) return;
	try {
		log(`Killing ${label} (PID ${pid}) via taskkill`);
		execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore' });
	} catch (e) {
		log(`taskkill failed for ${label} PID ${pid}: ${e.message}`);
	}
}

// =============================================================================
// Cleanup on exit
// =============================================================================

// stdin end = native host disconnected (MV3 idle or browser closed).
// Do NOT kill services here; they are detached and should keep running.
// Services are only killed via explicit 'stop' command.
process.stdin.on('end', () => {
	log('stdin ended (native host disconnecting), services left running');
	process.exit(0);
});

process.on('SIGTERM', () => {
	log('SIGTERM received');
	process.exit(0);
});

// =============================================================================
// Utility
// =============================================================================

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

log('Service manager started');
