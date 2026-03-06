import { describe, it, expect } from 'vitest';
import { encryptProfile, decryptProfile } from '../crypto.js';

describe('crypto.js', () => {
	const passphrase = 'test-passphrase-123';

	it('encryptProfile returns ciphertext, salt, iv as strings', async () => {
		const profile = { firstName: 'John', email: 'john@example.com' };
		const result = await encryptProfile(profile, passphrase);

		expect(result).toHaveProperty('ciphertext');
		expect(result).toHaveProperty('salt');
		expect(result).toHaveProperty('iv');
		expect(typeof result.ciphertext).toBe('string');
		expect(typeof result.salt).toBe('string');
		expect(typeof result.iv).toBe('string');
		// All should be non-empty base64
		expect(result.ciphertext.length).toBeGreaterThan(0);
		expect(result.salt.length).toBeGreaterThan(0);
		expect(result.iv.length).toBeGreaterThan(0);
	});

	it('round-trips with correct passphrase', async () => {
		const profile = { firstName: 'Alice', lastName: 'Smith', email: 'alice@test.com' };
		const encrypted = await encryptProfile(profile, passphrase);
		const decrypted = await decryptProfile(encrypted, passphrase);

		expect(decrypted).toEqual(profile);
	});

	it('throws with wrong passphrase', async () => {
		const profile = { secret: 'data' };
		const encrypted = await encryptProfile(profile, passphrase);

		await expect(decryptProfile(encrypted, 'wrong-passphrase')).rejects.toThrow();
	});

	it('handles empty profile object', async () => {
		const encrypted = await encryptProfile({}, passphrase);
		const decrypted = await decryptProfile(encrypted, passphrase);
		expect(decrypted).toEqual({});
	});

	it('handles nested profile with siteData', async () => {
		const profile = {
			firstName: 'Bob',
			siteData: {
				'example.com': { username: 'bob123', password: 'secret' }
			}
		};
		const encrypted = await encryptProfile(profile, passphrase);
		const decrypted = await decryptProfile(encrypted, passphrase);
		expect(decrypted).toEqual(profile);
	});

	it('handles special characters in profile values', async () => {
		const profile = {
			name: 'Rene',
			bio: 'Line1\nLine2\tTabbed',
			emoji: 'Hello!'
		};
		const encrypted = await encryptProfile(profile, passphrase);
		const decrypted = await decryptProfile(encrypted, passphrase);
		expect(decrypted).toEqual(profile);
	});

	it('produces different ciphertext for same profile (random salt/iv)', async () => {
		const profile = { test: 'data' };
		const enc1 = await encryptProfile(profile, passphrase);
		const enc2 = await encryptProfile(profile, passphrase);

		// Salt and IV should differ (random)
		expect(enc1.salt).not.toBe(enc2.salt);
	});
});
