// extension/panel.js

import {sendToBot} from "./llmClient.js";
import {runReActLoop} from "./react.js";

const log = document.getElementById('log');
const form = document.getElementById('form');
const input = document.getElementById('prompt');
const closeBtn = document.getElementById('close');
const optionsBtn = document.getElementById('open-options');
const researchModeBtn = document.getElementById('research-mode-btn');

let {isTestingMode = false, modelType = '', useReActMode = true} =
	await chrome.storage.local.get(['isTestingMode', 'modelType', 'useReActMode']);

// Set initial researchModeBtn visual state
updateRMBtnState(useReActMode);

// updating user changed options from storage
chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== 'local') return;
	if ('isTestingMode' in changes) isTestingMode = changes.isTestingMode.newValue;
	if ('modelType' in changes) modelType = changes.modelType.newValue;
	// TODO_CLEANUP: Added ReAct mode toggle
	if ('useReActMode' in changes) {
		useReActMode = changes.useReActMode.newValue;
		updateRMBtnState(useReActMode);
	}
});

// track the status of the panel
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.id) chrome.runtime.sendMessage({ type: "PANEL_OPEN", tabId: tab.id });
});

window.addEventListener("unload", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab?.id) chrome.runtime.sendMessage({ type: "PANEL_CLOSED", tabId: tab.id });
    });
});

// chat box messages
function addMessage(role, text) {
	const row = document.createElement('div');
	row.className = `row ${role}`;
	const bubble = document.createElement('div');
	bubble.className = `msg ${role}`;
	bubble.textContent = text;
	row.appendChild(bubble);
	log.appendChild(row);
	log.scrollTop = log.scrollHeight;
}

// step status update messages
function addStepMessage(stepText) {
	const row = document.createElement('div');
	row.className = 'row step';
	const bubble = document.createElement('div');
	bubble.className = 'msg step';
	bubble.textContent = `🔍 ${stepText}`;
	row.appendChild(bubble);
	log.appendChild(row);
	log.scrollTop = log.scrollHeight;
}

form.addEventListener('submit', async(e) => {
	e.preventDefault();
	const text = input.value.trim();
	if (!text) return;
	addMessage('user', text);
	input.value = '';
	
	if (isTestingMode) {
		addMessage('bot', `Echo: ${text}`);
	} else {
		// Get current tab URL
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		const currentURL = tab?.url || '';

		if (useReActMode) {
			try {
				addStepMessage('Starting research...');
				
				// Pass callback to show steps in real-time
				const result = await runReActLoop(text, currentURL, (stepInfo) => {
					const actionDesc = getActionDescriptionFromStep(stepInfo);
					addStepMessage(`${actionDesc}`);
				});
				
				// Show final answer
				if (result.answer) {
					addMessage('bot', result.answer);
				} else {
					addMessage('bot', 'I was unable to find an answer to your question.');
				}

			} catch (error) {
				console.error('[Panel] ReAct error:', error);
				addMessage('bot', `Error: ${error.message}`);
			}
		} else {
			// Original simple mode
			const botResponse = await sendToBot(text, currentURL);
			if (botResponse?.text) addMessage('bot', botResponse.text);
		}
	}
});

function getActionDescriptionFromStep(stepInfo) {
	const action = stepInfo.action;
	if (action === 'search') {
		return `Searching: "${stepInfo.action_input}"`;
	} else if (action === 'fetch_current_page') {
		return 'Reading current page...';
	} else if (action === 'fetch_url') {
		return `Fetching: ${stepInfo.action_input}`;
	} else if (action === 'answer') {
		return 'Formulating answer...';
	} else if (action === 'bailout') {
        return 'Formulating answer...';
    } else if (action === 'max_depth_reached') {
        return 'Reached maximum research depth';
    }
}


// close button
closeBtn.addEventListener('click', () => {
    console.log('close');
    chrome.runtime.sendMessage({ type: 'WEBCHAT_CLOSE' });
});

// options button
optionsBtn.addEventListener('click', () => {
	chrome.runtime.openOptionsPage();
});

// Current project status
const meta = document.createElement('div');
meta.className = 'meta';
meta.textContent = 'Shortcut to open: Ctrl+Shift+Y';
log.appendChild(meta);

// Update researchModeBtn visual state based on research mode
function updateRMBtnState(isResearchMode) {
	if (isResearchMode) {
		researchModeBtn.classList.add('active');
		researchModeBtn.setAttribute('title', 'Research mode (ON)');
		researchModeBtn.setAttribute('aria-label', 'Research mode enabled');
	} else {
		researchModeBtn.classList.remove('active');
		researchModeBtn.setAttribute('title', 'Simple mode (OFF)');
		researchModeBtn.setAttribute('aria-label', 'Research mode disabled');
	}
}

// Toggle research mode when researchModeBtn is clicked
researchModeBtn.addEventListener('click', () => {
	useReActMode = !useReActMode;
	chrome.storage.local.set({ useReActMode });
	updateRMBtnState(useReActMode);
});