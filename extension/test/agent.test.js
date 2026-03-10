import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({
	SERVER_BASE: 'http://localhost:8787',
	getConfig: vi.fn(() => ({
		providers: {
			defaultAgentProvider: 'openai',
			defaultAgentModel: 'gpt-5.2'
		},
		extension: {
			profile: { defaultCountry: 'United States' },
			userId: 1
		}
	}))
}));

const mockStartAgent = vi.fn();
const mockStopAgent = vi.fn();
const mockExecuteGoal = vi.fn();
const mockProvideInput = vi.fn();
vi.mock('../agentClient.js', () => ({
	startAgent: mockStartAgent,
	stopAgent: mockStopAgent,
	executeGoal: mockExecuteGoal,
	provideInput: mockProvideInput
}));

vi.mock('../utils.js', () => ({
	extractDomain: vi.fn((url) => {
		try { return new URL(url).hostname; } catch { return url; }
	})
}));

let transformProfileForAgent, startAgentSession,
	executeAgentGoal, provideAgentInput, stopAgentSession,
	isProfileUnlocked, hasActiveSession, clearAgentSession, getAgentSession;

describe('agent.js', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
		// Mock fetch for isProfileUnlocked server calls
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ profile: { first_name: 'Test' } })
		}));
		const agent = await import('../agent.js');
		transformProfileForAgent = agent.transformProfileForAgent;
		startAgentSession = agent.startAgentSession;
		executeAgentGoal = agent.executeAgentGoal;
		provideAgentInput = agent.provideAgentInput;
		stopAgentSession = agent.stopAgentSession;
		isProfileUnlocked = agent.isProfileUnlocked;
		hasActiveSession = agent.hasActiveSession;
		clearAgentSession = agent.clearAgentSession;
		getAgentSession = agent.getAgentSession;
	});

	describe('isProfileUnlocked', () => {
		it('returns true when server has a profile', async () => {
			globalThis.fetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ profile: { first_name: 'John' } })
			});
			expect(await isProfileUnlocked()).toBe(true);
		});

		it('returns false when server has no profile', async () => {
			globalThis.fetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ profile: null })
			});
			expect(await isProfileUnlocked()).toBe(false);
		});

		it('returns false when server is unreachable', async () => {
			globalThis.fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
			expect(await isProfileUnlocked()).toBe(false);
		});
	});

	describe('transformProfileForAgent', () => {
		it('maps snake_case DB fields to agent format with nested address', () => {
			const profile = {
				first_name: 'Jane',
				last_name: 'Doe',
				email: 'jane@test.com',
				phone: '555-1234',
				street: '123 Main St',
				city: 'San Antonio',
				state: 'TX',
				zip: '78201',
				country: 'US'
			};

			const result = transformProfileForAgent(profile);

			expect(result.address).toEqual({
				street: '123 Main St',
				city: 'San Antonio',
				state: 'TX',
				zip: '78201',
				country: 'US'
			});
			expect(result.firstName).toBe('Jane');
			expect(result.email).toBe('jane@test.com');
		});

		it('omits address when no address fields present', () => {
			const result = transformProfileForAgent({
				first_name: 'Bob',
				email: 'bob@test.com'
			});
			expect(result.address).toBeUndefined();
		});

		it('copies extra_fields into top level', () => {
			const result = transformProfileForAgent({
				first_name: 'Test',
				extra_fields: { customField: 'customValue' }
			});
			expect(result.customField).toBe('customValue');
		});
	});

	describe('startAgentSession', () => {
		it('starts agent and tracks session', async () => {
			mockStartAgent.mockResolvedValue({ port: 5001, taskId: 'task-1' });

			const result = await startAgentSession('task-1');

			expect(mockStartAgent).toHaveBeenCalledWith('task-1');
			expect(result.port).toBe(5001);
			expect(hasActiveSession()).toBe(true);
			expect(getAgentSession().port).toBe(5001);
		});
	});

	describe('executeAgentGoal', () => {
		it('throws when no agent session active', async () => {
			await expect(executeAgentGoal('goal', 'https://example.com')).rejects.toThrow('No agent session active');
		});

		it('sends goal with empty profile (server merges from DB)', async () => {
			chrome.storage.local.get.mockImplementation(() =>
				Promise.resolve({ agentProvider: 'openai', agentModelType: 'gpt-5.2' })
			);

			mockStartAgent.mockResolvedValue({ port: 5002 });
			await startAgentSession('task-2');

			mockExecuteGoal.mockResolvedValue({ status: 'running', sessionId: 'sess-1' });

			const result = await executeAgentGoal('Sign up', 'https://example.com');

			expect(mockExecuteGoal).toHaveBeenCalledWith(
				5002,
				'Sign up',
				'https://example.com',
				{},  // Empty profile; server handles it
				expect.objectContaining({ provider: 'openai', model: 'gpt-5.2' })
			);
			expect(result.sessionId).toBe('sess-1');
		});
	});

	describe('stopAgentSession', () => {
		it('stops agent and clears session', async () => {
			mockStartAgent.mockResolvedValue({ port: 5003 });
			await startAgentSession('task-3');
			mockStopAgent.mockResolvedValue({ success: true });

			await stopAgentSession();

			expect(mockStopAgent).toHaveBeenCalledWith(5003);
			expect(hasActiveSession()).toBe(false);
		});

		it('clears session even if stop fails', async () => {
			mockStartAgent.mockResolvedValue({ port: 5004 });
			await startAgentSession('task-4');
			mockStopAgent.mockRejectedValue(new Error('already dead'));

			await stopAgentSession();

			expect(hasActiveSession()).toBe(false);
		});
	});

	describe('state checks', () => {
		it('hasActiveSession returns false initially', () => {
			expect(hasActiveSession()).toBe(false);
		});

		it('clearAgentSession resets state', async () => {
			mockStartAgent.mockResolvedValue({ port: 5005 });
			await startAgentSession('task-5');
			expect(hasActiveSession()).toBe(true);

			clearAgentSession();
			expect(hasActiveSession()).toBe(false);
			expect(getAgentSession().port).toBeNull();
		});
	});
});
