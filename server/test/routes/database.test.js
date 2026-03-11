import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockReq, mockRes } from "../helpers.js";

vi.mock("../../database.js", () => ({
	getProfile: vi.fn(),
	upsertProfile: vi.fn(),
	deleteProfile: vi.fn(),
	updateProfileExtraField: vi.fn(),
	deleteProfileExtraField: vi.fn(),
	getSiteData: vi.fn(),
	upsertSiteData: vi.fn(),
	deleteSiteData: vi.fn(),
	getLearnedContext: vi.fn(),
	addLearnedContext: vi.fn(),
	deleteLearnedContext: vi.fn(),
	getFullUserData: vi.fn(),
	hasPassphrase: vi.fn(),
	setPassphrase: vi.fn(),
	verifyPassphrase: vi.fn()
}));

import * as db from "../../database.js";

// Import the router and extract route handlers
import router from "../../routes/database.js";

// Helper: find the route handler registered on the router for a given method + path
function getHandler(method, path) {
	for (const layer of router.stack) {
		if (layer.route && layer.route.path === path) {
			const routeMethod = method.toLowerCase();
			const handler = layer.route.methods[routeMethod] && layer.route.stack.find(s => s.method === routeMethod);
			if (handler) return handler.handle;
		}
	}
	throw new Error(`No handler found for ${method} ${path}`);
}

describe("routes/database", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("GET /api/db/profile", () => {
		it("calls getProfile with DEFAULT_USER_ID", async () => {
			db.getProfile.mockReturnValue({ first_name: "John" });
			const req = mockReq();
			const res = mockRes();

			const handler = getHandler("GET", "/api/db/profile");
			await handler(req, res);

			expect(db.getProfile).toHaveBeenCalledWith(1);
			expect(res.json).toHaveBeenCalledWith({ profile: { first_name: "John" } });
		});

		it("always uses DEFAULT_USER_ID regardless of query string", async () => {
			db.getProfile.mockReturnValue(null);
			const req = mockReq({ query: { userId: "5" } });
			const res = mockRes();

			await getHandler("GET", "/api/db/profile")(req, res);

			// Source uses DEFAULT_USER_ID, not query string
			expect(db.getProfile).toHaveBeenCalledWith(1);
		});
	});

	describe("POST /api/db/profile", () => {
		it("calls upsertProfile with body data", async () => {
			const profileData = { first_name: "Jane", email: "jane@test.com" };
			db.upsertProfile.mockReturnValue(profileData);
			const req = mockReq({ body: profileData });
			const res = mockRes();

			await getHandler("POST", "/api/db/profile")(req, res);

			expect(db.upsertProfile).toHaveBeenCalledWith(1, profileData);
			expect(res.json).toHaveBeenCalledWith({ profile: profileData });
		});
	});

	describe("DELETE /api/db/profile", () => {
		it("calls deleteProfile with DEFAULT_USER_ID and returns success", async () => {
			const req = mockReq();
			const res = mockRes();

			await getHandler("DELETE", "/api/db/profile")(req, res);

			expect(db.deleteProfile).toHaveBeenCalledWith(1);
			expect(res.json).toHaveBeenCalledWith({ success: true });
		});
	});

	describe("POST /api/db/profile/extra", () => {
		it("returns 400 if fieldName is missing", async () => {
			const req = mockReq({ body: { fieldValue: "x" } });
			const res = mockRes();

			await getHandler("POST", "/api/db/profile/extra")(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(res.json).toHaveBeenCalledWith({ error: "Missing fieldName" });
		});

		it("calls updateProfileExtraField with correct args", async () => {
			db.updateProfileExtraField.mockReturnValue({ extra_fields: { color: "red" } });
			const req = mockReq({ body: { fieldName: "color", fieldValue: "red" } });
			const res = mockRes();

			await getHandler("POST", "/api/db/profile/extra")(req, res);

			expect(db.updateProfileExtraField).toHaveBeenCalledWith(1, "color", "red");
		});
	});

	describe("DELETE /api/db/profile/extra", () => {
		it("returns 400 if fieldName is missing", async () => {
			const req = mockReq({ body: {} });
			const res = mockRes();

			await getHandler("DELETE", "/api/db/profile/extra")(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(res.json).toHaveBeenCalledWith({ error: "Missing fieldName" });
		});

		it("calls deleteProfileExtraField with correct args", async () => {
			db.deleteProfileExtraField.mockReturnValue({ extra_fields: {} });
			const req = mockReq({ body: { fieldName: "color" } });
			const res = mockRes();

			await getHandler("DELETE", "/api/db/profile/extra")(req, res);

			expect(db.deleteProfileExtraField).toHaveBeenCalledWith(1, "color");
			expect(res.json).toHaveBeenCalledWith({ profile: { extra_fields: {} } });
		});
	});

	describe("GET /api/db/site-data", () => {
		it("passes domain from query string", async () => {
			db.getSiteData.mockReturnValue([]);
			const req = mockReq({ query: { domain: "test.com" } });
			const res = mockRes();

			await getHandler("GET", "/api/db/site-data")(req, res);

			expect(db.getSiteData).toHaveBeenCalledWith(1, "test.com");
		});

		it("passes null domain when not specified", async () => {
			db.getSiteData.mockReturnValue([]);
			const req = mockReq();
			const res = mockRes();

			await getHandler("GET", "/api/db/site-data")(req, res);

			expect(db.getSiteData).toHaveBeenCalledWith(1, null);
		});
	});

	describe("POST /api/db/site-data", () => {
		it("returns 400 if domain or fieldName is missing", async () => {
			const req = mockReq({ body: { domain: "x.com" } });
			const res = mockRes();

			await getHandler("POST", "/api/db/site-data")(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
		});

		it("calls upsertSiteData with correct args", async () => {
			db.upsertSiteData.mockReturnValue([]);
			const req = mockReq({ body: { domain: "x.com", fieldName: "user", fieldValue: "bob" } });
			const res = mockRes();

			await getHandler("POST", "/api/db/site-data")(req, res);

			expect(db.upsertSiteData).toHaveBeenCalledWith(1, "x.com", "user", "bob");
		});

		it("blocks SSN fields from being stored", async () => {
			const req = mockReq({ body: { domain: "x.com", fieldName: "ssn", fieldValue: "123-45-6789" } });
			const res = mockRes();

			await getHandler("POST", "/api/db/site-data")(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(res.json).toHaveBeenCalledWith({ error: "This field cannot be stored" });
			expect(db.upsertSiteData).not.toHaveBeenCalled();
		});

		it("blocks social_security field variations", async () => {
			const req = mockReq({ body: { domain: "x.com", fieldName: "social_security_number", fieldValue: "123" } });
			const res = mockRes();

			await getHandler("POST", "/api/db/site-data")(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(db.upsertSiteData).not.toHaveBeenCalled();
		});
	});

	describe("DELETE /api/db/site-data", () => {
		it("returns 400 if domain is missing", async () => {
			const req = mockReq({ body: {} });
			const res = mockRes();

			await getHandler("DELETE", "/api/db/site-data")(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
		});

		it("calls deleteSiteData and returns success", async () => {
			const req = mockReq({ body: { domain: "x.com", fieldName: "user" } });
			const res = mockRes();

			await getHandler("DELETE", "/api/db/site-data")(req, res);

			expect(db.deleteSiteData).toHaveBeenCalledWith(1, "x.com", "user");
			expect(res.json).toHaveBeenCalledWith({ success: true });
		});
	});

	describe("GET /api/db/passphrase/exists", () => {
		it("returns exists status from hasPassphrase", async () => {
			db.hasPassphrase.mockReturnValue(true);
			const req = mockReq();
			const res = mockRes();

			await getHandler("GET", "/api/db/passphrase/exists")(req, res);

			expect(db.hasPassphrase).toHaveBeenCalledWith(1);
			expect(res.json).toHaveBeenCalledWith({ exists: true });
		});

		it("returns false when no passphrase set", async () => {
			db.hasPassphrase.mockReturnValue(false);
			const req = mockReq();
			const res = mockRes();

			await getHandler("GET", "/api/db/passphrase/exists")(req, res);

			expect(res.json).toHaveBeenCalledWith({ exists: false });
		});
	});

	describe("POST /api/db/passphrase/set", () => {
		it("returns 400 if passphrase is missing", async () => {
			const req = mockReq({ body: {} });
			const res = mockRes();

			await getHandler("POST", "/api/db/passphrase/set")(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(res.json).toHaveBeenCalledWith({ error: "Missing passphrase" });
		});

		it("calls setPassphrase and returns success", async () => {
			const req = mockReq({ body: { passphrase: "secret123" } });
			const res = mockRes();

			await getHandler("POST", "/api/db/passphrase/set")(req, res);

			expect(db.setPassphrase).toHaveBeenCalledWith(1, "secret123");
			expect(res.json).toHaveBeenCalledWith({ success: true });
		});
	});

	describe("POST /api/db/passphrase/verify", () => {
		it("returns 400 if passphrase is missing", async () => {
			const req = mockReq({ body: {} });
			const res = mockRes();

			await getHandler("POST", "/api/db/passphrase/verify")(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(res.json).toHaveBeenCalledWith({ error: "Missing passphrase" });
		});

		it("returns valid true for correct passphrase", async () => {
			db.verifyPassphrase.mockReturnValue(true);
			const req = mockReq({ body: { passphrase: "correct" } });
			const res = mockRes();

			await getHandler("POST", "/api/db/passphrase/verify")(req, res);

			expect(db.verifyPassphrase).toHaveBeenCalledWith(1, "correct");
			expect(res.json).toHaveBeenCalledWith({ valid: true });
		});

		it("returns valid false for wrong passphrase", async () => {
			db.verifyPassphrase.mockReturnValue(false);
			const req = mockReq({ body: { passphrase: "wrong" } });
			const res = mockRes();

			await getHandler("POST", "/api/db/passphrase/verify")(req, res);

			expect(res.json).toHaveBeenCalledWith({ valid: false });
		});
	});

	describe("GET /api/db/learned", () => {
		it("calls getLearnedContext and returns results", async () => {
			const facts = [{ id: 1, fact: "likes coffee", source: "chat" }];
			db.getLearnedContext.mockReturnValue(facts);
			const req = mockReq();
			const res = mockRes();

			await getHandler("GET", "/api/db/learned")(req, res);

			expect(db.getLearnedContext).toHaveBeenCalledWith(1);
			expect(res.json).toHaveBeenCalledWith({ learnedContext: facts });
		});
	});

	describe("POST /api/db/learned", () => {
		it("returns 400 if fact is missing", async () => {
			const req = mockReq({ body: {} });
			const res = mockRes();

			await getHandler("POST", "/api/db/learned")(req, res);

			expect(res.status).toHaveBeenCalledWith(400);
		});

		it("calls addLearnedContext and returns id", async () => {
			db.addLearnedContext.mockReturnValue(42);
			const req = mockReq({ body: { fact: "likes coffee", source: "chat" } });
			const res = mockRes();

			await getHandler("POST", "/api/db/learned")(req, res);

			expect(db.addLearnedContext).toHaveBeenCalledWith(1, "likes coffee", "chat");
			expect(res.json).toHaveBeenCalledWith({ id: 42 });
		});
	});

	describe("DELETE /api/db/learned/:id", () => {
		it("calls deleteLearnedContext with parsed id and userId", async () => {
			const req = mockReq({ params: { id: "7" } });
			const res = mockRes();

			await getHandler("DELETE", "/api/db/learned/:id")(req, res);

			expect(db.deleteLearnedContext).toHaveBeenCalledWith(7, 1);
			expect(res.json).toHaveBeenCalledWith({ success: true });
		});
	});

	describe("GET /api/db/user-data", () => {
		it("calls getFullUserData and returns result", async () => {
			const userData = { profile: {}, siteData: {} };
			db.getFullUserData.mockReturnValue(userData);
			const req = mockReq();
			const res = mockRes();

			await getHandler("GET", "/api/db/user-data")(req, res);

			expect(db.getFullUserData).toHaveBeenCalledWith(1);
			expect(res.json).toHaveBeenCalledWith(userData);
		});
	});

	describe("withErrorHandler", () => {
		it("returns 500 when the handler throws", async () => {
			db.getProfile.mockImplementation(() => { throw new Error("db crash"); });
			const req = mockReq();
			const res = mockRes();

			await getHandler("GET", "/api/db/profile")(req, res);

			expect(res.status).toHaveBeenCalledWith(500);
			expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining("db crash") });
		});
	});
});
