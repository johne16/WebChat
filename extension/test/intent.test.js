import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({
	SERVER_BASE: 'http://localhost:8787',
	getConfig: vi.fn(() => ({
		providers: { intentModel: 'gpt-4o-mini', intentProvider: 'openai' }
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

	describe('LLM fallback classification', () => {
		it('calls LLM for ambiguous messages', async () => {
			mockCallLLMForContent.mockResolvedValue(
				JSON.stringify({ intent: 'agent', url: 'https://example.com', confidence: 'medium', reasoning: 'seems like task' })
			);

			const result = await detectIntent('Go to example.com and fill out the form', 'https://other.com');

			expect(mockCallLLMForContent).toHaveBeenCalled();
			expect(result.intent).toBe('agent');
			expect(result.url).toBe('https://example.com');
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
