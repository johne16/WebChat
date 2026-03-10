// extension/agent.js
// Agent session management, profile handling, and site data

import { startAgent, stopAgent, executeGoal, provideInput } from './agentClient.js';
import { extractDomain } from './utils.js';
import { getConfig, getUserId, SERVER_BASE } from './config.js';

// Agent session state
let agentSession = { sessionId: null, port: null, taskId: null };
let currentAgentUrl = null;

/**
 * Check if profile exists on server
 * @returns {Promise<boolean>}
 */
export async function isProfileUnlocked() {
	try {
		const userId = getUserId();
		const res = await fetch(`${SERVER_BASE}/api/db/profile?userId=${userId}`);
		if (!res.ok) return false;
		const data = await res.json();
		return data.profile != null;
	} catch {
		return false;
	}
}

/**
 * Get current agent session
 * @returns {Object}
 */
export function getAgentSession() {
	return { ...agentSession };
}

/**
 * Check if agent session is active
 * @returns {boolean}
 */
export function hasActiveSession() {
	return agentSession.port !== null;
}

/**
 * Transform flat profile to agent-expected format
 * @param {Object} profile - Flat profile object
 * @returns {Object} Transformed profile with nested address
 */
export function transformProfileForAgent(profile) {
	const transformed = {
		email: profile.email,
		firstName: profile.first_name,
		lastName: profile.last_name,
		phone: profile.phone,
		birthDate: profile.birth_date
	};

	// Agent expects address as nested object
	if (profile.street || profile.city || profile.state || profile.zip) {
		transformed.address = {
			street: profile.street || '',
			city: profile.city || '',
			state: profile.state || '',
			zip: profile.zip || '',
			country: profile.country || getConfig()?.extension?.profile?.defaultCountry || 'United States'
		};
	}

	// Copy extra_fields
	if (profile.extra_fields && typeof profile.extra_fields === 'object') {
		for (const [key, value] of Object.entries(profile.extra_fields)) {
			transformed[key] = value;
		}
	}

	return transformed;
}

/**
 * Start a new agent for a task
 * @param {string} taskId - Unique task identifier
 * @returns {Promise<{port: number}>}
 */
export async function startAgentSession(taskId) {
	const result = await startAgent(taskId);
	agentSession.port = result.port;
	agentSession.taskId = taskId;
	return result;
}

/**
 * Execute a goal with the agent
 * @param {string} goal - Natural language goal
 * @param {string} startUrl - URL to start from
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Agent response
 */
export async function executeAgentGoal(goal, startUrl, options = {}) {
	if (!agentSession.port) {
		throw new Error('No agent session active');
	}

	currentAgentUrl = startUrl;

	// Profile is fetched server-side via getFullUserData in routes/agent.js
	// No need to send profile from extension

	// Read agent-specific provider/model from storage
	const { agentProvider, agentModelType } = await chrome.storage.local.get(['agentProvider', 'agentModelType']);
	const cfg = getConfig()?.providers || {};

	const result = await executeGoal(
		agentSession.port,
		goal,
		startUrl,
		{},  // Empty profile; server merges from DB
		{
			...options,
			provider: agentProvider || cfg.defaultAgentProvider,
			model: agentModelType || cfg.defaultAgentModel
		}
	);

	agentSession.sessionId = result.sessionId;
	return result;
}

/**
 * Provide input data to a waiting agent
 * @param {Object} inputData - Data to provide
 * @returns {Promise<Object>} Agent response
 */
export async function provideAgentInput(inputData) {
	if (!agentSession.port || !agentSession.sessionId) {
		throw new Error('No active agent session');
	}

	// Save to site data via server API
	await saveSiteData(inputData);

	// Pass provider/model so resumed sessions use the same LLM
	const { agentProvider, agentModelType } = await chrome.storage.local.get(['agentProvider', 'agentModelType']);
	const cfg = getConfig()?.providers || {};

	const result = await provideInput(
		agentSession.port,
		agentSession.sessionId,
		inputData,
		agentProvider || cfg.defaultAgentProvider,
		agentModelType || cfg.defaultAgentModel
	);

	return result;
}

/**
 * Stop current agent session
 */
export async function stopAgentSession() {
	if (agentSession.port) {
		try {
			await stopAgent(agentSession.port);
		} catch (error) {
			console.error('[Agent] Stop error:', error);
		}
	}
	clearAgentSession();
}

/**
 * Clear agent session state (without calling server)
 * Use this when agent already terminated (achieved/failed/blocked)
 */
export function clearAgentSession() {
	agentSession = { sessionId: null, port: null, taskId: null };
	currentAgentUrl = null;
}

/**
 * Full cleanup - stop agent session
 */
export async function cleanup() {
	await stopAgentSession();
}

/**
 * Save form data to server site_data
 * @param {Object} formData - Key-value pairs to save
 */
async function saveSiteData(formData) {
	if (!currentAgentUrl) {
		console.log('[Agent] Cannot save site data - no current URL');
		return;
	}

	try {
		const domain = extractDomain(currentAgentUrl);
		const userId = getUserId();

		const NEVER_STORE_FIELDS = ['ssn', 'social_security', 'socialsecurity', 'social-security'];

		const promises = Object.entries(formData)
			.filter(([, value]) => value && value.toString().trim())
			.filter(([key]) => !NEVER_STORE_FIELDS.some(f => key.toLowerCase().includes(f)))
			.map(([key, value]) =>
				fetch(`${SERVER_BASE}/api/db/site-data`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						userId,
						domain,
						fieldName: key,
						fieldValue: value.toString().trim()
					})
				})
			);
		await Promise.all(promises);

		console.log(`[Agent] Saved site data for ${domain}:`, Object.keys(formData));
	} catch (error) {
		console.error('[Agent] Failed to save site data:', error);
	}
}
