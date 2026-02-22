// extension/panel.js
// Main entry point - unified message handling with SSE integration

import { sendToBot } from './llmClient.js';
import { runReActLoop } from './react.js';
import { connectSSE, disconnectSSE, addSSEHandler } from './agentClient.js';
import { detectIntent, INTENT } from './intent.js';
import {
	isProfileUnlocked,
	unlockProfile,
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
	addStepMessage,
	addAgentStepMessage,
	addMetaMessage,
	renderInputForm,
	removeCurrentForm,
	showStickyBanner,
	hideStickyBanner
} from './ui.js';

// DOM elements
const form = document.getElementById('form');
const input = document.getElementById('prompt');
const closeBtn = document.getElementById('close');
const optionsBtn = document.getElementById('open-options');
const stopAgentBtn = document.getElementById('stop-agent-btn');
const passwordModal = document.getElementById('password-modal');
const modalPassphrase = document.getElementById('modal-passphrase');
const modalCancel = document.getElementById('modal-cancel');
const modalSubmit = document.getElementById('modal-submit');
const bannerContinue = document.getElementById('banner-continue');

// State
let isTestingMode = false;
let pendingAgentRequest = null;  // Stores {text, url} when awaiting confirmation
let lastSeenTimestamp = 0;       // For SSE reconnect deduplication

// Load settings
const stored = await chrome.storage.local.get(['isTestingMode']);
isTestingMode = stored.isTestingMode || false;

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== 'local') return;
	if ('isTestingMode' in changes) {
		isTestingMode = changes.isTestingMode.newValue;
	}
});

// Track panel state
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
	if (tab?.id) chrome.runtime.sendMessage({ type: 'PANEL_OPEN', tabId: tab.id });
});

window.addEventListener('unload', () => {
	chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
		if (tab?.id) chrome.runtime.sendMessage({ type: 'PANEL_CLOSED', tabId: tab.id });
	});
	disconnectSSE();
});

// =============================================================================
// SSE Setup
// =============================================================================

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

	// Only handle events for our session
	const session = getAgentSession();
	if (session.port && data.port !== session.port) {
		return;
	}

	switch (data.status) {
		case 'started':
			addAgentStepMessage(data.message || 'Agent started');
			showStopButton();
			break;
		case 'step_completed':
			addAgentStepMessage(data.message || `Step ${data.data?.step} completed`);
			break;
		case 'achieved':
			addMessage('bot', data.message || 'Task completed successfully!');
			hideStopButton();
			clearAgentSession();
			break;
		case 'failed':
		case 'blocked':
			addMessage('bot', data.message || 'Task failed');
			hideStopButton();
			clearAgentSession();
			break;
		case 'awaiting_user_action':
			showStickyBanner(data.message || 'Please complete the action in the browser');
			break;
	}
}

function handleNeedsInputEvent(data) {
	lastSeenTimestamp = data.timestamp || Date.now();

	// Only handle events for our session
	const session = getAgentSession();
	if (session.port && data.port !== session.port) {
		return;
	}

	addAgentStepMessage(`Agent needs: ${data.missingFields?.join(', ') || 'information'}`);
	addMessage('bot', data.message || 'Please provide the missing information:');

	renderInputForm(data.missingFields, null, async (formData) => {
		addAgentStepMessage('Continuing with provided information...');
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
// Intent Handlers
// =============================================================================

async function handleSimpleIntent(text, currentUrl) {
	try {
		const botResponse = await sendToBot(text, currentUrl);
		if (botResponse?.text) {
			addMessage('bot', botResponse.text);
		}
	} catch (error) {
		console.error('[Panel] Simple mode error:', error);
		addMessage('bot', `Error: ${error.message}`);
	}
}

async function handleResearchIntent(text, currentUrl) {
	try {
		addStepMessage('Starting research...');

		const result = await runReActLoop(text, currentUrl, (stepInfo) => {
			const desc = getActionDescription(stepInfo);
			addStepMessage(desc);
		});

		if (result.answer) {
			addMessage('bot', result.answer);
		} else {
			addMessage('bot', 'I was unable to find an answer to your question.');
		}
	} catch (error) {
		console.error('[Panel] Research mode error:', error);
		addMessage('bot', `Error: ${error.message}`);
	}
}

async function handleAgentIntent(text, url, intentResult) {
	if (!url) {
		addMessage('bot', "I couldn't determine the target URL. Please include a URL or be more specific about the website.");
		return;
	}

	// Check if profile is unlocked
	if (!isProfileUnlocked()) {
		// Store pending request and prompt for passphrase
		pendingAgentRequest = { text, url };
		addMessage('bot', `I'll help you with that on ${url}. First, I need to unlock your profile. Please enter your passphrase.`);
		showPasswordModal();
		return;
	}

	// Profile unlocked - ask for confirmation
	const confidence = intentResult.confidence === 'high' ? '' : ' (I think)';
	addMessage('bot', `This looks like a task for the web agent${confidence}. I'll open a browser and work on: "${text}" at ${url}. Should I proceed?`);
	pendingAgentRequest = { text, url };
}

async function handleConfirmationResponse(text) {
	const lower = text.toLowerCase().trim();
	const affirmative = /^(yes|yeah|yep|sure|ok|okay|go ahead|proceed|do it|y)$/i.test(lower);
	const negative = /^(no|nope|nah|cancel|stop|nevermind|never mind|n)$/i.test(lower);

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
			addAgentStepMessage('Starting agent...');
			const taskId = `task-${Date.now()}`;
			await startAgentSession(taskId);
			showStopButton();
		}

		addAgentStepMessage('Agent is working on your request...');
		const result = await executeAgentGoal(goal, url);

		// Handle immediate response (non-SSE path for backwards compatibility)
		if (result.status === 'achieved' || result.goalAchieved) {
			addMessage('bot', result.message || 'Task completed successfully!');
		} else if (result.status === 'failed' || result.status === 'blocked') {
			addMessage('bot', result.message || 'Task could not be completed.');
		}
		// needs_input and awaiting_user_action will come via SSE

	} catch (error) {
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
// Password Modal
// =============================================================================

function showPasswordModal() {
	passwordModal.classList.add('visible');
	modalPassphrase.value = '';
	modalPassphrase.focus();
}

function hidePasswordModal() {
	passwordModal.classList.remove('visible');
	modalPassphrase.value = '';
}

modalCancel.addEventListener('click', () => {
	hidePasswordModal();
	if (pendingAgentRequest) {
		addMessage('bot', 'Agent task cancelled.');
		pendingAgentRequest = null;
	}
});

modalSubmit.addEventListener('click', async () => {
	const passphrase = modalPassphrase.value;
	if (!passphrase) return;

	try {
		await unlockProfile(passphrase);
		hidePasswordModal();

		if (pendingAgentRequest) {
			const { text, url } = pendingAgentRequest;
			// Now ask for confirmation
			addMessage('bot', `Profile unlocked. I'll open a browser and work on: "${text}" at ${url}. Should I proceed?`);
		} else {
			addMessage('bot', 'Profile unlocked.');
		}
	} catch (error) {
		console.error('[Panel] Unlock error:', error);
		if (error.message.includes('decrypt')) {
			addMessage('bot', 'Incorrect passphrase. Please try again.');
		} else {
			addMessage('bot', `Error: ${error.message}`);
		}
		hidePasswordModal();
		pendingAgentRequest = null;
	}
});

modalPassphrase.addEventListener('keydown', (e) => {
	if (e.key === 'Enter') {
		e.preventDefault();
		modalSubmit.click();
	}
});

// =============================================================================
// Banner Continue
// =============================================================================

bannerContinue.addEventListener('click', async () => {
	hideStickyBanner();
	addAgentStepMessage('Continuing after user action...');

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
	return /^(stop|cancel|abort|quit|nevermind|never mind|stop agent|cancel agent)$/i.test(lower);
}

async function handleStopAgent() {
	addMessage('bot', 'Stopping the agent...');
	try {
		await stopAgentSession();
		addAgentStepMessage('Agent stopped');
		hideStopButton();
		hideStickyBanner();
		removeCurrentForm();
	} catch (error) {
		console.error('[Panel] Stop agent error:', error);
		addMessage('bot', `Error stopping agent: ${error.message}`);
	}
}

function showStopButton() {
	stopAgentBtn.hidden = false;
}

function hideStopButton() {
	stopAgentBtn.hidden = true;
}

stopAgentBtn.addEventListener('click', async () => {
	await handleStopAgent();
});

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

// Cleanup on close
window.addEventListener('beforeunload', () => {
	if (hasActiveSession()) {
		stopAgentSession().catch(() => {});
	}
});
