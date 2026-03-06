// Global test setup - stubs chrome APIs before any extension module imports
import { vi } from 'vitest';

function makeStorageArea() {
	return {
		get: vi.fn((keys, cb) => {
			if (cb) cb({});
			return Promise.resolve({});
		}),
		set: vi.fn((data, cb) => {
			if (cb) cb();
			return Promise.resolve();
		}),
		remove: vi.fn((keys, cb) => {
			if (cb) cb();
			return Promise.resolve();
		}),
		onChanged: {
			addListener: vi.fn()
		}
	};
}

globalThis.chrome = {
	storage: {
		local: makeStorageArea(),
		onChanged: {
			addListener: vi.fn()
		}
	},
	tabs: {
		query: vi.fn(() => Promise.resolve([])),
		onActivated: {
			addListener: vi.fn()
		}
	},
	runtime: {
		sendMessage: vi.fn(),
		onMessage: {
			addListener: vi.fn()
		},
		onInstalled: {
			addListener: vi.fn()
		},
		openOptionsPage: vi.fn()
	},
	action: {
		onClicked: {
			addListener: vi.fn()
		}
	},
	commands: {
		onCommand: {
			addListener: vi.fn()
		}
	},
	sidePanel: {
		setOptions: vi.fn(),
		open: vi.fn()
	},
	windows: {
		onFocusChanged: {
			addListener: vi.fn()
		},
		WINDOW_ID_NONE: -1
	}
};
