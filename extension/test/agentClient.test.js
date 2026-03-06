import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockFetch } from './helpers.js';

vi.mock('../config.js', () => ({
	SERVER_BASE: 'http://localhost:8787'
}));

// Mock EventSource
class MockEventSource {
	constructor(url) {
		this.url = url;
		this.readyState = 0; // CONNECTING
		this._listeners = {};
		this.close = vi.fn(() => { this.readyState = 2; });
	}
	addEventListener(event, handler) {
		if (!this._listeners[event]) this._listeners[event] = [];
		this._listeners[event].push(handler);
	}
	removeEventListener(event, handler) {
		if (this._listeners[event]) {
			this._listeners[event] = this._listeners[event].filter(h => h !== handler);
		}
	}
	// Helper: simulate an event
	_emit(event, data) {
		const handlers = this._listeners[event] || [];
		handlers.forEach(h => h({ data: JSON.stringify(data) }));
	}
}
MockEventSource.OPEN = 1;

// Must import after mocks
let agentClient;
let originalEventSource;

describe('agentClient.js', () => {
	beforeEach(async () => {
		vi.resetModules();
		vi.restoreAllMocks();
		originalEventSource = globalThis.EventSource;
		globalThis.EventSource = MockEventSource;
		agentClient = await import('../agentClient.js');
		// Ensure disconnected state
		agentClient.disconnectSSE();
	});

	afterEach(() => {
		globalThis.EventSource = originalEventSource;
	});

	describe('startAgent', () => {
		it('sends POST to /api/agent/start with taskId', async () => {
			mockFetch({ success: true, port: 5001, taskId: 'task-1' });

			const result = await agentClient.startAgent('task-1');

			expect(globalThis.fetch).toHaveBeenCalledWith(
				'http://localhost:8787/api/agent/start',
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify({ taskId: 'task-1' })
				})
			);
			expect(result.port).toBe(5001);
		});

		it('throws when taskId is missing', async () => {
			await expect(agentClient.startAgent()).rejects.toThrow('taskId is required');
		});

		it('throws on HTTP error', async () => {
			mockFetch({ error: 'No ports available' }, { ok: false, status: 503 });
			await expect(agentClient.startAgent('task-1')).rejects.toThrow('No ports available');
		});
	});

	describe('executeGoal', () => {
		it('sends goal with profile and options', async () => {
			mockFetch({ status: 'running', sessionId: 'sess-1' });

			const result = await agentClient.executeGoal(
				5001,
				'Sign up',
				'https://example.com',
				{ firstName: 'John' },
				{ provider: 'openai', model: 'gpt-5.2' }
			);

			const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
			expect(body.port).toBe(5001);
			expect(body.goal).toBe('Sign up');
			expect(body.startUrl).toBe('https://example.com');
			expect(body.userProfile).toEqual({ firstName: 'John' });
			expect(body.provider).toBe('openai');
			expect(body.model).toBe('gpt-5.2');
			expect(body.options.headless).toBe(false);
			expect(result.sessionId).toBe('sess-1');
		});
	});

	describe('stopAgent', () => {
		it('sends POST with port', async () => {
			mockFetch({ success: true });

			await agentClient.stopAgent(5001);

			const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
			expect(body.port).toBe(5001);
		});
	});

	describe('getAgentStatus', () => {
		it('sends GET request', async () => {
			mockFetch({ agents: [], availablePorts: [5001, 5002] });

			const result = await agentClient.getAgentStatus();

			expect(globalThis.fetch).toHaveBeenCalledWith('http://localhost:8787/api/agent/status');
			expect(result.availablePorts).toHaveLength(2);
		});
	});

	describe('provideInput', () => {
		it('sends input data with session info', async () => {
			mockFetch({ status: 'running' });

			await agentClient.provideInput(5001, 'sess-1', { username: 'bob' }, 'openai', 'gpt-5.2');

			const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
			expect(body.port).toBe(5001);
			expect(body.sessionId).toBe('sess-1');
			expect(body.inputData).toEqual({ username: 'bob' });
			expect(body.provider).toBe('openai');
			expect(body.model).toBe('gpt-5.2');
		});
	});

	describe('SSE management', () => {
		it('connectSSE creates EventSource with correct URL', () => {
			const es = agentClient.connectSSE();

			expect(es).toBeInstanceOf(MockEventSource);
			expect(es.url).toBe('http://localhost:8787/api/events');
		});

		it('connectSSE returns existing connection on second call', () => {
			const es1 = agentClient.connectSSE();
			const es2 = agentClient.connectSSE();
			expect(es1).toBe(es2);
		});

		it('addSSEHandler registers a handler that fires on events', () => {
			const es = agentClient.connectSSE();
			const handler = vi.fn();
			agentClient.addSSEHandler('agent-status', handler);

			es._emit('agent-status', { status: 'running' });
			expect(handler).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(String) }));
		});

		it('removeSSEHandler prevents handler from firing', () => {
			const es = agentClient.connectSSE();
			const handler = vi.fn();
			agentClient.addSSEHandler('agent-status', handler);
			agentClient.removeSSEHandler('agent-status', handler);

			es._emit('agent-status', { status: 'running' });
			expect(handler).not.toHaveBeenCalled();
		});

		it('disconnectSSE closes the connection', () => {
			const es = agentClient.connectSSE();
			agentClient.disconnectSSE();
			expect(es.close).toHaveBeenCalled();
		});

		it('disconnectSSE is safe when not connected', () => {
			expect(() => agentClient.disconnectSSE()).not.toThrow();
		});

		it('isSSEConnected returns false after disconnect', () => {
			agentClient.connectSSE();
			agentClient.disconnectSSE();
			expect(agentClient.isSSEConnected()).toBe(false);
		});
	});
});
