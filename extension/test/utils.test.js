import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockFetch } from './helpers.js';

// Mock config.js before importing utils
vi.mock('../config.js', () => ({
	SERVER_BASE: 'http://localhost:8787',
	getConfig: vi.fn(() => ({
		extension: {
			crawl4ai: {
				excludeExternalLinks: true,
				removeOverlayElements: true,
				wordCountThreshold: 10
			}
		}
	}))
}));

const { extractDomain, parseJsonFromLLM, crawlPage } = await import('../utils.js');

describe('extractDomain', () => {
	it('extracts hostname from a valid URL', () => {
		expect(extractDomain('https://www.example.com/path')).toBe('www.example.com');
	});

	it('extracts hostname without www', () => {
		expect(extractDomain('https://example.com')).toBe('example.com');
	});

	it('handles URLs with ports', () => {
		expect(extractDomain('http://localhost:8787/api')).toBe('localhost');
	});

	it('returns original string for invalid URLs', () => {
		expect(extractDomain('not-a-url')).toBe('not-a-url');
	});

	it('returns empty string for empty input', () => {
		expect(extractDomain('')).toBe('');
	});
});

describe('parseJsonFromLLM', () => {
	it('parses raw JSON string', () => {
		const result = parseJsonFromLLM('{"action": "search", "query": "test"}');
		expect(result).toEqual({ action: 'search', query: 'test' });
	});

	it('strips ```json code block wrapper', () => {
		const input = '```json\n{"intent": "simple"}\n```';
		expect(parseJsonFromLLM(input)).toEqual({ intent: 'simple' });
	});

	it('strips ``` code block wrapper without language tag', () => {
		const input = '```\n{"key": "value"}\n```';
		expect(parseJsonFromLLM(input)).toEqual({ key: 'value' });
	});

	it('handles whitespace around JSON', () => {
		const input = '  \n {"a": 1} \n ';
		expect(parseJsonFromLLM(input)).toEqual({ a: 1 });
	});

	it('throws on malformed JSON', () => {
		expect(() => parseJsonFromLLM('not json at all')).toThrow();
	});

	it('throws on empty string', () => {
		expect(() => parseJsonFromLLM('')).toThrow();
	});
});

describe('crawlPage', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('sends correct request body to crawl endpoint', async () => {
		mockFetch({ results: [{ markdown: { raw_markdown: '# Hello' } }] });

		const result = await crawlPage('https://example.com');

		expect(globalThis.fetch).toHaveBeenCalledWith(
			'http://localhost:8787/api/crawl',
			expect.objectContaining({
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: expect.any(String)
			})
		);

		const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
		expect(body.urls).toEqual(['https://example.com']);
		expect(body.crawler_config.exclude_external_links).toBe(true);
		expect(result).toBe('# Hello');
	});

	it('returns empty string when no markdown in response', async () => {
		mockFetch({ results: [{}] });
		const result = await crawlPage('https://example.com');
		expect(result).toBe('');
	});

	it('throws on non-ok response', async () => {
		mockFetch({}, { ok: false, status: 500 });
		await expect(crawlPage('https://example.com')).rejects.toThrow('Crawl error 500');
	});
});
