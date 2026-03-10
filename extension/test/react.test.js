import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({
	SERVER_BASE: 'http://localhost:8787',
	getConfig: vi.fn(() => ({
		extension: {
			react: {
				maxIterations: 5,
				unhelpfulThreshold: 2,
				minIterationsBeforeBailout: 2,
				minUsefulContentLength: 100
			}
		}
	}))
}));

const mockAskLLMToThink = vi.fn();
const mockAskLLMToAnswer = vi.fn();
vi.mock('../llmClient.js', () => ({
	askLLMToThink: mockAskLLMToThink,
	askLLMToAnswer: mockAskLLMToAnswer
}));

const mockSearchBrave = vi.fn();
vi.mock('../searchClient.js', () => ({
	searchBrave: mockSearchBrave
}));

const mockExtractPage = vi.fn();
vi.mock('../utils.js', () => ({
	extractPage: mockExtractPage
}));

const { runReActLoop } = await import('../react.js');

describe('react.js - runReActLoop', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default: extractPage returns content for initial fetch
		mockExtractPage.mockResolvedValue('Page content that is long enough to not trigger short content warning for testing purposes and more text here');
	});

	it('completes a full think->act->observe->answer loop', async () => {
		// First call: search, second call: answer
		mockAskLLMToThink
			.mockResolvedValueOnce({ thought: 'Search first', action: 'search', action_input: 'test query' })
			.mockResolvedValueOnce({ thought: 'Got enough', action: 'answer', action_input: 'The answer is X.' });

		mockSearchBrave.mockResolvedValue([
			{ title: 'Result', url: 'https://r.com', description: 'A result' }
		]);

		const result = await runReActLoop('test question', 'https://example.com');

		expect(result.answer).toBe('The answer is X.');
		expect(result.iterations).toBe(2);
		expect(result.bailedOut).toBeUndefined();
		expect(result.hitLimit).toBeUndefined();
	});

	it('handles search action', async () => {
		mockAskLLMToThink
			.mockResolvedValueOnce({ thought: 'search', action: 'search', action_input: 'query' })
			.mockResolvedValueOnce({ thought: 'done', action: 'answer', action_input: 'Answer' });

		mockSearchBrave.mockResolvedValue([{ title: 'T', url: 'https://t.com', description: 'd' }]);

		const result = await runReActLoop('q', 'https://example.com');
		expect(mockSearchBrave).toHaveBeenCalledWith('query', 5, 'https://example.com');
		expect(result.answer).toBe('Answer');
	});

	it('handles fetch_current_page action', async () => {
		// Initial fetch happens for currentURL, so fetch_current_page should be duplicate
		mockAskLLMToThink
			.mockResolvedValueOnce({ thought: 'read page', action: 'fetch_current_page', action_input: '' })
			.mockResolvedValueOnce({ thought: 'done', action: 'answer', action_input: 'Done' });

		const result = await runReActLoop('q', 'https://example.com');
		expect(result.answer).toBe('Done');
	});

	it('handles fetch_url action', async () => {
		mockExtractPage.mockResolvedValue('Long content that is definitely more than one hundred characters for the content length check to pass without triggering warnings');

		mockAskLLMToThink
			.mockResolvedValueOnce({ thought: 'fetch', action: 'fetch_url', action_input: 'https://other.com' })
			.mockResolvedValueOnce({ thought: 'done', action: 'answer', action_input: 'Fetched' });

		const result = await runReActLoop('q', 'https://example.com');
		expect(mockExtractPage).toHaveBeenCalledWith('https://other.com');
		expect(result.answer).toBe('Fetched');
	});

	it('triggers fallback answer when iteration limit is hit', async () => {
		// Always return search action (never answer)
		mockAskLLMToThink.mockResolvedValue({ thought: 'search more', action: 'search', action_input: 'q' });
		mockSearchBrave.mockResolvedValue([{ title: 'T', url: 'https://t.com', description: 'd' }]);
		mockAskLLMToAnswer.mockResolvedValue('Fallback answer');

		const result = await runReActLoop('q', 'https://example.com');

		expect(result.hitLimit).toBe(true);
		expect(result.answer).toBe('Fallback answer');
		expect(result.iterations).toBe(5);
		expect(mockAskLLMToAnswer).toHaveBeenCalled();
	});

	it('bails out early on unhelpful observations', async () => {
		// Initial page fetch succeeds, then errors pile up
		mockAskLLMToThink.mockResolvedValue({ thought: 'search', action: 'search', action_input: 'q' });
		mockSearchBrave.mockRejectedValue(new Error('Search failed'));
		mockAskLLMToAnswer.mockResolvedValue('Bailout answer');

		const result = await runReActLoop('q', 'https://example.com');

		expect(result.bailedOut).toBe(true);
		expect(result.iterations).toBeLessThan(5);
		expect(result.answer).toBe('Bailout answer');
	});

	it('prevents duplicate URL fetching', async () => {
		mockAskLLMToThink
			.mockResolvedValueOnce({ thought: 'fetch', action: 'fetch_url', action_input: 'https://example.com' })
			.mockResolvedValueOnce({ thought: 'done', action: 'answer', action_input: 'Done' });

		// currentURL is already fetched at init, so fetch_url for same URL should be duplicate
		const result = await runReActLoop('q', 'https://example.com');

		// extractPage called once for initial fetch, not again for the duplicate
		expect(mockExtractPage).toHaveBeenCalledTimes(1);
		expect(result.answer).toBe('Done');
	});

	it('calls onStep callback per iteration', async () => {
		mockAskLLMToThink
			.mockResolvedValueOnce({ thought: 's', action: 'search', action_input: 'q' })
			.mockResolvedValueOnce({ thought: 'd', action: 'answer', action_input: 'A' });
		mockSearchBrave.mockResolvedValue([]);

		const steps = [];
		const onStep = (step) => steps.push(step);

		await runReActLoop('q', 'https://example.com', onStep);

		expect(steps.length).toBe(2);
		expect(steps[0].iteration).toBe(1);
		expect(steps[0].action).toBe('search');
		expect(steps[1].iteration).toBe(2);
		expect(steps[1].action).toBe('answer');
	});

	it('returns correct shape from answer action', async () => {
		mockAskLLMToThink.mockResolvedValueOnce({
			thought: 'immediate', action: 'answer', action_input: 'Quick answer'
		});

		const result = await runReActLoop('q', 'https://example.com');

		expect(result).toHaveProperty('answer', 'Quick answer');
		expect(result).toHaveProperty('iterations', 1);
	});

	it('handles null currentURL', async () => {
		mockExtractPage.mockResolvedValue('content');
		mockAskLLMToThink.mockResolvedValueOnce({
			thought: 'answer', action: 'answer', action_input: 'No page'
		});

		const result = await runReActLoop('q', null);

		// Should not attempt initial fetch when currentURL is falsy
		expect(mockExtractPage).not.toHaveBeenCalled();
		expect(result.answer).toBe('No page');
	});

	it('handles unknown action type', async () => {
		mockAskLLMToThink
			.mockResolvedValueOnce({ thought: 'try', action: 'unknown_action', action_input: 'x' })
			.mockResolvedValueOnce({ thought: 'done', action: 'answer', action_input: 'Done' });

		const result = await runReActLoop('q', 'https://example.com');
		expect(result.answer).toBe('Done');
	});
});
