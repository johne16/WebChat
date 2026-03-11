import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockFetch } from './helpers.js';

vi.mock('../config.js', () => ({
	SERVER_BASE: 'http://localhost:8787',
	getConfig: vi.fn(() => ({
		providers: { defaultModel: 'gpt-5.2', default: 'openai' }
	})),
	getUserId: vi.fn(() => 1)
}));

vi.mock('../utils.js', () => ({
	extractPage: vi.fn(() => Promise.resolve('# Page Content\nSome text here')),
	parseJsonFromLLM: vi.fn((text) => JSON.parse(text))
}));

const { sendToBot, askLLMToThink, askLLMToAnswer, callLLMForContent } = await import('../llmClient.js');

describe('llmClient.js', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('sendToBot', () => {
		it('extracts page and sends content to LLM', async () => {
			const { extractPage } = await import('../utils.js');
			extractPage.mockResolvedValue('# Extracted Content');
			mockFetch({ content: 'LLM response text' });

			const result = await sendToBot('What is this?', 'https://example.com');

			expect(extractPage).toHaveBeenCalledWith('https://example.com');
			expect(globalThis.fetch).toHaveBeenCalledWith(
				'http://localhost:8787/api/llm/chat',
				expect.objectContaining({ method: 'POST' })
			);

			const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
			expect(body.messages).toHaveLength(2);
			expect(body.messages[1].content).toContain('What is this?');
			expect(body.messages[1].content).toContain('# Extracted Content');
			expect(body.storeInHistory).toBe(true);
			expect(result).toEqual({ text: 'LLM response text' });
		});

		it('throws on LLM API error', async () => {
			const { extractPage } = await import('../utils.js');
			extractPage.mockResolvedValue('content');
			mockFetch({}, { ok: false, status: 500 });

			await expect(sendToBot('test', 'https://example.com')).rejects.toThrow('LLM error 500');
		});
	});

	describe('askLLMToThink', () => {
		it('parses JSON decision from LLM response', async () => {
			const decision = { thought: 'Need to search', action: 'search', action_input: 'test query' };
			mockFetch({ content: JSON.stringify(decision) });

			const context = { query: 'test', currentURL: 'https://example.com', observations: [] };
			const result = await askLLMToThink(context);

			expect(result.action).toBe('search');
			expect(result.action_input).toBe('test query');
			expect(result.thought).toBe('Need to search');
		});

		it('returns fallback answer on parse failure', async () => {
			mockFetch({ content: 'not valid json' });
			const { parseJsonFromLLM } = await import('../utils.js');
			parseJsonFromLLM.mockImplementationOnce(() => { throw new Error('parse error'); });

			const context = { query: 'test', currentURL: 'https://example.com', observations: [] };
			const result = await askLLMToThink(context);

			expect(result.action).toBe('answer');
			expect(result.thought).toContain('Failed to parse');
		});

		it('returns fallback when decision has no thought or action', async () => {
			const { parseJsonFromLLM } = await import('../utils.js');
			parseJsonFromLLM.mockReturnValueOnce({ something: 'else' });
			mockFetch({ content: '{}' });

			const context = { query: 'test', currentURL: 'https://example.com', observations: [] };
			const result = await askLLMToThink(context);

			expect(result.action).toBe('answer');
		});
	});

	describe('askLLMToAnswer', () => {
		it('returns content string from LLM', async () => {
			mockFetch({ content: 'The answer is 42.' });

			const context = { query: 'test', currentURL: 'https://example.com', observations: [] };
			const result = await askLLMToAnswer(context);

			expect(result).toBe('The answer is 42.');
		});

		it('returns fallback on empty response', async () => {
			mockFetch({ content: '' });

			const context = { query: 'test', currentURL: 'https://example.com', observations: [] };
			const result = await askLLMToAnswer(context);

			expect(result).toBe('I was unable to generate an answer.');
		});
	});

	describe('callLLMForContent', () => {
		it('sends messages to LLM and returns content string', async () => {
			mockFetch({ content: 'response text' });

			const result = await callLLMForContent('gpt-4o-mini', [
				{ role: 'system', content: 'You are helpful.' },
				{ role: 'user', content: 'Hello' }
			], { provider: 'openai' });

			expect(result).toBe('response text');
			const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
			expect(body.provider).toBe('openai');
			expect(body.model).toBe('gpt-4o-mini');
		});

		it('returns empty string on null content', async () => {
			mockFetch({});

			const result = await callLLMForContent('model', [{ role: 'user', content: 'hi' }]);
			expect(result).toBe('');
		});
	});
});
