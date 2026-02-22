// extension/crypto.js
// AES-256-GCM encryption with PBKDF2 key derivation

const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

/**
 * Derive AES-256 key from passphrase using PBKDF2
 */
async function deriveKey(passphrase, salt) {
	const encoder = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		encoder.encode(passphrase),
		"PBKDF2",
		false,
		["deriveKey"]
	);

	return crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt: salt,
			iterations: PBKDF2_ITERATIONS,
			hash: "SHA-256"
		},
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);
}

/**
 * Encrypt profile object with passphrase
 * @param {Object} profile - User profile data
 * @param {string} passphrase - User's passphrase
 * @returns {Object} - { ciphertext, salt, iv } all base64 encoded
 */
export async function encryptProfile(profile, passphrase) {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const key = await deriveKey(passphrase, salt);

	const encoder = new TextEncoder();
	const data = encoder.encode(JSON.stringify(profile));

	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv: iv },
		key,
		data
	);

	return {
		ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
		salt: btoa(String.fromCharCode(...salt)),
		iv: btoa(String.fromCharCode(...iv))
	};
}

/**
 * Decrypt profile with passphrase
 * @param {Object} encryptedData - { ciphertext, salt, iv } base64 encoded
 * @param {string} passphrase - User's passphrase
 * @returns {Object} - Decrypted profile object
 * @throws {Error} - If decryption fails (wrong passphrase)
 */
export async function decryptProfile(encryptedData, passphrase) {
	const salt = Uint8Array.from(atob(encryptedData.salt), c => c.charCodeAt(0));
	const iv = Uint8Array.from(atob(encryptedData.iv), c => c.charCodeAt(0));
	const ciphertext = Uint8Array.from(atob(encryptedData.ciphertext), c => c.charCodeAt(0));

	const key = await deriveKey(passphrase, salt);

	const decrypted = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: iv },
		key,
		ciphertext
	);

	const decoder = new TextDecoder();
	return JSON.parse(decoder.decode(decrypted));
}
