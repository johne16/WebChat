// extension/config.js
// Shared constants and runtime config for the extension

export const SERVER_BASE = 'http://localhost:8787';

let _configCache = null;

/**
 * Fetch config from server and cache it
 * Call this once at panel init before other modules need config
 * @returns {Promise<Object>} Config object with providers and extension sections
 */
export async function loadConfig() {
	try {
		const res = await fetch(`${SERVER_BASE}/api/config`);
		if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
		_configCache = await res.json();
	} catch (err) {
		console.warn('[Config] Failed to load config from server, using defaults:', err.message);
		_configCache = { providers: {}, extension: {} };
	}
	return _configCache;
}

/**
 * Get cached config synchronously
 * Returns null if loadConfig() hasn't been called yet
 * @returns {Object|null}
 */
export function getConfig() {
	return _configCache;
}

/**
 * Get the current user ID from cached config
 * @returns {number}
 */
export function getUserId() {
	return _configCache?.extension?.userId || 1;
}
