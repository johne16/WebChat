import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "crypto";

// Point DATABASE_PATH to in-memory SQLite and set encryption key before importing
const origPath = process.env.DATABASE_PATH;
const origKey = process.env.DATABASE_ENCRYPTION_KEY;
process.env.DATABASE_PATH = ":memory:";
process.env.DATABASE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

afterAll(() => {
	if (origPath === undefined) delete process.env.DATABASE_PATH;
	else process.env.DATABASE_PATH = origPath;
	if (origKey === undefined) delete process.env.DATABASE_ENCRYPTION_KEY;
	else process.env.DATABASE_ENCRYPTION_KEY = origKey;
});

import {
	initDatabase,
	getDatabase,
	getProfile,
	upsertProfile,
	updateProfileExtraField,
	deleteProfileExtraField,
	getSiteData,
	upsertSiteData,
	deleteSiteData,
	getLearnedContext,
	addLearnedContext,
	deleteLearnedContext,
	getFullUserData
} from "../database.js";

describe("database", () => {
	beforeAll(() => {
		initDatabase();
	});

	afterAll(() => {
		const db = getDatabase();
		if (db) db.close();
	});

	it("getDatabase returns the db instance after init", () => {
		expect(getDatabase()).toBeTruthy();
	});

	describe("profile", () => {
		it("returns null for a user with no profile", () => {
			expect(getProfile(1)).toBeNull();
		});

		it("upsertProfile creates a new profile", () => {
			const profile = upsertProfile(1, {
				first_name: "John",
				last_name: "Doe",
				email: "john@example.com"
			});

			expect(profile.first_name).toBe("John");
			expect(profile.last_name).toBe("Doe");
			expect(profile.email).toBe("john@example.com");
		});

		it("upsertProfile updates existing fields via COALESCE", () => {
			// Update only email, other fields should remain
			const profile = upsertProfile(1, { email: "new@example.com" });

			expect(profile.first_name).toBe("John"); // preserved
			expect(profile.email).toBe("new@example.com"); // updated
		});

		it("upsertProfile handles extra_fields as JSON", () => {
			const profile = upsertProfile(1, {
				extra_fields: { nickname: "JD", favoriteColor: "blue" }
			});

			expect(profile.extra_fields).toEqual({ nickname: "JD", favoriteColor: "blue" });
		});

		it("updateProfileExtraField updates a single extra field", () => {
			const profile = updateProfileExtraField(1, "nickname", "Johnny");

			expect(profile.extra_fields.nickname).toBe("Johnny");
			expect(profile.extra_fields.favoriteColor).toBe("blue"); // preserved
		});

		it("deleteProfileExtraField deletes one key and preserves others", () => {
			const profile = deleteProfileExtraField(1, "nickname");

			expect(profile.extra_fields.nickname).toBeUndefined();
			expect(profile.extra_fields.favoriteColor).toBe("blue"); // preserved
		});

		it("deleteProfileExtraField on nonexistent key is a no-op", () => {
			const before = getProfile(1);
			const after = deleteProfileExtraField(1, "nonexistent_key");

			expect(after.extra_fields).toEqual(before.extra_fields);
		});

		it("stores encrypted data in the raw DB but returns plaintext via getProfile", () => {
			const db = getDatabase();
			const raw = db.prepare("SELECT email FROM profile WHERE user_id = 1").get();
			// Raw value should be encrypted (iv:ciphertext:authTag format)
			expect(raw.email).toContain(":");
			expect(raw.email).not.toBe("new@example.com");

			// But getProfile returns decrypted
			const profile = getProfile(1);
			expect(profile.email).toBe("new@example.com");
		});
	});

	describe("site data", () => {
		it("returns empty array when no site data exists", () => {
			expect(getSiteData(1, "unknown.com")).toEqual([]);
		});

		it("upsertSiteData creates and returns site data for a domain", () => {
			const data = upsertSiteData(1, "example.com", "username", "jdoe");

			expect(data.length).toBe(1);
			expect(data[0].field_name).toBe("username");
			expect(data[0].field_value).toBe("jdoe");
		});

		it("upsertSiteData updates existing field on conflict", () => {
			upsertSiteData(1, "example.com", "username", "updated_jdoe");

			const data = getSiteData(1, "example.com");
			const usernameRow = data.find(d => d.field_name === "username");
			expect(usernameRow.field_value).toBe("updated_jdoe");
		});

		it("getSiteData without domain returns all site data for user", () => {
			upsertSiteData(1, "other.com", "token", "abc");

			const all = getSiteData(1);
			const domains = [...new Set(all.map(d => d.domain))];
			expect(domains).toContain("example.com");
			expect(domains).toContain("other.com");
		});

		it("stores field_value encrypted in raw DB", () => {
			const db = getDatabase();
			const raw = db.prepare("SELECT field_value FROM site_data WHERE domain = 'example.com' AND field_name = 'username'").get();
			expect(raw.field_value).toContain(":");
			expect(raw.field_value).not.toBe("updated_jdoe");
		});

		it("deleteSiteData with fieldName deletes a single field", () => {
			upsertSiteData(1, "del.com", "a", "1");
			upsertSiteData(1, "del.com", "b", "2");

			deleteSiteData(1, "del.com", "a");

			const remaining = getSiteData(1, "del.com");
			expect(remaining).toHaveLength(1);
			expect(remaining[0].field_name).toBe("b");
		});

		it("deleteSiteData without fieldName deletes all fields for domain", () => {
			upsertSiteData(1, "nuke.com", "x", "1");
			upsertSiteData(1, "nuke.com", "y", "2");

			deleteSiteData(1, "nuke.com");

			expect(getSiteData(1, "nuke.com")).toEqual([]);
		});
	});

	describe("learned context", () => {
		it("returns empty array when no facts exist", () => {
			expect(getLearnedContext(1)).toEqual([]);
		});

		it("addLearnedContext stores a fact and returns its id", () => {
			const id = addLearnedContext(1, "User prefers dark mode", "settings");
			expect(typeof id).toBe("number");
			expect(id).toBeGreaterThan(0);
		});

		it("getLearnedContext returns facts in reverse chronological order", () => {
			addLearnedContext(1, "Fact A");
			addLearnedContext(1, "Fact B");

			const facts = getLearnedContext(1);
			// Most recent first
			expect(facts[0].fact).toBe("Fact B");
		});

		it("stores facts encrypted in raw DB", () => {
			const db = getDatabase();
			const raw = db.prepare("SELECT fact FROM learned_context ORDER BY id DESC LIMIT 1").get();
			expect(raw.fact).toContain(":");
			expect(raw.fact).not.toBe("Fact B");
		});

		it("deleteLearnedContext removes a fact by id", () => {
			const id = addLearnedContext(1, "Temporary fact");
			deleteLearnedContext(id);

			const facts = getLearnedContext(1);
			expect(facts.find(f => f.fact === "Temporary fact")).toBeUndefined();
		});
	});

	describe("getFullUserData", () => {
		it("returns combined profile and site data grouped by domain", () => {
			const data = getFullUserData(1);

			expect(data.profile).toHaveProperty("first_name");
			expect(data.siteData).toHaveProperty("example.com");
			expect(data.siteData["example.com"]).toHaveProperty("username");
		});

		it("returns empty profile object when user has no profile", () => {
			// user 999 has no profile (but we need them in users table)
			const db = getDatabase();
			db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(999);

			const data = getFullUserData(999);
			expect(data.profile).toEqual({});
			expect(data.siteData).toEqual({});
		});
	});
});
