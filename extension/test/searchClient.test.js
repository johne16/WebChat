import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockFetch } from './helpers.js';

vi.mock('../config.js', () => ({
	SERVER_BASE: 'http://localhost:8787',
	getConfig: vi.fn(() => ({
		extension: {
			search: { defaultCount: 5 }
		}
	}))
}));

vi.mock('../utils.js', () => ({
	extractDomain: vi.fn((url) => {
		try { return new URL(url).hostname; } catch { return url; }
	})
}));

const { searchBrave } = await import('../searchClient.js');

describe('searchBrave', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('sends query to search endpoint', async () => {
		mockFetch({
			web: {
				results: [
					{ title: 'Result 1', url: 'https://example.com', description: 'Desc 1' }
				]
			}
		});

		const results = await searchBrave('test query');

		expect(globalThis.fetch).toHaveBeenCalledWith(
			'http://localhost:8787/api/search',
			expect.objectContaining({
				method: 'POST',
				body: expect.any(String)
			})
		);

		const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
		expect(body.query).toBe('test query');
		expect(body.count).toBe(5);
	});

	it('formats results with position, title, url, description', async () => {
		mockFetch({
			web: {
				results: [
					{ title: 'A', url: 'https://a.com', description: 'desc A' },
					{ title: 'B', url: 'https://b.com', description: 'desc B' }
				]
			}
		});

		const results = await searchBrave('query');

		expect(results).toHaveLength(2);
		expect(results[0]).toEqual(expect.objectContaining({
			position: 1,
			title: 'A',
			url: 'https://a.com',
			description: 'desc A'
		}));
		expect(results[1].position).toBe(2);
	});

	it('prepends site: restriction when currentURL is provided', async () => {
		mockFetch({ web: { results: [] } });

		await searchBrave('query', 5, 'https://example.com/page');

		const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
		expect(body.query).toBe('site:example.com query');
	});

	it('throws on HTTP error', async () => {
		mockFetch({}, { ok: false, status: 500 });

		await expect(searchBrave('test')).rejects.toThrow('Search failed');
	});

	it('returns empty array when no web results', async () => {
		mockFetch({ web: {} });

		const results = await searchBrave('query');
		expect(results).toEqual([]);
	});

	it('handles missing fields in results gracefully', async () => {
		mockFetch({
			web: {
				results: [{ }]
			}
		});

		const results = await searchBrave('query');
		expect(results[0].title).toBe('No title');
		expect(results[0].url).toBe('');
		expect(results[0].description).toBe('');
	});
});
