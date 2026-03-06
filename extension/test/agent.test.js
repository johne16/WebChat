import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({
	SERVER_BASE: 'http://localhost:8787',
	getConfig: vi.fn(() => ({
		providers: {
			defaultAgentProvider: 'openai',
			defaultAgentModel: 'gpt-5.2'
		},
		extension: {
			profile: { defaultCountry: 'United States' }
		}
	}))
}));

const mockDecryptProfile = vi.fn();
const mockEncryptProfile = vi.fn();
vi.mock('../crypto.js', () => ({
	decryptProfile: mockDecryptProfile,
	encryptProfile: mockEncryptProfile
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

let unlockProfile, transformProfileForAgent, startAgentSession,
	executeAgentGoal, provideAgentInput, stopAgentSession,
	isProfileUnlocked, hasActiveSession, clearAgentSession, getAgentSession;

describe('agent.js', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
		const agent = await import('../agent.js');
		unlockProfile = agent.unlockProfile;
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

	describe('unlockProfile', () => {
		it('decrypts profile from chrome storage', async () => {
			const encData = { ciphertext: 'abc', salt: 'def', iv: 'ghi' };
			const profile = { firstName: 'John', email: 'john@test.com' };

			chrome.storage.local.get.mockImplementationOnce((key) =>
				Promise.resolve({ encryptedUserProfile: encData })
			);
			mockDecryptProfile.mockResolvedValue(profile);

			const result = await unlockProfile('mypass');

			expect(mockDecryptProfile).toHaveBeenCalledWith(encData, 'mypass');
			expect(result).toEqual(profile);
			expect(isProfileUnlocked()).toBe(true);
		});

		it('throws when no profile exists', async () => {
			chrome.storage.local.get.mockImplementationOnce(() =>
				Promise.resolve({ encryptedUserProfile: null })
			);

			await expect(unlockProfile('pass')).rejects.toThrow('No profile found');
		});
	});

	describe('transformProfileForAgent', () => {
		it('nests address fields into address object', () => {
			const profile = {
				firstName: 'Jane',
				lastName: 'Doe',
				email: 'jane@test.com',
				phone: '555-1234',
				address: '123 Main St',
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
				firstName: 'Bob',
				email: 'bob@test.com'
			});
			expect(result.address).toBeUndefined();
		});

		it('copies unknown dynamic fields', () => {
			const result = transformProfileForAgent({
				firstName: 'Test',
				customField: 'customValue'
			});
			expect(result.customField).toBe('customValue');
		});

		it('excludes siteData from transform', () => {
			const result = transformProfileForAgent({
				firstName: 'Test',
				siteData: { 'example.com': { user: 'x' } }
			});
			expect(result.siteData).toBeUndefined();
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

		it('sends goal with transformed profile', async () => {
			// Setup: unlock profile and start session
			chrome.storage.local.get.mockImplementation((keys) => {
				if (Array.isArray(keys) ? keys.includes('encryptedUserProfile') : keys === 'encryptedUserProfile') {
					return Promise.resolve({ encryptedUserProfile: { ciphertext: 'a', salt: 'b', iv: 'c' } });
				}
				return Promise.resolve({ agentProvider: 'openai', agentModelType: 'gpt-5.2' });
			});
			mockDecryptProfile.mockResolvedValue({ firstName: 'Test', email: 'test@test.com' });
			await unlockProfile('pass');

			mockStartAgent.mockResolvedValue({ port: 5002 });
			await startAgentSession('task-2');

			mockExecuteGoal.mockResolvedValue({ status: 'running', sessionId: 'sess-1' });

			const result = await executeAgentGoal('Sign up', 'https://example.com');

			expect(mockExecuteGoal).toHaveBeenCalledWith(
				5002,
				'Sign up',
				'https://example.com',
				expect.objectContaining({ firstName: 'Test', email: 'test@test.com' }),
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
