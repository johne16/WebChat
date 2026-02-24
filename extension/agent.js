// extension/agent.js
// Agent session management, profile handling, and site data

import { startAgent, stopAgent, executeGoal, provideInput } from './agentClient.js';
import { decryptProfile, encryptProfile } from './crypto.js';
import { extractDomain } from './utils.js';

// Agent session state
let agentSession = { sessionId: null, port: null, taskId: null };
let decryptedProfile = null;
let currentPassphrase = null;
let currentAgentUrl = null;

/**
 * Check if profile is unlocked
 * @returns {boolean}
 */
export function isProfileUnlocked() {
	return decryptedProfile !== null;
}

/**
 * Get the current decrypted profile
 * @returns {Object|null}
 */
function getProfile() {
	return decryptedProfile;
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
 * Unlock profile with passphrase
 * @param {string} passphrase - User's passphrase
 * @returns {Promise<Object>} Decrypted profile
 * @throws {Error} If no profile exists or passphrase is wrong
 */
export async function unlockProfile(passphrase) {
	const { encryptedUserProfile } = await chrome.storage.local.get('encryptedUserProfile');

	if (!encryptedUserProfile) {
		throw new Error('No profile found. Please set up your profile in Settings first.');
	}

	decryptedProfile = await decryptProfile(encryptedUserProfile, passphrase);
	currentPassphrase = passphrase;
	return decryptedProfile;
}

/**
 * Lock profile (clear decrypted data)
 */
function lockProfile() {
	decryptedProfile = null;
	currentPassphrase = null;
}

/**
 * Transform flat profile to agent-expected format
 * @param {Object} profile - Flat profile object
 * @returns {Object} Transformed profile with nested address
 */
export function transformProfileForAgent(profile) {
	const transformed = {
		email: profile.email,
		firstName: profile.firstName,
		lastName: profile.lastName,
		phone: profile.phone,
		birthDate: profile.birthDate
	};

	// Agent expects address as nested object
	if (profile.address || profile.city || profile.state || profile.zip) {
		transformed.address = {
			street: profile.address || '',
			city: profile.city || '',
			state: profile.state || '',
			zip: profile.zip || '',
			country: profile.country || 'United States'
		};
	}

	// Copy any additional dynamic fields
	const knownFields = ['email', 'firstName', 'lastName', 'phone', 'birthDate', 'address', 'city', 'state', 'zip', 'country', 'siteData'];
	for (const key of Object.keys(profile)) {
		if (!knownFields.includes(key)) {
			transformed[key] = profile[key];
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
	if (!decryptedProfile) {
		throw new Error('Profile not unlocked');
	}

	currentAgentUrl = startUrl;
	const agentProfile = transformProfileForAgent(decryptedProfile);

	const result = await executeGoal(
		agentSession.port,
		goal,
		startUrl,
		agentProfile,
		options
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

	// Save to site data
	await saveSiteData(inputData);

	const result = await provideInput(
		agentSession.port,
		agentSession.sessionId,
		inputData
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
 * Full cleanup - stop agent and lock profile
 */
export async function cleanup() {
	await stopAgentSession();
	lockProfile();
}

/**
 * Save form data to profile's siteData
 * @param {Object} formData - Key-value pairs to save
 */
async function saveSiteData(formData) {
	if (!currentAgentUrl || !currentPassphrase || !decryptedProfile) {
		console.log('[Agent] Cannot save site data - missing URL, passphrase, or profile');
		return;
	}

	try {
		const domain = extractDomain(currentAgentUrl);

		if (!decryptedProfile.siteData) {
			decryptedProfile.siteData = {};
		}

		if (!decryptedProfile.siteData[domain]) {
			decryptedProfile.siteData[domain] = {};
		}

		for (const [key, value] of Object.entries(formData)) {
			if (value && value.toString().trim()) {
				decryptedProfile.siteData[domain][key] = value.toString().trim();
			}
		}

		const encrypted = await encryptProfile(decryptedProfile, currentPassphrase);
		await chrome.storage.local.set({ encryptedUserProfile: encrypted });

		console.log(`[Agent] Saved site data for ${domain}:`, Object.keys(formData));
	} catch (error) {
		console.error('[Agent] Failed to save site data:', error);
	}
}
