import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupDOM } from './helpers.js';

// Mock all dependencies before importing panel.js
vi.mock('../config.js', () => ({
	SERVER_BASE: 'http://localhost:8787',
	loadConfig: vi.fn(() => Promise.resolve({ providers: {}, extension: {} })),
	getConfig: vi.fn(() => ({ providers: {}, extension: { userId: 1 }, agent: { maxSteps: 20 } })),
	getUserId: vi.fn(() => 1)
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

const mockAddMessage = vi.fn();
const mockAddMetaMessage = vi.fn();
const mockShowThinkingIndicator = vi.fn();
const mockRemoveThinkingIndicator = vi.fn();
const mockUpdateHeaderProgress = vi.fn();
const mockRenderInputForm = vi.fn();
const mockRemoveCurrentForm = vi.fn();
const mockShowStickyBanner = vi.fn();
const mockHideStickyBanner = vi.fn();
const mockShowStopButton = vi.fn();
const mockHideStopButton = vi.fn();
const mockOnStopAgentClick = vi.fn();

vi.mock('../ui.js', () => ({
	addMessage: mockAddMessage,
	addMetaMessage: mockAddMetaMessage,
	showThinkingIndicator: mockShowThinkingIndicator,
	removeThinkingIndicator: mockRemoveThinkingIndicator,
	updateHeaderProgress: mockUpdateHeaderProgress,
	renderInputForm: mockRenderInputForm,
	removeCurrentForm: mockRemoveCurrentForm,
	showStickyBanner: mockShowStickyBanner,
	hideStickyBanner: mockHideStickyBanner,
	showStopButton: mockShowStopButton,
	hideStopButton: mockHideStopButton,
	onStopAgentClick: mockOnStopAgentClick
}));

function setupPanelDOM() {
	setupDOM();

	const form = document.createElement('form');
	form.id = 'form';
	const input = document.createElement('input');
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

	return { form, input };
}

describe('panel.js', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));
		setupPanelDOM();
		vi.resetModules();
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
		await import('../panel.js');
		expect(mockAddMetaMessage).toHaveBeenCalledWith(expect.stringContaining('Ctrl+Shift+Y'));
	});

	it('registers onStopAgentClick handler', async () => {
		await import('../panel.js');
		expect(mockOnStopAgentClick).toHaveBeenCalledWith(expect.any(Function));
	});

	it('testing mode echoes messages', async () => {
		chrome.storage.local.get.mockImplementation((keys) => {
			if (Array.isArray(keys) && keys.includes('isTestingMode')) {
				return Promise.resolve({ isTestingMode: true });
			}
			return Promise.resolve({});
		});
		await import('../panel.js');

		const form = document.getElementById('form');
		const input = document.getElementById('prompt');
		input.value = 'hello test';
		form.dispatchEvent(new Event('submit', { cancelable: true }));

		// Wait for async handler to execute
		await new Promise(r => setTimeout(r, 0));

		expect(mockAddMessage).toHaveBeenCalledWith('user', 'hello test');
		expect(mockAddMessage).toHaveBeenCalledWith('bot', 'Echo: hello test');
	});

	it('simple intent routes through sendToBot', async () => {
		mockDetectIntent.mockResolvedValue({ intent: 'simple' });
		mockSendToBot.mockResolvedValue({ text: 'Bot reply' });

		await import('../panel.js');

		const form = document.getElementById('form');
		const input = document.getElementById('prompt');
		input.value = 'What is this page?';
		form.dispatchEvent(new Event('submit', { cancelable: true }));

		await new Promise(r => setTimeout(r, 50));

		expect(mockShowThinkingIndicator).toHaveBeenCalled();
		expect(mockSendToBot).toHaveBeenCalledWith('What is this page?', 'https://example.com');
		expect(mockRemoveThinkingIndicator).toHaveBeenCalled();
		expect(mockAddMessage).toHaveBeenCalledWith('bot', 'Bot reply');
	});

	it('research intent routes through runReActLoop', async () => {
		mockDetectIntent.mockResolvedValue({ intent: 'research' });
		mockRunReActLoop.mockResolvedValue({ answer: 'Research result', iterations: 2 });

		await import('../panel.js');

		const form = document.getElementById('form');
		const input = document.getElementById('prompt');
		input.value = 'Compare X and Y';
		form.dispatchEvent(new Event('submit', { cancelable: true }));

		await new Promise(r => setTimeout(r, 50));

		expect(mockRunReActLoop).toHaveBeenCalled();
		expect(mockAddMessage).toHaveBeenCalledWith('bot', 'Research result');
	});

	it('agent intent without URL shows error message', async () => {
		mockDetectIntent.mockResolvedValue({ intent: 'agent', url: null, confidence: 'high' });

		await import('../panel.js');

		const form = document.getElementById('form');
		const input = document.getElementById('prompt');
		input.value = 'Sign me up';
		form.dispatchEvent(new Event('submit', { cancelable: true }));

		await new Promise(r => setTimeout(r, 50));

		expect(mockAddMessage).toHaveBeenCalledWith('bot', expect.stringContaining("couldn't determine the target URL"));
	});

	it('agent intent without profile shows setup message', async () => {
		mockDetectIntent.mockResolvedValue({ intent: 'agent', url: 'https://example.com', confidence: 'high' });
		mockIsProfileUnlocked.mockResolvedValue(false);

		await import('../panel.js');

		const form = document.getElementById('form');
		const input = document.getElementById('prompt');
		input.value = 'Sign me up at https://example.com';
		form.dispatchEvent(new Event('submit', { cancelable: true }));

		await new Promise(r => setTimeout(r, 50));

		expect(mockAddMessage).toHaveBeenCalledWith('bot', expect.stringContaining('No profile found'));
	});

	it('does not submit empty messages', async () => {
		await import('../panel.js');

		const form = document.getElementById('form');
		const input = document.getElementById('prompt');
		input.value = '   ';
		form.dispatchEvent(new Event('submit', { cancelable: true }));

		await new Promise(r => setTimeout(r, 0));

		expect(mockAddMessage).not.toHaveBeenCalled();
	});
});
