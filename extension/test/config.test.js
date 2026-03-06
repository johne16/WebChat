import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('config.js', () => {
	let loadConfig, getConfig, SERVER_BASE;

	beforeEach(async () => {
		vi.resetModules();
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('SERVER_BASE is http://localhost:8787', async () => {
		const mod = await import('../config.js');
		expect(mod.SERVER_BASE).toBe('http://localhost:8787');
	});

	it('getConfig returns null before loadConfig is called', async () => {
		const mod = await import('../config.js');
		expect(mod.getConfig()).toBeNull();
	});

	it('loadConfig fetches from server and caches the result', async () => {
		const configData = { providers: { default: 'openai' }, extension: { react: {} } };
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
			ok: true,
			json: () => Promise.resolve(configData)
		})));

		const mod = await import('../config.js');
		const result = await mod.loadConfig();

		expect(globalThis.fetch).toHaveBeenCalledWith('http://localhost:8787/api/config');
		expect(result).toEqual(configData);
		expect(mod.getConfig()).toEqual(configData);
	});

	it('loadConfig caches so subsequent calls do not re-fetch', async () => {
		const configData = { providers: {}, extension: {} };
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
			ok: true,
			json: () => Promise.resolve(configData)
		})));

		const mod = await import('../config.js');
		await mod.loadConfig();
		await mod.loadConfig(); // second call
		expect(globalThis.fetch).toHaveBeenCalledTimes(1); // only fetched once
	});

	it('loadConfig handles fetch failure gracefully', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Network error'))));

		const mod = await import('../config.js');
		const result = await mod.loadConfig();

		expect(result).toEqual({ providers: {}, extension: {} });
		expect(mod.getConfig()).toEqual({ providers: {}, extension: {} });
	});

	it('loadConfig handles non-ok response', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
			ok: false,
			status: 500
		})));

		const mod = await import('../config.js');
		const result = await mod.loadConfig();

		expect(result).toEqual({ providers: {}, extension: {} });
	});
});
