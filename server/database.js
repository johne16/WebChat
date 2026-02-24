// database.js - SQLite database for WebChat
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'webchat.db');

let db = null;

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

		-- Ensure default user exists
		INSERT OR IGNORE INTO users (id) VALUES (1);
	`);

	console.log(`[Database] Initialized at ${DB_PATH}`);
	return db;
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

/**
 * Get database path (for passing to agents)
 */
export function getDatabasePath() {
	return DB_PATH;
}

// =============================================================================
// Profile Operations
// =============================================================================

export function getProfile(userId = 1) {
	const row = db.prepare(`
		SELECT * FROM profile WHERE user_id = ?
	`).get(userId);

	if (row && row.extra_fields) {
		row.extra_fields = JSON.parse(row.extra_fields);
	}
	return row || null;
}

export function upsertProfile(userId = 1, data) {
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
		data.first_name || null,
		data.last_name || null,
		data.email || null,
		data.phone || null,
		data.birth_date || null,
		data.street || null,
		data.city || null,
		data.state || null,
		data.zip || null,
		data.country || null,
		extraFields
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
	`).run(JSON.stringify(extraFields), userId);

	return getProfile(userId);
}

// =============================================================================
// Site Data Operations
// =============================================================================

export function getSiteData(userId = 1, domain = null) {
	if (domain) {
		return db.prepare(`
			SELECT * FROM site_data WHERE user_id = ? AND domain = ?
		`).all(userId, domain);
	}
	return db.prepare(`
		SELECT * FROM site_data WHERE user_id = ?
	`).all(userId);
}

export function upsertSiteData(userId = 1, domain, fieldName, fieldValue) {
	db.prepare(`
		INSERT INTO site_data (user_id, domain, field_name, field_value)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id, domain, field_name) DO UPDATE SET
			field_value = excluded.field_value
	`).run(userId, domain, fieldName, fieldValue);

	return getSiteData(userId, domain);
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
	return db.prepare(`
		SELECT * FROM learned_context WHERE user_id = ?
		ORDER BY created_at DESC
	`).all(userId);
}

export function addLearnedContext(userId = 1, fact, source = null) {
	const result = db.prepare(`
		INSERT INTO learned_context (user_id, fact, source)
		VALUES (?, ?, ?)
	`).run(userId, fact, source);

	return result.lastInsertRowid;
}

export function deleteLearnedContext(id) {
	db.prepare(`DELETE FROM learned_context WHERE id = ?`).run(id);
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
