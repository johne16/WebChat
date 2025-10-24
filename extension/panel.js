// extension/panel.js
import {extractUserVisibleHTML} from "./extraction.js";
import {sendToBot} from "./llmClient.js";

const log = document.getElementById('log');
const form = document.getElementById('form');
const input = document.getElementById('prompt');
const closeBtn = document.getElementById('close');
const optionsBtn = document.getElementById('open-options');
let {isTestingMode = false, modelType = ''} =
	await chrome.storage.local.get(['isTestingMode', 'modelType']);

// updating user changed options from storage
chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== 'local') return;
	if ('isTestingMode' in changes) isTestingMode = changes.isTestingMode.newValue;
	if ('modelType' in changes) modelType = changes.modelType.newValue;
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

// extract and parse html from the page
async function getCleanHTML() {
    return new Promise(resolve => {
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
            if (!tab?.id) return resolve("");
            const tabId = tab.id;
            chrome.scripting.executeScript(
                { target: { tabId }, files: ["contentScript.js"] },
                () => {
                    if (chrome.runtime.lastError) {
                        console.log("Injection error:", chrome.runtime.lastError.message);
                        return resolve("");
                    }
                    console.log("Sending extraction request to tab:", tabId, tab.url);
                    chrome.tabs.sendMessage(tabId, { type: "GET_RAW_HTML" }, res => {
                        if (chrome.runtime.lastError) {
                            console.log("Message error:", chrome.runtime.lastError.message);
                            return resolve("");
                        }
                        resolve(extractUserVisibleHTML(res?.html || ""));
                    });
                }
            );
        });
    });
}

let cleanHTML = await getCleanHTML();
console.log(cleanHTML);

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

form.addEventListener('submit', async(e) => {
	e.preventDefault();
	const text = input.value.trim();
	if (!text) return;
	addMessage('user', text);
	input.value = '';
	if (isTestingMode) {
		addMessage('bot', `Echo: ${text}`);
	} else {
		const botResponse = await sendToBot(text, cleanHTML);
        if (botResponse?.text) addMessage('bot', botResponse.text);
	}
});

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