// extension/serviceManager.js
// Native messaging client for auto-starting backend services

const HOST_NAME = 'com.webchat.service_manager';

let port = null;
let currentStatus = { server: 'unknown', crawl: 'unknown' };
const statusListeners = [];
let pending = null;

/**
 * Connect to native host and send start command.
 * Resolves when both services report "running", or rejects on timeout/failure.
 * Guards against concurrent calls.
 * @returns {Promise<{server: string, crawl: string}>}
 */
export function ensureServices() {
	if (pending) return pending;

	pending = new Promise((resolve, reject) => {
		// Disconnect any stale port from a previous call
		if (port) {
			try { port.disconnect(); } catch (_) {}
			port = null;
		}

		port = chrome.runtime.connectNative(HOST_NAME);

		let resolved = false;
		const timeout = setTimeout(() => {
			if (!resolved) {
				resolved = true;
				if (port) { port.disconnect(); port = null; }
				console.warn('[ServiceManager] Timed out waiting for services');
				reject(new Error('Service start timed out'));
			}
		}, 60000);

		port.onMessage.addListener((msg) => {
			console.log('[ServiceManager] Received:', msg);
			if (msg.type === 'status') {
				currentStatus = { server: msg.server, crawl: msg.crawl };
				notifyListeners();

				if (!resolved && msg.server === 'running' && msg.crawl === 'running') {
					resolved = true;
					clearTimeout(timeout);
					resolve(currentStatus);
				}
			}
		});

		port.onDisconnect.addListener(() => {
			console.warn('[ServiceManager] Native host disconnected',
				chrome.runtime.lastError?.message || '');
			port = null;
			currentStatus = { server: 'unavailable', crawl: 'unavailable' };
			notifyListeners();
			if (!resolved) {
				resolved = true;
				clearTimeout(timeout);
				reject(new Error('Native host disconnected'));
			}
		});

		// Send start command
		port.postMessage({ command: 'start' });
	}).finally(() => { pending = null; });

	return pending;
}

/**
 * Get cached service status
 * @returns {{server: string, crawl: string}}
 */
export function getServiceStatus() {
	return { ...currentStatus };
}

/**
 * Register a callback for status changes. Returns unsubscribe function.
 * @param {Function} callback - Called with (status) on each change
 * @returns {Function} Unsubscribe function
 */
export function onStatusChange(callback) {
	statusListeners.push(callback);
	return () => {
		const i = statusListeners.indexOf(callback);
		if (i !== -1) statusListeners.splice(i, 1);
	};
}

/**
 * Send stop command to native host to kill managed services.
 * Connects briefly if no active port exists.
 */
export function stopServices() {
	if (port) {
		port.postMessage({ command: 'stop' });
		port.disconnect();
		port = null;
		currentStatus = { server: 'stopped', crawl: 'stopped' };
		notifyListeners();
		return;
	}

	// No active port; connect briefly just to send stop
	try {
		const stopPort = chrome.runtime.connectNative(HOST_NAME);
		stopPort.postMessage({ command: 'stop' });
		stopPort.onMessage.addListener(() => {
			try { stopPort.disconnect(); } catch (_) {}
		});
		setTimeout(() => {
			try { stopPort.disconnect(); } catch (_) {}
		}, 2000);
	} catch (_) {}
	currentStatus = { server: 'stopped', crawl: 'stopped' };
	notifyListeners();
}

function notifyListeners() {
	const snapshot = { ...currentStatus };
	for (const cb of statusListeners) {
		try { cb(snapshot); } catch (_) {}
	}
}
