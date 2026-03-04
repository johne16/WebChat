// extension/agentClient.js
// Client for communicating with the web agent through the server proxy

import { SERVER_BASE } from './config.js';

// =============================================================================
// SSE (Server-Sent Events) for Real-Time Updates
// =============================================================================

let eventSource = null;
let eventHandlers = {
	'connected': [],
	'state': [],
	'agent-status': [],
	'needs-input': [],
	'input-provided': []
};

/**
 * Connect to SSE endpoint for real-time updates
 * @param {Object} handlers - Event handlers { eventName: callback }
 * @returns {EventSource}
 */
export function connectSSE(handlers = {}) {
	if (eventSource) {
		console.log('[AgentClient] SSE already connected');
		return eventSource;
	}

	console.log('[AgentClient] Connecting to SSE...');
	eventSource = new EventSource(`${SERVER_BASE}/api/events`);

	// Register provided handlers
	for (const [event, handler] of Object.entries(handlers)) {
		if (typeof handler === 'function') {
			addSSEHandler(event, handler);
		}
	}

	// Set up event listeners
	eventSource.addEventListener('connected', (e) => {
		console.log('[AgentClient] SSE connected');
		const data = JSON.parse(e.data);
		eventHandlers['connected'].forEach(h => h(data));
	});

	eventSource.addEventListener('state', (e) => {
		const data = JSON.parse(e.data);
		console.log('[AgentClient] SSE state:', data.agents?.length, 'agents,', data.needsInputQueue?.length, 'pending inputs');
		eventHandlers['state'].forEach(h => h(data));
	});

	eventSource.addEventListener('agent-status', (e) => {
		const data = JSON.parse(e.data);
		console.log('[AgentClient] SSE agent-status:', data.status);
		eventHandlers['agent-status'].forEach(h => h(data));
	});

	eventSource.addEventListener('needs-input', (e) => {
		const data = JSON.parse(e.data);
		console.log('[AgentClient] SSE needs-input:', data.missingFields);
		eventHandlers['needs-input'].forEach(h => h(data));
	});

	eventSource.addEventListener('input-provided', (e) => {
		const data = JSON.parse(e.data);
		console.log('[AgentClient] SSE input-provided');
		eventHandlers['input-provided'].forEach(h => h(data));
	});

	eventSource.onerror = (err) => {
		console.error('[AgentClient] SSE error:', err);
		// EventSource will auto-reconnect
	};

	return eventSource;
}

/**
 * Add handler for SSE event
 * @param {string} event - Event name
 * @param {Function} handler - Callback function
 */
export function addSSEHandler(event, handler) {
	if (eventHandlers[event]) {
		eventHandlers[event].push(handler);
	} else {
		console.warn('[AgentClient] Unknown SSE event:', event);
	}
}

/**
 * Remove handler for SSE event
 * @param {string} event - Event name
 * @param {Function} handler - Callback function to remove
 */
export function removeSSEHandler(event, handler) {
	if (eventHandlers[event]) {
		eventHandlers[event] = eventHandlers[event].filter(h => h !== handler);
	}
}

/**
 * Disconnect from SSE
 */
export function disconnectSSE() {
	if (eventSource) {
		console.log('[AgentClient] Disconnecting SSE');
		eventSource.close();
		eventSource = null;
		// Clear all handlers
		for (const event of Object.keys(eventHandlers)) {
			eventHandlers[event] = [];
		}
	}
}

/**
 * Check if SSE is connected
 * @returns {boolean}
 */
export function isSSEConnected() {
	return eventSource !== null && eventSource.readyState === EventSource.OPEN;
}

// =============================================================================
// Agent API Functions
// =============================================================================

/**
 * Safely parse JSON from a response, wrapping in try/catch to avoid masking HTTP errors
 * @param {Response} response - Fetch response
 * @returns {Promise<Object>} Parsed JSON
 */
async function safeResponseJson(response) {
	try {
		return await response.json();
	} catch {
		return { error: `HTTP ${response.status}: failed to parse response body` };
	}
}

/**
 * Start a new agent process
 * @param {string} taskId - Unique task identifier
 * @returns {Promise<{success: boolean, port: number, taskId: string}>}
 */
export async function startAgent(taskId) {
	if (!taskId) {
		throw new Error('taskId is required');
	}

	console.log('[AgentClient] Starting agent for task:', taskId);

	const response = await fetch(`${SERVER_BASE}/api/agent/start`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ taskId })
	});

	if (!response.ok) {
		const error = await safeResponseJson(response);
		throw new Error(error.error || `Failed to start agent: ${response.status}`);
	}

	const data = await response.json();
	console.log('[AgentClient] Agent started on port:', data.port);
	return data;
}


/**
 * Execute a goal using the agent
 * @param {number} port - Agent container port
 * @param {string} goal - Natural language goal
 * @param {string} startUrl - URL to start from
 * @param {Object} userProfile - User profile data
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Agent response with status, sessionId, etc.
 */
export async function executeGoal(port, goal, startUrl, userProfile, options = {}) {
	console.log('[AgentClient] Executing goal:', goal);

	// Extract provider/model from options to send as top-level fields
	const { provider, model, ...restOptions } = options;

	const response = await fetch(`${SERVER_BASE}/api/agent/execute-goal`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			port,
			goal,
			startUrl,
			userProfile,
			provider,
			model,
			options: { headless: false, ...restOptions }
		})
	});

	if (!response.ok) {
		const error = await safeResponseJson(response);
		throw new Error(error.error || `Execute goal failed: ${response.status}`);
	}

	const data = await response.json();
	console.log('[AgentClient] Goal result:', data.status);
	return data;
}


/**
 * Stop an agent process
 * @param {number} port - Port of agent to stop
 * @returns {Promise<{success: boolean}>}
 */
export async function stopAgent(port) {
	console.log('[AgentClient] Stopping agent on port:', port);

	const response = await fetch(`${SERVER_BASE}/api/agent/stop`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ port })
	});

	if (!response.ok) {
		const error = await safeResponseJson(response);
		throw new Error(error.error || `Stop agent failed: ${response.status}`);
	}

	const data = await response.json();
	console.log('[AgentClient] Agent stopped');
	return data;
}

/**
 * Get list of running agents
 * @returns {Promise<{agents: Array, availablePorts: Array}>}
 */
export async function getAgentStatus() {
	const response = await fetch(`${SERVER_BASE}/api/agent/status`);

	if (!response.ok) {
		const error = await safeResponseJson(response);
		throw new Error(error.error || `Get status failed: ${response.status}`);
	}

	return response.json();
}

/**
 * Provide input data for a waiting agent (needs_input or awaiting_user_action)
 * @param {number} port - Agent port
 * @param {string} sessionId - Session ID
 * @param {Object} inputData - Data to provide
 * @param {string} provider - LLM provider for session resume
 * @param {string} model - LLM model for session resume
 * @returns {Promise<Object>} - Agent response after continuing
 */
export async function provideInput(port, sessionId, inputData, provider, model) {
	console.log('[AgentClient] Providing input for session:', sessionId);

	const response = await fetch(`${SERVER_BASE}/api/agent/provide-input`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ port, sessionId, inputData, provider, model })
	});

	if (!response.ok) {
		const error = await safeResponseJson(response);
		throw new Error(error.error || `Provide input failed: ${response.status}`);
	}

	const data = await response.json();
	console.log('[AgentClient] Input provided, result:', data.status);
	return data;
}

