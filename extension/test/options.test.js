import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const optionsHtml = readFileSync(resolve(__dirname, '../options.html'), 'utf-8');

describe('options.js', () => {
	beforeEach(async () => {
		vi.resetModules();
		chrome.storage.onChanged.addListener.mockClear();
		document.body.innerHTML = '';

		const parser = new DOMParser();
		const doc = parser.parseFromString(optionsHtml, 'text/html');
		document.body.innerHTML = doc.body.innerHTML;
	});

	it('loads and sets mode from storage', async () => {
		chrome.storage.local.get.mockImplementationOnce(() =>
			Promise.resolve({
				isTestingMode: true,
				provider: 'openai',
				modelType: 'gpt-5.2',
				agentProvider: 'openai',
				agentModelType: 'gpt-5.2'
			})
		);

		await import('../options.js');

		const switchBtn = document.getElementById('modeSwitch');
		expect(switchBtn.getAttribute('aria-checked')).toBe('true');
		expect(switchBtn.classList.contains('on')).toBe(true);
	});

	it('toggle click updates storage and UI', async () => {
		chrome.storage.local.get.mockImplementationOnce(() =>
			Promise.resolve({
				isTestingMode: false,
				provider: 'openai',
				modelType: 'gpt-5.2',
				agentProvider: 'openai',
				agentModelType: 'gpt-5.2'
			})
		);

		await import('../options.js');

		const switchBtn = document.getElementById('modeSwitch');
		// Initially off (false)
		expect(switchBtn.getAttribute('aria-checked')).toBe('false');

		// Click to toggle on
		switchBtn.click();

		expect(switchBtn.getAttribute('aria-checked')).toBe('true');
		expect(chrome.storage.local.set).toHaveBeenCalledWith(
			expect.objectContaining({ isTestingMode: true })
		);
	});

	it('model form change persists provider and model to storage', async () => {
		chrome.storage.local.get.mockImplementationOnce(() =>
			Promise.resolve({
				isTestingMode: false,
				provider: 'openai',
				modelType: 'gpt-5.2',
				agentProvider: 'openai',
				agentModelType: 'gpt-5.2'
			})
		);

		await import('../options.js');

		const modelForm = document.getElementById('modelForm');
		const radio = modelForm.querySelector('input[value="anthropic:claude-opus-4-6"]');
		radio.checked = true;

		// Dispatch change event from the radio button directly
		radio.dispatchEvent(new Event('change', { bubbles: true }));

		expect(chrome.storage.local.set).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: 'anthropic',
				modelType: 'claude-opus-4-6'
			})
		);
	});

	it('pre-selects stored provider:model radio on load', async () => {
		chrome.storage.local.get.mockImplementationOnce(() =>
			Promise.resolve({
				isTestingMode: false,
				provider: 'anthropic',
				modelType: 'claude-opus-4-6',
				agentProvider: 'openai',
				agentModelType: 'gpt-5.2'
			})
		);

		await import('../options.js');

		const radio = document.querySelector('input[value="anthropic:claude-opus-4-6"]');
		expect(radio.checked).toBe(true);
	});

	it('keyboard Space toggles mode', async () => {
		chrome.storage.local.get.mockImplementationOnce(() =>
			Promise.resolve({
				isTestingMode: false,
				provider: 'openai',
				modelType: 'gpt-5.2',
				agentProvider: 'openai',
				agentModelType: 'gpt-5.2'
			})
		);

		await import('../options.js');

		const switchBtn = document.getElementById('modeSwitch');
		const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
		switchBtn.dispatchEvent(event);

		expect(switchBtn.getAttribute('aria-checked')).toBe('true');
	});
});
