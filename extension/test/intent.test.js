import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTlds = ['com', 'org', 'net', 'io', 'edu', 'gov', 'co', 'us', 'uk'];

vi.mock('../config.js', () => ({
	SERVER_BASE: 'http://localhost:8787',
	getConfig: vi.fn(() => ({
		providers: { intentModel: 'gpt-4o-mini', intentProvider: 'openai' },
		tlds: mockTlds
	}))
}));

vi.mock('../utils.js', () => ({
	parseJsonFromLLM: vi.fn((text) => JSON.parse(text))
}));

const mockCallLLMForContent = vi.fn();
vi.mock('../llmClient.js', () => ({
	callLLMForContent: mockCallLLMForContent
}));

const { detectIntent, INTENT } = await import('../intent.js');

describe('intent.js', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('INTENT constants', () => {
		it('has correct values', () => {
			expect(INTENT.SIMPLE).toBe('simple');
			expect(INTENT.RESEARCH).toBe('research');
			expect(INTENT.AGENT).toBe('agent');
		});
	});

	describe('heuristic bypass for questions', () => {
		it('bypasses agent detection for question-word messages', async () => {
			mockCallLLMForContent.mockResolvedValue(
				JSON.stringify({ intent: 'simple', url: null, confidence: 'high', reasoning: 'question' })
			);

			const result = await detectIntent('What is this page about?', 'https://example.com');
			expect(result.intent).toBe('simple');
			// LLM was called for simple vs research classification
			expect(mockCallLLMForContent).toHaveBeenCalled();
		});

		it('bypasses for messages ending with ?', async () => {
			mockCallLLMForContent.mockResolvedValue(
				JSON.stringify({ intent: 'research', url: null, confidence: 'high', reasoning: 'needs search' })
			);

			const result = await detectIntent('Is there a better option?', 'https://example.com');
			expect(result.intent).toBe('research');
		});

		it('bypasses for "this page" references', async () => {
			mockCallLLMForContent.mockResolvedValue(
				JSON.stringify({ intent: 'simple', url: null, confidence: 'high', reasoning: 'page ref' })
			);

			const result = await detectIntent('Summarize this page', 'https://example.com');
			expect(result.intent).toBe('simple');
		});
	});

	describe('URL extraction', () => {
		it('detects agent intent with explicit URL and action verb', async () => {
			const result = await detectIntent(
				'Sign me up at https://example.com/register',
				'https://other.com'
			);

			expect(result.intent).toBe('agent');
			expect(result.url).toBe('https://example.com/register');
			expect(result.confidence).toBe('high');
			// Should NOT call LLM (heuristic match)
			expect(mockCallLLMForContent).not.toHaveBeenCalled();
		});

		it('extracts URL from middle of text', async () => {
			const result = await detectIntent(
				'Please register me at https://site.com/signup today',
				'https://other.com'
			);

			expect(result.url).toBe('https://site.com/signup');
		});
	});

	describe('bare domain extraction', () => {
		it('detects agent intent with bare domain and action verb', async () => {
			const result = await detectIntent(
				'sign me up at example.com',
				'https://other.com'
			);
			expect(result.intent).toBe('agent');
			expect(result.url).toBe('https://example.com');
			expect(mockCallLLMForContent).not.toHaveBeenCalled();
		});

		it('detects bare domain with path', async () => {
			const result = await detectIntent(
				'register at example.com/signup',
				'https://other.com'
			);
			expect(result.intent).toBe('agent');
			expect(result.url).toBe('https://example.com/signup');
			expect(mockCallLLMForContent).not.toHaveBeenCalled();
		});

		it('does not extract invalid TLD (e.g. node.js)', async () => {
			mockCallLLMForContent.mockResolvedValue(
				JSON.stringify({ intent: 'simple', url: null, confidence: 'high', reasoning: 'question' })
			);

			const result = await detectIntent('tell me about node.js', 'https://other.com');
			// "js" is not in mockTlds, so no URL extracted; falls through to LLM
			expect(result.url).toBeNull();
		});

		it('detects bare domain with hyphen', async () => {
			const result = await detectIntent(
				'register at my-site.org/register',
				'https://other.com'
			);
			expect(result.intent).toBe('agent');
			expect(result.url).toBe('https://my-site.org/register');
			expect(mockCallLLMForContent).not.toHaveBeenCalled();
		});
	});

	describe('LLM fallback classification', () => {
		it('calls LLM for ambiguous messages without URL or action verb', async () => {
			mockCallLLMForContent.mockResolvedValue(
				JSON.stringify({ intent: 'agent', url: 'https://example.com', confidence: 'medium', reasoning: 'seems like task' })
			);

			const result = await detectIntent('Go to example.com and fill out the form', 'https://other.com');

			// Now matched by heuristic (bare domain + action verb)
			expect(result.intent).toBe('agent');
			expect(result.url).toBe('https://example.com');
			expect(mockCallLLMForContent).not.toHaveBeenCalled();
		});

		it('calls LLM for messages with no URL', async () => {
			mockCallLLMForContent.mockResolvedValue(
				JSON.stringify({ intent: 'agent', url: 'https://inferred.com', confidence: 'medium', reasoning: 'inferred' })
			);

			const result = await detectIntent('Go ahead and do the thing for me', 'https://other.com');

			expect(mockCallLLMForContent).toHaveBeenCalled();
			expect(result.intent).toBe('agent');
		});

		it('defaults to SIMPLE on LLM parse failure', async () => {
			const { parseJsonFromLLM } = await import('../utils.js');
			parseJsonFromLLM.mockImplementationOnce(() => { throw new Error('parse error'); });
			mockCallLLMForContent.mockResolvedValue('invalid json');

			const result = await detectIntent('Go ahead and do something', 'https://example.com');

			expect(result.intent).toBe('simple');
			expect(result.confidence).toBe('low');
		});

		it('defaults to SIMPLE on LLM network failure', async () => {
			mockCallLLMForContent.mockRejectedValue(new Error('network error'));

			const result = await detectIntent('Go ahead and do something', 'https://example.com');

			expect(result.intent).toBe('simple');
			expect(result.confidence).toBe('low');
		});
	});

	describe('agent intent includes URL', () => {
		it('returns url from LLM response for agent intent', async () => {
			mockCallLLMForContent.mockResolvedValue(
				JSON.stringify({ intent: 'agent', url: 'https://inferred.com', confidence: 'medium', reasoning: 'inferred' })
			);

			const result = await detectIntent('Create an account on Inferred Corp', 'https://other.com');
			expect(result.intent).toBe('agent');
			expect(result.url).toBe('https://inferred.com');
		});
	});
});
