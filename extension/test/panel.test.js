import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupDOM } from './helpers.js';

// Mock all dependencies before importing panel.js
vi.mock('../config.js', () => ({
	SERVER_BASE: 'http://localhost:8787',
	loadConfig: vi.fn(() => Promise.resolve({ providers: {}, extension: {} })),
	getConfig: vi.fn(() => ({ providers: {}, extension: { userId: 1 }, agent: { maxSteps: 20 } }))
}));

const mockSendToBot = vi.fn();
vi.mock('../llmClient.js', () => ({
	sendToBot: mockSendToBot
}));

const mockRunReActLoop = vi.fn();
vi.mock('../react.js', () => ({
	runReActLoop: mockRunReActLoop
}));

const mockConnectSSE = vi.fn(() => ({}));
const mockDisconnectSSE = vi.fn();
vi.mock('../agentClient.js', () => ({
	connectSSE: mockConnectSSE,
	disconnectSSE: mockDisconnectSSE
}));

const mockDetectIntent = vi.fn();
vi.mock('../intent.js', () => ({
	detectIntent: mockDetectIntent,
	INTENT: { SIMPLE: 'simple', RESEARCH: 'research', AGENT: 'agent' }
}));

const mockIsProfileUnlocked = vi.fn(() => Promise.resolve(false));
const mockHasActiveSession = vi.fn(() => false);
const mockStartAgentSession = vi.fn();
const mockExecuteAgentGoal = vi.fn();
const mockProvideAgentInput = vi.fn();
const mockStopAgentSession = vi.fn();
const mockClearAgentSession = vi.fn();
const mockCleanup = vi.fn();
const mockGetAgentSession = vi.fn(() => ({ sessionId: null, port: null, taskId: null }));

vi.mock('../agent.js', () => ({
	isProfileUnlocked: mockIsProfileUnlocked,
	getAgentSession: mockGetAgentSession,
	hasActiveSession: mockHasActiveSession,
	startAgentSession: mockStartAgentSession,
	executeAgentGoal: mockExecuteAgentGoal,
	provideAgentInput: mockProvideAgentInput,
	stopAgentSession: mockStopAgentSession,
	clearAgentSession: mockClearAgentSession,
	cleanup: mockCleanup
}));

vi.mock('../ui.js', () => ({
	addMessage: vi.fn(),
	addMetaMessage: vi.fn(),
	showThinkingIndicator: vi.fn(),
	removeThinkingIndicator: vi.fn(),
	updateHeaderProgress: vi.fn(),
	renderInputForm: vi.fn(),
	removeCurrentForm: vi.fn(),
	showStickyBanner: vi.fn(),
	hideStickyBanner: vi.fn(),
	showStopButton: vi.fn(),
	hideStopButton: vi.fn(),
	onStopAgentClick: vi.fn()
}));

describe('panel.js', () => {
	let form, input;

	beforeEach(async () => {
		vi.clearAllMocks();
		// Reset fetch mock
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));

		// Setup minimal panel DOM
		setupDOM();

		// Additional panel-specific DOM elements
		form = document.createElement('form');
		form.id = 'form';
		input = document.createElement('input');
		input.id = 'prompt';
		form.appendChild(input);
		document.body.appendChild(form);

		const closeBtn = document.createElement('button');
		closeBtn.id = 'close';
		document.body.appendChild(closeBtn);

		const optionsBtn = document.createElement('button');
		optionsBtn.id = 'open-options';
		document.body.appendChild(optionsBtn);

		const bannerContinue = document.createElement('button');
		bannerContinue.id = 'banner-continue';
		document.body.appendChild(bannerContinue);

		// Reset modules to re-run panel.js with fresh DOM
		vi.resetModules();

		// Re-mock chrome.tabs.query to return a tab
		chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
		chrome.storage.local.get.mockImplementation((keys) => {
			if (Array.isArray(keys) && keys.includes('isTestingMode')) {
				return Promise.resolve({ isTestingMode: false });
			}
			return Promise.resolve({});
		});
	});

	it('module loads without throwing', async () => {
		await expect(import('../panel.js')).resolves.not.toThrow();
	});

	it('calls connectSSE on load', async () => {
		await import('../panel.js');
		expect(mockConnectSSE).toHaveBeenCalled();
	});

	it('calls addMetaMessage on init', async () => {
		const { addMetaMessage } = await import('../ui.js');
		await import('../panel.js');
		expect(addMetaMessage).toHaveBeenCalledWith(expect.stringContaining('Ctrl+Shift+Y'));
	});

	it('registers onStopAgentClick handler', async () => {
		const { onStopAgentClick } = await import('../ui.js');
		await import('../panel.js');
		expect(onStopAgentClick).toHaveBeenCalledWith(expect.any(Function));
	});
});
