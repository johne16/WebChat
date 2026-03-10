// database.js - SQLite database for WebChat
import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATABASE_ENCRYPTION_KEY } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'webchat.db');

let db = null;

// =============================================================================
// Encryption Helpers (AES-256-GCM)
// =============================================================================

/**
 * Encrypt plaintext using AES-256-GCM
 * @param {string} plaintext
 * @param {string} key - Hex-encoded 256-bit key
 * @returns {string} iv:ciphertext:authTag (base64)
 */
function encrypt(plaintext, key) {
	if (plaintext == null) return null;
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
	let encrypted = cipher.update(plaintext, 'utf8', 'base64');
	encrypted += cipher.final('base64');
	const authTag = cipher.getAuthTag().toString('base64');
	return `enc:${iv.toString('base64')}:${encrypted}:${authTag}`;
}

/**
 * Decrypt ciphertext produced by encrypt()
 * @param {string} ciphertext - iv:ciphertext:authTag (base64)
 * @param {string} key - Hex-encoded 256-bit key
 * @returns {string} Decrypted plaintext
 */
function decrypt(ciphertext, key) {
	if (ciphertext == null) return null;
	const raw = ciphertext.slice(4); // remove "enc:"
	const parts = raw.split(':');
	if (parts.length !== 3) {
		throw new Error('Invalid encrypted format: expected enc:iv:ciphertext:authTag');
	}
	const [ivB64, encB64, tagB64] = parts;
	const iv = Buffer.from(ivB64, 'base64');
	const encrypted = Buffer.from(encB64, 'base64');
	const authTag = Buffer.from(tagB64, 'base64');
	const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
	decipher.setAuthTag(authTag);
	let decrypted = decipher.update(encrypted, null, 'utf8');
	decrypted += decipher.final('utf8');
	return decrypted;
}

/**
 * Check if a value looks like our encrypted format (iv:ciphertext:authTag)
 */
function isEncrypted(value) {
	if (!value || typeof value !== 'string') return false;
	return value.startsWith('enc:');
}

// Encrypt a value, returning null if input is null/undefined
function encryptField(value) {
	if (value == null) return null;
	if (!DATABASE_ENCRYPTION_KEY) throw new Error('DATABASE_ENCRYPTION_KEY is not set');
	return encrypt(String(value), DATABASE_ENCRYPTION_KEY);
}

// Decrypt a value, returning null if input is null/undefined
function decryptField(value) {
	if (value == null) return null;
	return decrypt(value, DATABASE_ENCRYPTION_KEY);
}

// Profile columns that get encrypted (everything except user_id and timestamps)
const ENCRYPTED_PROFILE_COLS = [
	'first_name', 'last_name', 'email', 'phone', 'birth_date',
	'street', 'city', 'state', 'zip', 'country', 'extra_fields'
];

/**
 * Decrypt a profile row in place
 */
function decryptProfileRow(row) {
	if (!row) return row;
	for (const col of ENCRYPTED_PROFILE_COLS) {
		if (row[col] != null) {
			row[col] = decryptField(row[col]);
		}
	}
	return row;
}

// =============================================================================
// Database Init + Migration
// =============================================================================

/**
 * Initialize database and create tables
 */
export function initDatabase() {
	db = new Database(DB_PATH);

	// Enable foreign keys
	db.pragma('foreign_keys = ON');

	// Create tables
	db.exec(`
		-- Users (multi-user ready)
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);

		-- Profile (core fields + flexible JSON overflow)
		CREATE TABLE IF NOT EXISTS profile (
			user_id INTEGER PRIMARY KEY,
			first_name TEXT,
			last_name TEXT,
			email TEXT,
			phone TEXT,
			birth_date TEXT,
			street TEXT,
			city TEXT,
			state TEXT,
			zip TEXT,
			country TEXT,
			extra_fields TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id)
		);

		-- Site-specific data (credentials, security answers per domain)
		CREATE TABLE IF NOT EXISTS site_data (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			domain TEXT NOT NULL,
			field_name TEXT NOT NULL,
			field_value TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, domain, field_name),
			FOREIGN KEY (user_id) REFERENCES users(id)
		);

		-- Learned context
		CREATE TABLE IF NOT EXISTS learned_context (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			fact TEXT NOT NULL,
			source TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id)
		);

		-- TLD cache (single-row store for IANA TLD list)
		CREATE TABLE IF NOT EXISTS tld_cache (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			tlds TEXT NOT NULL,
			fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);

		-- Ensure default user exists
		INSERT OR IGNORE INTO users (id) VALUES (1);
	`);

	// Migration: add passphrase_hash column to users table
	try {
		db.exec('ALTER TABLE users ADD COLUMN passphrase_hash TEXT');
	} catch (_) {
		// Column already exists
	}

	// Migrate plaintext data to encrypted if needed
	migrateToEncrypted();

	console.log(`[Database] Initialized at ${DB_PATH}`);
	return db;
}

/**
 * Auto-encrypt existing plaintext rows
 * Detection: if a profile column doesn't match the iv:ciphertext:authTag format, treat as plaintext
 */
function migrateToEncrypted() {
	// Migrate profile rows
	const profiles = db.prepare('SELECT * FROM profile').all();
	for (const row of profiles) {
		let needsUpdate = false;
		for (const col of ENCRYPTED_PROFILE_COLS) {
			if (row[col] != null && !isEncrypted(row[col])) {
				needsUpdate = true;
				break;
			}
		}
		if (needsUpdate) {
			db.prepare(`
				UPDATE profile SET
					first_name = ?, last_name = ?, email = ?, phone = ?, birth_date = ?,
					street = ?, city = ?, state = ?, zip = ?, country = ?, extra_fields = ?
				WHERE user_id = ?
			`).run(
				encryptField(row.first_name), encryptField(row.last_name),
				encryptField(row.email), encryptField(row.phone), encryptField(row.birth_date),
				encryptField(row.street), encryptField(row.city), encryptField(row.state),
				encryptField(row.zip), encryptField(row.country), encryptField(row.extra_fields),
				row.user_id
			);
			console.log(`[Database] Migrated profile for user ${row.user_id} to encrypted`);
		}
	}

	// Migrate site_data rows
	const siteRows = db.prepare('SELECT * FROM site_data').all();
	for (const row of siteRows) {
		if (row.field_value != null && !isEncrypted(row.field_value)) {
			db.prepare('UPDATE site_data SET field_value = ? WHERE id = ?')
				.run(encryptField(row.field_value), row.id);
		}
	}

	// Migrate learned_context rows
	const contextRows = db.prepare('SELECT * FROM learned_context').all();
	for (const row of contextRows) {
		if (row.fact != null && !isEncrypted(row.fact)) {
			db.prepare('UPDATE learned_context SET fact = ? WHERE id = ?')
				.run(encryptField(row.fact), row.id);
		}
	}
}

/**
 * Get database instance.
 * Currently unused — retained for future consumers that need direct DB access.
 */
export function getDatabase() {
	if (!db) {
		throw new Error('Database not initialized. Call initDatabase() first.');
	}
	return db;
}

// =============================================================================
// Profile Operations
// =============================================================================

export function getProfile(userId = 1) {
	const row = db.prepare(`
		SELECT * FROM profile WHERE user_id = ?
	`).get(userId);

	if (!row) return null;

	// Decrypt all encrypted columns
	decryptProfileRow(row);

	if (row.extra_fields) {
		row.extra_fields = JSON.parse(row.extra_fields);
	}
	return row;
}

function normalizeProfileFields(data) {
	if (data.phone) {
		data.phone = data.phone.replace(/\D/g, '');
	}
	if (data.zip) {
		data.zip = data.zip.replace(/\D/g, '');
	}
	return data;
}

export function upsertProfile(userId = 1, data) {
	data = normalizeProfileFields(data);
	// Item 4: Rely on SQL COALESCE instead of fetching existing profile first
	const extraFields = data.extra_fields
		? JSON.stringify(data.extra_fields)
		: null;

	db.prepare(`
		INSERT INTO profile (user_id, first_name, last_name, email, phone, birth_date,
							street, city, state, zip, country, extra_fields, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(user_id) DO UPDATE SET
			first_name = COALESCE(excluded.first_name, first_name),
			last_name = COALESCE(excluded.last_name, last_name),
			email = COALESCE(excluded.email, email),
			phone = COALESCE(excluded.phone, phone),
			birth_date = COALESCE(excluded.birth_date, birth_date),
			street = COALESCE(excluded.street, street),
			city = COALESCE(excluded.city, city),
			state = COALESCE(excluded.state, state),
			zip = COALESCE(excluded.zip, zip),
			country = COALESCE(excluded.country, country),
			extra_fields = COALESCE(excluded.extra_fields, extra_fields),
			updated_at = CURRENT_TIMESTAMP
	`).run(
		userId,
		encryptField(data.first_name || null),
		encryptField(data.last_name || null),
		encryptField(data.email || null),
		encryptField(data.phone || null),
		encryptField(data.birth_date || null),
		encryptField(data.street || null),
		encryptField(data.city || null),
		encryptField(data.state || null),
		encryptField(data.zip || null),
		encryptField(data.country || null),
		encryptField(extraFields)
	);

	return getProfile(userId);
}

export function updateProfileExtraField(userId = 1, fieldName, fieldValue) {
	const profile = getProfile(userId);
	const extraFields = profile?.extra_fields || {};
	extraFields[fieldName] = fieldValue;

	db.prepare(`
		UPDATE profile SET extra_fields = ?, updated_at = CURRENT_TIMESTAMP
		WHERE user_id = ?
	`).run(encryptField(JSON.stringify(extraFields)), userId);

	return getProfile(userId);
}

export function deleteProfileExtraField(userId = 1, fieldName) {
	const profile = getProfile(userId);
	const extraFields = profile?.extra_fields || {};
	delete extraFields[fieldName];

	db.prepare(`
		UPDATE profile SET extra_fields = ?, updated_at = CURRENT_TIMESTAMP
		WHERE user_id = ?
	`).run(encryptField(JSON.stringify(extraFields)), userId);

	return getProfile(userId);
}

// =============================================================================
// Site Data Operations
// =============================================================================

export function getSiteData(userId = 1, domain = null) {
	let rows;
	if (domain) {
		rows = db.prepare(`
			SELECT * FROM site_data WHERE user_id = ? AND domain = ?
		`).all(userId, domain);
	} else {
		rows = db.prepare(`
			SELECT * FROM site_data WHERE user_id = ?
		`).all(userId);
	}

	// Decrypt field_value for each row
	for (const row of rows) {
		row.field_value = decryptField(row.field_value);
	}
	return rows;
}

export function upsertSiteData(userId = 1, domain, fieldName, fieldValue) {
	db.prepare(`
		INSERT INTO site_data (user_id, domain, field_name, field_value)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id, domain, field_name) DO UPDATE SET
			field_value = excluded.field_value
	`).run(userId, domain, fieldName, encryptField(fieldValue));

	return getSiteData(userId, domain);
}

export function deleteProfile(userId = 1) {
	db.prepare('DELETE FROM profile WHERE user_id = ?').run(userId);
	db.prepare('DELETE FROM site_data WHERE user_id = ?').run(userId);
	db.prepare('DELETE FROM learned_context WHERE user_id = ?').run(userId);
	db.prepare('UPDATE users SET passphrase_hash = NULL WHERE id = ?').run(userId);
}

export function deleteSiteData(userId = 1, domain, fieldName = null) {
	if (fieldName) {
		db.prepare(`
			DELETE FROM site_data WHERE user_id = ? AND domain = ? AND field_name = ?
		`).run(userId, domain, fieldName);
	} else {
		db.prepare(`
			DELETE FROM site_data WHERE user_id = ? AND domain = ?
		`).run(userId, domain);
	}
}

// =============================================================================
// Learned Context Operations
// =============================================================================

export function getLearnedContext(userId = 1) {
	const rows = db.prepare(`
		SELECT * FROM learned_context WHERE user_id = ?
		ORDER BY created_at DESC
	`).all(userId);

	for (const row of rows) {
		row.fact = decryptField(row.fact);
	}
	return rows;
}

export function addLearnedContext(userId = 1, fact, source = null) {
	const result = db.prepare(`
		INSERT INTO learned_context (user_id, fact, source)
		VALUES (?, ?, ?)
	`).run(userId, encryptField(fact), source);

	return result.lastInsertRowid;
}

export function deleteLearnedContext(id, userId) {
	db.prepare(`DELETE FROM learned_context WHERE id = ? AND user_id = ?`).run(id, userId);
}

// =============================================================================
// TLD Cache Operations
// =============================================================================

export function getCachedTlds() {
	const row = db.prepare('SELECT tlds FROM tld_cache WHERE id = 1').get();
	if (!row) return null;
	return JSON.parse(row.tlds);
}

export function setCachedTlds(tldArray) {
	db.prepare(`
		INSERT INTO tld_cache (id, tlds, fetched_at)
		VALUES (1, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO UPDATE SET
			tlds = excluded.tlds,
			fetched_at = CURRENT_TIMESTAMP
	`).run(JSON.stringify(tldArray));
}

// =============================================================================
// Passphrase Operations
// =============================================================================

export function hasPassphrase(userId = 1) {
	const row = db.prepare('SELECT passphrase_hash FROM users WHERE id = ?').get(userId);
	return !!(row && row.passphrase_hash);
}

export function setPassphrase(userId = 1, passphrase) {
	const salt = crypto.randomBytes(32).toString('hex');
	const hash = crypto.scryptSync(passphrase, salt, 64).toString('hex');
	db.prepare('UPDATE users SET passphrase_hash = ? WHERE id = ?').run(`${salt}:${hash}`, userId);
}

export function verifyPassphrase(userId = 1, passphrase) {
	const row = db.prepare('SELECT passphrase_hash FROM users WHERE id = ?').get(userId);
	if (!row || !row.passphrase_hash) return false;
	const [salt, storedHash] = row.passphrase_hash.split(':');
	const hash = crypto.scryptSync(passphrase, salt, 64).toString('hex');
	return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
}

// =============================================================================
// Utility: Get full user data (for agents)
// =============================================================================

export function getFullUserData(userId = 1) {
	const profile = getProfile(userId);
	const siteData = getSiteData(userId);

	// Group site data by domain
	const siteDataByDomain = {};
	for (const item of siteData) {
		if (!siteDataByDomain[item.domain]) {
			siteDataByDomain[item.domain] = {};
		}
		siteDataByDomain[item.domain][item.field_name] = item.field_value;
	}

	return {
		profile: profile || {},
		siteData: siteDataByDomain
	};
}
