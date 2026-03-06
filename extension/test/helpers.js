import { vi } from 'vitest';

// Shared test utilities

/**
 * Stub globalThis.fetch to return a mock Response
 * @param {*} responseBody - Body to return from response.json()
 * @param {Object} options - { ok, status, headers }
 */
export function mockFetch(responseBody, options = {}) {
	const { ok = true, status = 200, headers = {} } = options;
	vi.stubGlobal('fetch', vi.fn(() =>
		Promise.resolve({
			ok,
			status,
			json: () => Promise.resolve(responseBody),
			text: () => Promise.resolve(JSON.stringify(responseBody)),
			headers: new Headers(headers)
		})
	));
}

/**
 * Reset all chrome.* vi.fn() calls
 */
export function resetChromeMocks() {
	chrome.storage.local.get.mockClear();
	chrome.storage.local.set.mockClear();
	chrome.storage.local.remove.mockClear();
	chrome.storage.onChanged.addListener.mockClear();
	chrome.storage.local.onChanged.addListener.mockClear();
	chrome.tabs.query.mockClear();
	chrome.tabs.onActivated.addListener.mockClear();
	chrome.runtime.sendMessage.mockClear();
	chrome.runtime.onMessage.addListener.mockClear();
	chrome.runtime.onInstalled.addListener.mockClear();
	chrome.action.onClicked.addListener.mockClear();
	chrome.commands.onCommand.addListener.mockClear();
	chrome.sidePanel.setOptions.mockClear();
	chrome.sidePanel.open.mockClear();
	chrome.windows.onFocusChanged.addListener.mockClear();
}

/**
 * Create minimal DOM elements that ui.js expects
 */
export function setupDOM() {
	document.body.innerHTML = '';

	const elements = [
		{ tag: 'div', id: 'log' },
		{ tag: 'div', id: 'sticky-banner' },
		{ tag: 'span', id: 'banner-message' },
		{ tag: 'span', id: 'header-progress' },
		{ tag: 'div', id: 'password-modal' },
		{ tag: 'input', id: 'modal-passphrase' },
		{ tag: 'button', id: 'modal-cancel' },
		{ tag: 'button', id: 'modal-submit' },
		{ tag: 'button', id: 'stop-agent-btn' }
	];

	elements.forEach(({ tag, id }) => {
		const el = document.createElement(tag);
		el.id = id;
		document.body.appendChild(el);
	});
}
