import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockReq, mockRes } from "../helpers.js";

vi.mock("../../database.js", () => ({
	getProfile: vi.fn(),
	upsertProfile: vi.fn(),
	updateProfileExtraField: vi.fn(),
	getSiteData: vi.fn(),
	upsertSiteData: vi.fn(),
	deleteSiteData: vi.fn(),
	getLearnedContext: vi.fn(),
	addLearnedContext: vi.fn(),
	deleteLearnedContext: vi.fn(),
	getFullUserData: vi.fn()
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
		it("calls getProfile with default userId 1", async () => {
			db.getProfile.mockReturnValue({ first_name: "John" });
			const req = mockReq();
			const res = mockRes();

			const handler = getHandler("GET", "/api/db/profile");
			await handler(req, res);

			expect(db.getProfile).toHaveBeenCalledWith(1);
			expect(res.json).toHaveBeenCalledWith({ profile: { first_name: "John" } });
		});

		it("uses userId from query string", async () => {
			db.getProfile.mockReturnValue(null);
			const req = mockReq({ query: { userId: "5" } });
			const res = mockRes();

			await getHandler("GET", "/api/db/profile")(req, res);

			expect(db.getProfile).toHaveBeenCalledWith(5);
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
		it("calls deleteLearnedContext with parsed id", async () => {
			const req = mockReq({ params: { id: "7" } });
			const res = mockRes();

			await getHandler("DELETE", "/api/db/learned/:id")(req, res);

			expect(db.deleteLearnedContext).toHaveBeenCalledWith(7);
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
