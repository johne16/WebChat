import { describe, it, expect } from 'vitest';

// profile.js has top-level await (loadConfig) and DOM access, so we mock its dependencies
// to allow import. The setup.js file provides chrome.* stubs. We mock config.js
// to avoid side effects, then import the pure exports.

import { vi } from 'vitest';

vi.mock('../ui.js', () => ({
	formatFieldLabel: vi.fn((s) => s)
}));

vi.mock('../config.js', () => ({
	SERVER_BASE: 'http://localhost:8787',
	getConfig: vi.fn(() => ({ extension: { userId: 1 } })),
	loadConfig: vi.fn(() => Promise.resolve())
}));

// profile.js accesses many DOM elements on load; provide them
function setupProfileDOM() {
	document.body.innerHTML = `
		<div id="message" class="message hidden"></div>
		<div id="profile-section" hidden></div>
		<div id="site-data-section" hidden></div>
		<div id="site-data-container"></div>
		<div id="danger-section" hidden></div>
		<form id="profile-form"></form>
		<button id="delete-profile-btn"></button>
		<div id="dynamic-fields"></div>
	`;
}

// Mock fetch for server API calls
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
	ok: true,
	json: () => Promise.resolve({ profile: null })
}));

let isSensitiveField, SENSITIVE_FIELDS, STANDARD_FIELDS;

describe('profile.js exports', () => {
	beforeAll(async () => {
		setupProfileDOM();
		const mod = await import('../profile.js');
		isSensitiveField = mod.isSensitiveField;
		SENSITIVE_FIELDS = mod.SENSITIVE_FIELDS;
		STANDARD_FIELDS = mod.STANDARD_FIELDS;
	});

	describe('SENSITIVE_FIELDS', () => {
		it('contains expected sensitive field names', () => {
			expect(SENSITIVE_FIELDS).toContain('password');
			expect(SENSITIVE_FIELDS).toContain('secret');
			expect(SENSITIVE_FIELDS).toContain('token');
			expect(SENSITIVE_FIELDS).toContain('key');
			expect(SENSITIVE_FIELDS).toContain('pin');
			expect(SENSITIVE_FIELDS).toContain('cvv');
			expect(SENSITIVE_FIELDS).toContain('ssn');
		});

		it('is an array', () => {
			expect(Array.isArray(SENSITIVE_FIELDS)).toBe(true);
		});
	});

	describe('STANDARD_FIELDS', () => {
		it('contains expected profile field names (snake_case DB columns)', () => {
			expect(STANDARD_FIELDS).toContain('first_name');
			expect(STANDARD_FIELDS).toContain('last_name');
			expect(STANDARD_FIELDS).toContain('email');
			expect(STANDARD_FIELDS).toContain('phone');
			expect(STANDARD_FIELDS).toContain('street');
			expect(STANDARD_FIELDS).toContain('city');
			expect(STANDARD_FIELDS).toContain('state');
			expect(STANDARD_FIELDS).toContain('zip');
			expect(STANDARD_FIELDS).toContain('country');
			expect(STANDARD_FIELDS).toContain('birth_date');
		});

		it('has 10 fields', () => {
			expect(STANDARD_FIELDS).toHaveLength(10);
		});
	});

	describe('isSensitiveField', () => {
		it('returns true for exact sensitive field names', () => {
			expect(isSensitiveField('password')).toBe(true);
			expect(isSensitiveField('secret')).toBe(true);
			expect(isSensitiveField('token')).toBe(true);
			expect(isSensitiveField('cvv')).toBe(true);
			expect(isSensitiveField('ssn')).toBe(true);
		});

		it('returns true for fields containing sensitive substrings', () => {
			expect(isSensitiveField('apiKey')).toBe(true);
			expect(isSensitiveField('userPassword')).toBe(true);
			expect(isSensitiveField('secretToken')).toBe(true);
			expect(isSensitiveField('pinCode')).toBe(true);
		});

		it('is case-insensitive', () => {
			expect(isSensitiveField('PASSWORD')).toBe(true);
			expect(isSensitiveField('ApiKey')).toBe(true);
			expect(isSensitiveField('SSN')).toBe(true);
		});

		it('returns false for non-sensitive fields', () => {
			expect(isSensitiveField('email')).toBe(false);
			expect(isSensitiveField('firstName')).toBe(false);
			expect(isSensitiveField('address')).toBe(false);
			expect(isSensitiveField('username')).toBe(false);
		});
	});
});
