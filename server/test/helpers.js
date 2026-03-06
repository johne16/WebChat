import { vi } from 'vitest';

/**
 * Create a mock Express request object
 * @param {Object} overrides - Properties to merge onto the request
 * @returns {Object} Mock request
 */
export function mockReq(overrides = {}) {
	return {
		body: {},
		query: {},
		params: {},
		headers: {},
		on: vi.fn(),
		...overrides
	};
}

/**
 * Create a mock Express response object
 * @returns {Object} Mock response with chainable .status()
 */
export function mockRes() {
	const res = {
		json: vi.fn(),
		status: vi.fn(),
		write: vi.fn(),
		end: vi.fn(),
		setHeader: vi.fn(),
		flushHeaders: vi.fn(),
		headersSent: false
	};
	// .status() returns self for chaining: res.status(400).json(...)
	res.status.mockReturnValue(res);
	return res;
}
