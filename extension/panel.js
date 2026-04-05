// extension/panel.js
// Main entry point - unified message handling with SSE integration

import { SERVER_BASE, loadConfig, getConfig, getUserId } from './config.js';
import { sendToBot } from './llmClient.js';
import { runReActLoop } from './react.js';
import { connectSSE, disconnectSSE } from './agentClient.js';
import { detectIntent, INTENT } from './intent.js';
import {
	isProfileUnlocked,
	getAgentSession,
	hasActiveSession,
	startAgentSession,
	executeAgentGoal,
	provideAgentInput,
	stopAgentSession,
	clearAgentSession,
	cleanup
} from './agent.js';
import {
	addMessage,
	addMetaMessage,
	showThinkingIndicator,
	removeThinkingIndicator,
	updateHeaderProgress,
	updateServiceStatus,
	renderInputForm,
	removeCurrentForm,
	showStickyBanner,
	hideStickyBanner,
	showStopButton,
	hideStopButton,
	onStopAgentClick
} from './ui.js';

// DOM elements
const form = document.getElementById('form');
const input = document.getElementById('prompt');
const closeBtn = document.getElementById('close');
const optionsBtn = document.getElementById('open-options');
const bannerContinue = document.getElementById('banner-continue');

// State
let isTestingMode = false;
let pendingAgentRequest = null;  // Stores {text, url} when awaiting confirmation
let lastSeenTimestamp = 0;       // For SSE reconnect deduplication

// Query initial service status from background
chrome.runtime.sendMessage({ type: 'GET_SERVICE_STATUS' }, (response) => {
	if (chrome.runtime.lastError) return;
	if (response) updateServiceStatus(response.server, response.crawl);
});

// Listen for status updates from background
chrome.runtime.onMessage.addListener((msg) => {
	if (msg?.type === 'SERVICE_STATUS') {
		updateServiceStatus(msg.server, msg.crawl);
		if (msg.server) loadConfig().catch(() => {});
	}
});

// Read agent max steps from server config (used for progress bar denominator)
function getMaxAgentSteps() { return getConfig()?.agent?.maxSteps || 20; }

// Derive agent display number from port (5001 → 1, 5002 → 2, etc.)
function agentLabel(port) {
	return port ? `Agent ${port - 5000}` : 'Agent';
}

// Load settings (wrapped in try/catch for top-level await safety)
try {
	const stored = await chrome.storage.local.get(['isTestingMode']);
	isTestingMode = stored.isTestingMode || false;
} catch (error) {
	console.error('[Panel] Failed to load settings:', error);
}

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== 'local') return;
	if ('isTestingMode' in changes) {
		isTestingMode = changes.isTestingMode.newValue;
	}
});

// Track panel state and cleanup on close (consolidated unload/beforeunload)
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
	if (tab?.id) chrome.runtime.sendMessage({ type: 'PANEL_OPEN', tabId: tab.id });
});

window.addEventListener('beforeunload', () => {
	chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
		if (tab?.id) chrome.runtime.sendMessage({ type: 'PANEL_CLOSED', tabId: tab.id });
	});
	disconnectSSE();
	if (hasActiveSession()) {
		stopAgentSession().catch(() => {});
	}
});

// =============================================================================
// SSE Setup
// =============================================================================

/**
 * Guard: only process SSE events for our active session
 * @param {Object} data - SSE event data
 * @returns {boolean} true if event should be handled
 */
function isOurSession(data) {
	const session = getAgentSession();
	if (!session.port) return false;
	return data.port === session.port;
}

function setupSSE() {
	connectSSE({
		'connected': (data) => {
			console.log('[Panel] SSE connected');
			lastSeenTimestamp = data.timestamp;
		},
		'state': (data) => {
			// Initial state sync on connect/reconnect
			console.log('[Panel] SSE state:', data);
			handleStateSync(data);
		},
		'agent-status': (data) => {
			console.log('[Panel] Agent status:', data.status);
			handleAgentStatusEvent(data);
		},
		'needs-input': (data) => {
			console.log('[Panel] Needs input:', data.missingFields);
			handleNeedsInputEvent(data);
		},
		'input-provided': (data) => {
			console.log('[Panel] Input provided');
			// Another client provided input - dismiss our form if showing
			removeCurrentForm();
		}
	});
}

function handleStateSync(data) {
	// Check for pending needs_input that we haven't seen
	if (data.needsInputQueue && data.needsInputQueue.length > 0) {
		for (const item of data.needsInputQueue) {
			// Only show if newer than our last seen timestamp (reconnect scenario)
			if (item.timestamp > lastSeenTimestamp) {
				handleNeedsInputEvent(item);
			}
		}
	}
	lastSeenTimestamp = Date.now();
}

function handleAgentStatusEvent(data) {
	lastSeenTimestamp = data.timestamp || Date.now();

	if (!isOurSession(data)) return;

	const label = agentLabel(data.port);

	switch (data.status) {
		case 'started':
			updateHeaderProgress(`${label}: Starting...`);
			showStopButton();
			break;
		case 'step_completed': {
			const step = data.data?.step || '?';
			const action = data.data?.action || 'working';
			updateHeaderProgress(`${label}: ${action}... (${step}/${getMaxAgentSteps()})`);
			break;
		}
		case 'achieved':
			updateHeaderProgress('');
			addMessage('bot', data.message || 'Goal completed successfully');
			hideStopButton();
			clearAgentSession();
			break;
		case 'failed':
		case 'blocked':
			updateHeaderProgress('');
			addMessage('bot', data.message || 'Task failed');
			hideStopButton();
			clearAgentSession();
			break;
		case 'awaiting_user_action':
			updateHeaderProgress('');
			showStickyBanner(data.message || 'Please complete the action in the browser');
			break;
	}
}

function handleNeedsInputEvent(data) {
	lastSeenTimestamp = data.timestamp || Date.now();

	if (!isOurSession(data)) return;

	updateHeaderProgress('');
	addMessage('bot', data.message || 'Please provide the missing information:');

	renderInputForm(data.missingFields, null, async (formData) => {
		updateHeaderProgress(`${agentLabel(data.port)}: Continuing...`);
		try {
			await provideAgentInput(formData);
		} catch (error) {
			console.error('[Panel] Provide input error:', error);
			addMessage('bot', `Error: ${error.message}`);
		}
	});
}

// Initialize SSE on load
setupSSE();

// =============================================================================
// Main Form Handler
// =============================================================================

form.addEventListener('submit', async (e) => {
	e.preventDefault();
	const text = input.value.trim();
	if (!text) return;
	addMessage('user', text);
	input.value = '';

	// Testing mode: echo
	if (isTestingMode) {
		addMessage('bot', `Echo: ${text}`);
		return;
	}

	// Check for stop command when agent is running
	if (hasActiveSession() && isStopCommand(text)) {
		await handleStopAgent();
		return;
	}

	// Check for confirmation response
	if (pendingAgentRequest) {
		await handleConfirmationResponse(text);
		return;
	}

	// Get current tab URL
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	const currentUrl = tab?.url || '';

	// Detect intent
	const intentResult = await detectIntent(text, currentUrl);
	console.log('[Panel] Intent:', intentResult);

	switch (intentResult.intent) {
		case INTENT.AGENT:
			await handleAgentIntent(text, intentResult.url, intentResult);
			break;
		case INTENT.RESEARCH:
			await handleResearchIntent(text, currentUrl);
			break;
		case INTENT.SIMPLE:
		default:
			await handleSimpleIntent(text, currentUrl);
			break;
	}
});

// =============================================================================
// Metrics Helper
// =============================================================================

function postMetrics(record) {
	fetch(`${SERVER_BASE}/api/metrics`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(record)
	}).catch((err) => console.warn('[Panel] Metrics post failed:', err.message));
}

// =============================================================================
// Intent Handlers
// =============================================================================

async function handleSimpleIntent(text, currentUrl) {
	const startTime = Date.now();
	showThinkingIndicator();
	try {
		const botResponse = await sendToBot(text, currentUrl);
		removeThinkingIndicator();
		if (botResponse?.text) {
			addMessage('bot', botResponse.text);
		}
		postMetrics({
			type: 'flow_complete',
			flow: 'simple',
			timestamp: new Date().toISOString(),
			turnaroundMs: Date.now() - startTime
		});
	} catch (error) {
		removeThinkingIndicator();
		console.error('[Panel] Simple mode error:', error);
		addMessage('bot', `Error: ${error.message}`);
	}
}

async function handleResearchIntent(text, currentUrl) {
	const startTime = Date.now();
	const actions = [];
	showThinkingIndicator();
	try {
		updateHeaderProgress('Researching...');

		const result = await runReActLoop(text, currentUrl, (stepInfo) => {
			actions.push(stepInfo.action);
			const desc = getActionDescription(stepInfo);
			updateHeaderProgress(desc);
		});

		removeThinkingIndicator();
		updateHeaderProgress('');
		const answer = result.answer || 'I was unable to find an answer to your question.';
		addMessage('bot', answer);

		postMetrics({
			type: 'flow_complete',
			flow: 'research',
			timestamp: new Date().toISOString(),
			turnaroundMs: Date.now() - startTime,
			iterations: result.iterations,
			actions,
			bailedOut: result.bailedOut || false,
			hitLimit: result.hitLimit || false
		});

		// Store the user query and final answer in conversation history
		try {
			await fetch(`${SERVER_BASE}/api/history/add`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					userId: getUserId(),
					messages: [
						{ role: 'user', content: text },
						{ role: 'assistant', content: answer }
					]
				})
			});
		} catch (histErr) {
			console.error('[Panel] Failed to store research history:', histErr);
		}
	} catch (error) {
		removeThinkingIndicator();
		updateHeaderProgress('');
		console.error('[Panel] Research mode error:', error);
		addMessage('bot', `Error: ${error.message}`);
	}
}

async function handleAgentIntent(text, url, intentResult) {
	if (!url) {
		addMessage('bot', "I couldn't determine the target URL. Please include a URL or be more specific about the website.");
		return;
	}

	// Check if profile exists on server
	const hasProfile = await isProfileUnlocked();
	if (!hasProfile) {
		addMessage('bot', 'No profile found. Please set up your profile in Settings first.');
		return;
	}

	// Ask for confirmation
	const confidence = intentResult.confidence === 'high' ? '' : ' (I think)';
	addMessage('bot', `This looks like a task for the web agent${confidence}. Should I proceed?`);
	pendingAgentRequest = { text, url };
}

async function handleConfirmationResponse(text) {
	const lower = text.toLowerCase().trim();
	const affirmative = /^(yes|yeah|yep|sure|ok|okay|go ahead|proceed|do it|y)$/.test(lower);
	const negative = /^(no|nope|nah|cancel|stop|nevermind|never mind|n)$/.test(lower);

	if (negative) {
		addMessage('bot', 'Okay, I won\'t start the agent. Let me know if you need anything else.');
		pendingAgentRequest = null;
		return;
	}

	if (!affirmative) {
		// Ambiguous response
		addMessage('bot', 'I didn\'t catch that. Should I proceed with the agent task? (yes/no)');
		return;
	}

	// User confirmed
	const { text: goalText, url } = pendingAgentRequest;
	pendingAgentRequest = null;

	await executeAgentTask(goalText, url);
}

async function executeAgentTask(goal, url) {
	try {
		// Start agent if not already running
		if (!hasActiveSession()) {
			const taskId = `task-${Date.now()}`;
			await startAgentSession(taskId);
			showStopButton();
		}

		const label = agentLabel(getAgentSession().port);
		addMessage('bot', `${label}: Starting task`);
		updateHeaderProgress(`${label}: Working...`);
		const result = await executeAgentGoal(goal, url);

		// Terminal statuses (achieved/failed/blocked) are handled via SSE in handleAgentStatusEvent

	} catch (error) {
		updateHeaderProgress('');
		console.error('[Panel] Agent task error:', error);
		addMessage('bot', `Agent error: ${error.message}`);
	}
}

function getActionDescription(stepInfo) {
	switch (stepInfo.action) {
		case 'search':
			return `Searching: "${stepInfo.action_input}"`;
		case 'fetch_current_page':
			return 'Reading current page...';
		case 'fetch_url':
			return `Fetching: ${stepInfo.action_input}`;
		case 'answer':
		case 'bailout':
			return 'Formulating answer...';
		case 'max_depth_reached':
			return 'Reached maximum research depth';
		default:
			return `Action: ${stepInfo.action}`;
	}
}

// =============================================================================
// Banner Continue
// =============================================================================

bannerContinue.addEventListener('click', async () => {
	hideStickyBanner();
	updateHeaderProgress(`${agentLabel(getAgentSession().port)}: Continuing...`);

	try {
		await provideAgentInput({});
	} catch (error) {
		console.error('[Panel] Continue error:', error);
		addMessage('bot', `Error: ${error.message}`);
	}
});

// =============================================================================
// Agent Stop Controls
// =============================================================================

function isStopCommand(text) {
	const lower = text.toLowerCase().trim();
	return /^(stop|cancel|abort|quit|nevermind|never mind|stop agent|cancel agent)$/.test(lower);
}

async function handleStopAgent() {
	addMessage('bot', 'Stopping the agent...');
	try {
		await stopAgentSession();
		updateHeaderProgress('');
		addMessage('bot', 'Agent stopped.');
		hideStopButton();
		hideStickyBanner();
		removeCurrentForm();
	} catch (error) {
		console.error('[Panel] Stop agent error:', error);
		addMessage('bot', `Error stopping agent: ${error.message}`);
	}
}

onStopAgentClick(handleStopAgent);

// =============================================================================
// Button Handlers
// =============================================================================

closeBtn.addEventListener('click', () => {
	chrome.runtime.sendMessage({ type: 'WEBCHAT_CLOSE' });
});

optionsBtn.addEventListener('click', () => {
	chrome.runtime.openOptionsPage();
});

// =============================================================================
// Initialization
// =============================================================================

addMetaMessage('Shortcut: Ctrl+Shift+Y | Type a message to start');
