// routes/database.js - Database API endpoints
import { Router } from "express";
import { DEFAULT_USER_ID } from "../config.js";
import {
	getProfile,
	upsertProfile,
	deleteProfile,
	updateProfileExtraField,
	deleteProfileExtraField,
	getSiteData,
	upsertSiteData,
	deleteSiteData,
	getLearnedContext,
	addLearnedContext,
	deleteLearnedContext,
	getFullUserData,
	hasPassphrase,
	setPassphrase,
	verifyPassphrase
} from "../database.js";

const router = Router();

// Hardcode until auth is implemented
function getUserId(req) {
	return DEFAULT_USER_ID;
}

// Item 15: Wraps a route handler with try/catch and standard error response
function withErrorHandler(label, handler) {
	return async (req, res) => {
		try {
			await handler(req, res);
		} catch (err) {
			console.error(`[DB] ${label} error:`, err);
			res.status(500).json({ error: String(err) });
		}
	};
}

// GET /api/db/passphrase/exists - Check if passphrase is set
router.get("/api/db/passphrase/exists", withErrorHandler("Check passphrase", (req, res) => {
	const userId = getUserId(req);
	res.json({ exists: hasPassphrase(userId) });
}));

// POST /api/db/passphrase/set - Set passphrase
router.post("/api/db/passphrase/set", withErrorHandler("Set passphrase", (req, res) => {
	const { passphrase } = req.body;
	if (!passphrase) return res.status(400).json({ error: "Missing passphrase" });
	const userId = getUserId(req);
	setPassphrase(userId, passphrase);
	res.json({ success: true });
}));

// POST /api/db/passphrase/verify - Verify passphrase
router.post("/api/db/passphrase/verify", withErrorHandler("Verify passphrase", (req, res) => {
	const { passphrase } = req.body;
	if (!passphrase) return res.status(400).json({ error: "Missing passphrase" });
	const userId = getUserId(req);
	const valid = verifyPassphrase(userId, passphrase);
	res.json({ valid });
}));

// GET /api/db/profile - Get user profile
router.get("/api/db/profile", withErrorHandler("Get profile", (req, res) => {
	const userId = getUserId(req);
	const profile = getProfile(userId);
	res.json({ profile });
}));

// POST /api/db/profile - Update user profile
router.post("/api/db/profile", withErrorHandler("Update profile", (req, res) => {
	const userId = getUserId(req);
	const profile = upsertProfile(userId, req.body);
	res.json({ profile });
}));

// DELETE /api/db/profile - Delete user profile
router.delete("/api/db/profile", withErrorHandler("Delete profile", (req, res) => {
	const userId = getUserId(req);
	deleteProfile(userId);
	res.json({ success: true });
}));

// POST /api/db/profile/extra - Update a single extra field
router.post("/api/db/profile/extra", withErrorHandler("Update extra field", (req, res) => {
	const { fieldName, fieldValue } = req.body;
	if (!fieldName) {
		return res.status(400).json({ error: "Missing fieldName" });
	}
	const userId = getUserId(req);
	const profile = updateProfileExtraField(userId, fieldName, fieldValue);
	res.json({ profile });
}));

// DELETE /api/db/profile/extra - Delete a single extra field
router.delete("/api/db/profile/extra", withErrorHandler("Delete extra field", (req, res) => {
	const { fieldName } = req.body;
	if (!fieldName) {
		return res.status(400).json({ error: "Missing fieldName" });
	}
	const userId = getUserId(req);
	const profile = deleteProfileExtraField(userId, fieldName);
	res.json({ profile });
}));

// GET /api/db/site-data - Get site data
router.get("/api/db/site-data", withErrorHandler("Get site data", (req, res) => {
	const userId = getUserId(req);
	const domain = req.query.domain || null;
	const data = getSiteData(userId, domain);
	res.json({ siteData: data });
}));

// POST /api/db/site-data - Add/update site data
router.post("/api/db/site-data", withErrorHandler("Update site data", (req, res) => {
	const { domain, fieldName, fieldValue } = req.body;
	if (!domain || !fieldName) {
		return res.status(400).json({ error: "Missing domain or fieldName" });
	}
	const NEVER_STORE_FIELDS = ['ssn', 'social_security', 'socialsecurity', 'social-security'];
	if (NEVER_STORE_FIELDS.some(f => fieldName.toLowerCase().includes(f))) {
		return res.status(400).json({ error: "This field cannot be stored" });
	}
	const userId = getUserId(req);
	const data = upsertSiteData(userId, domain, fieldName, fieldValue);
	res.json({ siteData: data });
}));

// DELETE /api/db/site-data - Delete site data
router.delete("/api/db/site-data", withErrorHandler("Delete site data", (req, res) => {
	const { domain, fieldName } = req.body;
	if (!domain) {
		return res.status(400).json({ error: "Missing domain" });
	}
	const userId = getUserId(req);
	deleteSiteData(userId, domain, fieldName);
	res.json({ success: true });
}));

// GET /api/db/learned - Get learned context
router.get("/api/db/learned", withErrorHandler("Get learned context", (req, res) => {
	const userId = getUserId(req);
	const context = getLearnedContext(userId);
	res.json({ learnedContext: context });
}));

// POST /api/db/learned - Add learned context
router.post("/api/db/learned", withErrorHandler("Add learned context", (req, res) => {
	const { fact, source } = req.body;
	if (!fact) {
		return res.status(400).json({ error: "Missing fact" });
	}
	const userId = getUserId(req);
	const id = addLearnedContext(userId, fact, source);
	res.json({ id });
}));

// DELETE /api/db/learned/:id - Delete learned context
router.delete("/api/db/learned/:id", withErrorHandler("Delete learned context", (req, res) => {
	const id = parseInt(req.params.id);
	const userId = getUserId(req);
	deleteLearnedContext(id, userId);
	res.json({ success: true });
}));

// GET /api/db/user-data - Get full user data (for agents)
router.get("/api/db/user-data", withErrorHandler("Get full user data", (req, res) => {
	const userId = getUserId(req);
	const data = getFullUserData(userId);
	res.json(data);
}));

export default router;
