import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupDOM } from './helpers.js';

describe('ui.js', () => {
	let ui;

	beforeEach(async () => {
		setupDOM();
		// Reset module registry so ui.js re-binds to fresh DOM
		vi.resetModules();
		ui = await import('../ui.js');
	});

	describe('addMessage', () => {
		it('creates a row with the correct role class', () => {
			ui.addMessage('user', 'Hello');
			const log = document.getElementById('log');
			const row = log.querySelector('.row.user');
			expect(row).not.toBeNull();
			const bubble = row.querySelector('.msg.user');
			expect(bubble.textContent).toBe('Hello');
		});

		it('creates bot message with bot class', () => {
			ui.addMessage('bot', 'Hi there');
			const log = document.getElementById('log');
			const bubble = log.querySelector('.msg.bot');
			expect(bubble.textContent).toBe('Hi there');
		});

		it('appends multiple messages in order', () => {
			ui.addMessage('user', 'First');
			ui.addMessage('bot', 'Second');
			const log = document.getElementById('log');
			const rows = log.querySelectorAll('.row');
			expect(rows.length).toBe(2);
			expect(rows[0].querySelector('.msg').textContent).toBe('First');
			expect(rows[1].querySelector('.msg').textContent).toBe('Second');
		});
	});

	describe('showThinkingIndicator / removeThinkingIndicator', () => {
		it('appends thinking dots to log', () => {
			ui.showThinkingIndicator();
			const log = document.getElementById('log');
			const thinking = log.querySelector('.thinking-row');
			expect(thinking).not.toBeNull();
			expect(thinking.querySelectorAll('.dot').length).toBe(3);
		});

		it('is idempotent - calling twice does not duplicate', () => {
			ui.showThinkingIndicator();
			ui.showThinkingIndicator();
			const log = document.getElementById('log');
			expect(log.querySelectorAll('.thinking-row').length).toBe(1);
		});

		it('removes thinking indicator', () => {
			ui.showThinkingIndicator();
			ui.removeThinkingIndicator();
			const log = document.getElementById('log');
			expect(log.querySelector('.thinking-row')).toBeNull();
		});

		it('removeThinkingIndicator is safe when none exists', () => {
			expect(() => ui.removeThinkingIndicator()).not.toThrow();
		});
	});

	describe('addStepMessage', () => {
		it('renders step message with default prefix', () => {
			ui.addStepMessage('Searching...');
			const log = document.getElementById('log');
			const step = log.querySelector('.msg.step');
			expect(step.textContent).toContain('Searching...');
		});

		it('renders step message with custom prefix', () => {
			ui.addStepMessage('Fetching page', '>>');
			const log = document.getElementById('log');
			const step = log.querySelector('.msg.step');
			expect(step.textContent).toBe('>> Fetching page');
		});
	});

	describe('formatFieldLabel', () => {
		it('converts camelCase to spaced words', () => {
			expect(ui.formatFieldLabel('firstName')).toBe('First Name');
		});

		it('converts snake_case to spaced words', () => {
			expect(ui.formatFieldLabel('birth_date')).toBe('Birth date');
		});

		it('capitalizes first letter', () => {
			expect(ui.formatFieldLabel('email')).toBe('Email');
		});

		it('handles single word', () => {
			expect(ui.formatFieldLabel('phone')).toBe('Phone');
		});
	});

	describe('updateHeaderProgress', () => {
		it('shows progress text', () => {
			ui.updateHeaderProgress('Loading...');
			const hp = document.getElementById('header-progress');
			expect(hp.textContent).toBe('Loading...');
			expect(hp.hidden).toBe(false);
			expect(hp.classList.contains('visible')).toBe(true);
		});

		it('hides when given empty string', () => {
			ui.updateHeaderProgress('Loading...');
			ui.updateHeaderProgress('');
			const hp = document.getElementById('header-progress');
			expect(hp.classList.contains('visible')).toBe(false);
		});
	});

	describe('renderInputForm', () => {
		it('creates form with fields and calls onSubmit', async () => {
			const onSubmit = vi.fn();
			ui.renderInputForm(['username', 'email'], 'Fill this out', onSubmit);

			const log = document.getElementById('log');
			const form = log.querySelector('.inline-input-form');
			expect(form).not.toBeNull();

			const title = form.querySelector('.form-title');
			expect(title.textContent).toBe('Fill this out');

			const inputs = form.querySelectorAll('input');
			expect(inputs.length).toBe(2);
			expect(inputs[0].name).toBe('username');
			expect(inputs[1].name).toBe('email');
		});

		it('uses password type for password fields', () => {
			ui.renderInputForm(['password'], null, vi.fn());
			const log = document.getElementById('log');
			const input = log.querySelector('input[name="password"]');
			expect(input.type).toBe('password');
		});

		it('replaces existing form on re-render', () => {
			ui.renderInputForm(['field1'], null, vi.fn());
			ui.renderInputForm(['field2'], null, vi.fn());
			const log = document.getElementById('log');
			const forms = log.querySelectorAll('.inline-input-form');
			expect(forms.length).toBe(1);
			expect(forms[0].querySelector('input').name).toBe('field2');
		});
	});

	describe('removeCurrentForm', () => {
		it('removes existing form', () => {
			ui.renderInputForm(['test'], null, vi.fn());
			ui.removeCurrentForm();
			const log = document.getElementById('log');
			expect(log.querySelector('.inline-input-form')).toBeNull();
		});

		it('is safe when no form exists', () => {
			expect(() => ui.removeCurrentForm()).not.toThrow();
		});
	});

	describe('showStickyBanner / hideStickyBanner', () => {
		it('shows banner with message', () => {
			ui.showStickyBanner('Action required');
			const banner = document.getElementById('sticky-banner');
			const msg = document.getElementById('banner-message');
			expect(banner.classList.contains('visible')).toBe(true);
			expect(msg.textContent).toBe('Action required');
		});

		it('hides banner', () => {
			ui.showStickyBanner('Test');
			ui.hideStickyBanner();
			const banner = document.getElementById('sticky-banner');
			expect(banner.classList.contains('visible')).toBe(false);
		});
	});

	describe('showStopButton / hideStopButton', () => {
		it('shows the stop button', () => {
			ui.showStopButton();
			const btn = document.getElementById('stop-agent-btn');
			expect(btn.hidden).toBe(false);
		});

		it('hides the stop button', () => {
			ui.showStopButton();
			ui.hideStopButton();
			const btn = document.getElementById('stop-agent-btn');
			expect(btn.hidden).toBe(true);
		});
	});

	describe('onStopAgentClick', () => {
		it('registers a click handler on the stop button', async () => {
			const handler = vi.fn();
			ui.onStopAgentClick(handler);
			const btn = document.getElementById('stop-agent-btn');
			btn.click();
			// handler is called asynchronously via async wrapper
			await new Promise(r => setTimeout(r, 0));
			expect(handler).toHaveBeenCalled();
		});
	});

	describe('addMetaMessage', () => {
		it('creates meta div with text', () => {
			ui.addMetaMessage('Welcome');
			const log = document.getElementById('log');
			const meta = log.querySelector('.meta');
			expect(meta).not.toBeNull();
			expect(meta.textContent).toBe('Welcome');
		});
	});
});
