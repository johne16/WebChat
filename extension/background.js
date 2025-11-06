// extension/background.js
const PATH = 'panel.html';
const openPanels = new Set();
let activeTabId = null;

// initial configuration options
chrome.runtime.onInstalled.addListener(() => {
	chrome.storage.local.set({
		isTestingMode: false,
		modelType: 'gpt-5-nano',
		useReActMode: true  // Enable ReAct mode by default
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
chrome.runtime.onMessage.addListener((m) => {
    // panel open/close status
    if (m?.type === "PANEL_OPEN" && m.tabId) openPanels.add(m.tabId);
    if (m?.type === "PANEL_CLOSED" && m.tabId) openPanels.delete(m.tabId);
    // close panel via UI
    if (m?.type === 'WEBCHAT_CLOSE') {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            const tabId = tabs[0]?.id;
            if (!tabId) return;
            chrome.sidePanel.setOptions({ tabId, enabled: false });
            openPanels.delete(tabId);
        });
    }
});

// toggle panel via toolbar or shortcut
function toggleForActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tabId = tabs[0]?.id;
        if (!tabId) return;

        if (openPanels.has(tabId)) {
            // chrome.runtime.sendMessage({ type: "WEBCHAT_CLOSE" }, () => void chrome.runtime.lastError);
            chrome.sidePanel.setOptions({ tabId, enabled: false });
            openPanels.delete(tabId);
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
