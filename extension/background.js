// extension/background.js
import { ensureServices, stopServices, getServiceStatus, onStatusChange } from './serviceManager.js';

const PATH = 'panel.html';
const openPanels = new Set();
let activeTabId = null;

// Forward status changes to any open panels
onStatusChange((status) => {
	chrome.runtime.sendMessage({ type: 'SERVICE_STATUS', ...status }).catch(() => {});
});

// initial configuration options
chrome.runtime.onInstalled.addListener((details) => {
	if (details.reason !== 'install') return;
	chrome.storage.local.set({
		isTestingMode: false,
		provider: 'anthropic',
		modelType: 'claude-haiku-4-5',
		agentProvider: 'anthropic',
		agentModelType: 'claude-haiku-4-5'
	});
});

// keep track of the currently active tab and pre-enable its side panel path
chrome.tabs.onActivated.addListener(({tabId}) => {
	chrome.sidePanel.setOptions({tabId, path: PATH, enabled: true});
	activeTabId = tabId;
});
chrome.windows.onFocusChanged.addListener(async (winId) => {
	if (winId === chrome.windows.WINDOW_ID_NONE) return;
	const [tab] = await chrome.tabs.query({active: true, windowId: winId});
	if (tab?.id) activeTabId = tab.id;
});

// background message handling
chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
	console.log('[BG] Message received:', m?.type, m);
	// service status query from panel
	if (m?.type === 'GET_SERVICE_STATUS') {
		sendResponse(getServiceStatus());
		return;
	}
	// panel open: always ensure services (idempotent via health checks)
	if (m?.type === "PANEL_OPEN" && m.tabId) {
		openPanels.add(m.tabId);
		console.log('[BG] Panel opened, tab:', m.tabId, 'panels:', openPanels.size);
		ensureServices().then(
			(s) => console.log('[BG] Services started:', s),
			(e) => console.warn('[BG] Service auto-start unavailable:', e.message)
		);
	}
	// panel close: stop services if this was the last panel
	if (m?.type === "PANEL_CLOSED" && m.tabId) {
		openPanels.delete(m.tabId);
		if (openPanels.size === 0) {
			stopServices();
			console.log('[BG] Last panel closed, stopping services');
		}
	}
	// close panel via UI
	if (m?.type === 'WEBCHAT_CLOSE') {
		chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
			const tabId = tabs[0]?.id;
			if (!tabId) return;
			chrome.sidePanel.setOptions({ tabId, enabled: false });
			openPanels.delete(tabId);
			if (openPanels.size === 0) {
				stopServices();
				console.log('[BG] Last panel closed (via UI), stopping services');
			}
		});
	}
});

// toggle panel via toolbar or shortcut
function toggleForActiveTab() {
	chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
		const tabId = tabs[0]?.id;
		if (!tabId) return;

		if (openPanels.has(tabId)) {
			chrome.sidePanel.setOptions({ tabId, enabled: false });
			openPanels.delete(tabId);
			if (openPanels.size === 0) {
				stopServices();
				console.log('[BG] Last panel closed (via toggle), stopping services');
			}
		} else {
			chrome.sidePanel.setOptions({ tabId, path: PATH, enabled: true });
			chrome.sidePanel.open({ tabId }); // runs within the user gesture
			openPanels.add(tabId);
		}
	});
}

// toolbar click
chrome.action.onClicked.addListener(() => { toggleForActiveTab(); });

// shortcut
chrome.commands.onCommand.addListener((cmd) => { if (cmd === "toggle-panel") toggleForActiveTab(); });
