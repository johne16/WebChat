import { describe, it, expect } from 'vitest';

// profile.js has top-level await (loadConfig) and DOM access, so we mock its dependencies
// to allow import. The setup.js file provides chrome.* stubs. We mock config.js and crypto.js
// to avoid side effects, then import the pure exports.

import { vi } from 'vitest';

vi.mock('../crypto.js', () => ({
	encryptProfile: vi.fn(),
	decryptProfile: vi.fn()
}));

vi.mock('../ui.js', () => ({
	formatFieldLabel: vi.fn((s) => s)
}));

vi.mock('../config.js', () => ({
	getConfig: vi.fn(() => ({ extension: { profile: { minPassphraseLength: 4 } } })),
	loadConfig: vi.fn(() => Promise.resolve())
}));

// profile.js accesses many DOM elements on load; provide them
function setupProfileDOM() {
	document.body.innerHTML = `
		<span id="status"></span>
		<div id="message" class="message hidden"></div>
		<div id="unlock-section" hidden></div>
		<div id="create-section" hidden></div>
		<div id="profile-section" hidden></div>
		<div id="site-data-section" hidden></div>
		<div id="site-data-container"></div>
		<div id="passphrase-section" hidden></div>
		<div id="danger-section" hidden></div>
		<form id="unlock-form"><input id="passphrase" /></form>
		<form id="create-form"><input id="create-passphrase" /><input id="confirm-passphrase" /></form>
		<form id="profile-form"></form>
		<form id="change-passphrase-form"><input id="oldPassphrase" /><input id="newPassphrase" /><input id="confirmPassphrase" /></form>
		<button id="lock-btn"></button>
		<button id="delete-profile-btn"></button>
		<div id="dynamic-fields"></div>
	`;
}

let isSensitiveField, validatePassphrase, SENSITIVE_FIELDS, STANDARD_FIELDS;

describe('profile.js exports', () => {
	beforeAll(async () => {
		setupProfileDOM();
		const mod = await import('../profile.js');
		isSensitiveField = mod.isSensitiveField;
		validatePassphrase = mod.validatePassphrase;
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
		it('contains expected profile field names', () => {
			expect(STANDARD_FIELDS).toContain('firstName');
			expect(STANDARD_FIELDS).toContain('lastName');
			expect(STANDARD_FIELDS).toContain('email');
			expect(STANDARD_FIELDS).toContain('phone');
			expect(STANDARD_FIELDS).toContain('address');
			expect(STANDARD_FIELDS).toContain('city');
			expect(STANDARD_FIELDS).toContain('state');
			expect(STANDARD_FIELDS).toContain('zip');
			expect(STANDARD_FIELDS).toContain('country');
			expect(STANDARD_FIELDS).toContain('birthDate');
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

	describe('validatePassphrase', () => {
		it('returns invalid when passphrase is empty', () => {
			const result = validatePassphrase('', 'confirm');
			expect(result.valid).toBe(false);
			expect(result.error).toBe('Please enter a passphrase');
		});

		it('returns invalid when passphrase is falsy', () => {
			const result = validatePassphrase(null, null);
			expect(result.valid).toBe(false);
		});

		it('returns invalid when passphrases do not match', () => {
			const result = validatePassphrase('abcdef', 'ghijkl');
			expect(result.valid).toBe(false);
			expect(result.error).toBe('Passphrases do not match');
		});

		it('returns invalid when passphrase is too short', () => {
			const result = validatePassphrase('abc', 'abc');
			expect(result.valid).toBe(false);
			expect(result.error).toContain('at least');
		});

		it('returns valid for a matching passphrase meeting length requirement', () => {
			const result = validatePassphrase('abcd', 'abcd');
			expect(result.valid).toBe(true);
			expect(result.error).toBeNull();
		});

		it('returns valid for a long passphrase', () => {
			const result = validatePassphrase('a-very-long-passphrase', 'a-very-long-passphrase');
			expect(result.valid).toBe(true);
		});
	});
});
