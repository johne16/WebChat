import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetChromeMocks } from './helpers.js';

describe('background.js', () => {
	let capturedListeners;

	beforeEach(async () => {
		vi.resetModules();
		resetChromeMocks();

		capturedListeners = {
			onInstalled: null,
			onActivated: null,
			onFocusChanged: null,
			onMessage: null,
			onClicked: null,
			onCommand: null
		};

		chrome.runtime.onInstalled.addListener.mockImplementation((fn) => {
			capturedListeners.onInstalled = fn;
		});
		chrome.tabs.onActivated.addListener.mockImplementation((fn) => {
			capturedListeners.onActivated = fn;
		});
		chrome.windows.onFocusChanged.addListener.mockImplementation((fn) => {
			capturedListeners.onFocusChanged = fn;
		});
		chrome.runtime.onMessage.addListener.mockImplementation((fn) => {
			capturedListeners.onMessage = fn;
		});
		chrome.action.onClicked.addListener.mockImplementation((fn) => {
			capturedListeners.onClicked = fn;
		});
		chrome.commands.onCommand.addListener.mockImplementation((fn) => {
			capturedListeners.onCommand = fn;
		});

		await import('../background.js');
	});

	it('registers onInstalled listener that sets default storage', () => {
		expect(capturedListeners.onInstalled).not.toBeNull();
		capturedListeners.onInstalled({ reason: 'install' });
		expect(chrome.storage.local.set).toHaveBeenCalledWith(
			expect.objectContaining({
				isTestingMode: false,
				provider: 'anthropic',
				modelType: 'claude-haiku-4-5',
				agentProvider: 'anthropic',
				agentModelType: 'claude-haiku-4-5'
			})
		);
	});

	it('tracks tab activation via onActivated', () => {
		expect(capturedListeners.onActivated).not.toBeNull();
		capturedListeners.onActivated({ tabId: 42 });
		expect(chrome.sidePanel.setOptions).toHaveBeenCalledWith(
			expect.objectContaining({ tabId: 42, path: 'panel.html', enabled: true })
		);
	});

	it('updates active tab on window focus change', async () => {
		expect(capturedListeners.onFocusChanged).not.toBeNull();

		chrome.tabs.query.mockResolvedValue([{ id: 99 }]);
		await capturedListeners.onFocusChanged(1);

		expect(chrome.tabs.query).toHaveBeenCalledWith(
			expect.objectContaining({ active: true, windowId: 1 })
		);
	});

	it('ignores WINDOW_ID_NONE on focus change', async () => {
		chrome.tabs.query.mockClear();
		await capturedListeners.onFocusChanged(chrome.windows.WINDOW_ID_NONE);
		expect(chrome.tabs.query).not.toHaveBeenCalled();
	});

	it('tracks panel open/close via messages', () => {
		expect(capturedListeners.onMessage).not.toBeNull();

		// PANEL_OPEN
		capturedListeners.onMessage({ type: 'PANEL_OPEN', tabId: 10 });
		// PANEL_CLOSED
		capturedListeners.onMessage({ type: 'PANEL_CLOSED', tabId: 10 });
		// No throw, state managed internally
	});

	it('handles WEBCHAT_CLOSE message', async () => {
		// Source uses callback-style chrome.tabs.query(opts, callback)
		chrome.tabs.query.mockImplementation((opts, cb) => cb([{ id: 5 }]));
		capturedListeners.onMessage({ type: 'WEBCHAT_CLOSE' });
		expect(chrome.tabs.query).toHaveBeenCalled();
		expect(chrome.sidePanel.setOptions).toHaveBeenCalledWith(
			expect.objectContaining({ tabId: 5, enabled: false })
		);
	});

	it('registers action.onClicked listener', () => {
		expect(capturedListeners.onClicked).not.toBeNull();
	});

	it('registers commands.onCommand listener', () => {
		expect(capturedListeners.onCommand).not.toBeNull();
	});
});
