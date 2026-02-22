// extension/ui.js
// UI rendering functions for chat messages, forms, and banners

const log = document.getElementById('log');
const stickyBanner = document.getElementById('sticky-banner');
const bannerMessage = document.getElementById('banner-message');

let currentInlineForm = null;

/**
 * Add a chat message to the log
 * @param {'user' | 'bot'} role - Message sender
 * @param {string} text - Message content
 */
export function addMessage(role, text) {
	const row = document.createElement('div');
	row.className = `row ${role}`;
	const bubble = document.createElement('div');
	bubble.className = `msg ${role}`;
	bubble.textContent = text;
	row.appendChild(bubble);
	log.appendChild(row);
	log.scrollTop = log.scrollHeight;
}

/**
 * Add a research step message (blue themed)
 * @param {string} stepText - Step description
 */
export function addStepMessage(stepText) {
	const row = document.createElement('div');
	row.className = 'row step';
	const bubble = document.createElement('div');
	bubble.className = 'msg step';
	bubble.textContent = `🔍 ${stepText}`;
	row.appendChild(bubble);
	log.appendChild(row);
	log.scrollTop = log.scrollHeight;
}

/**
 * Add an agent step message
 * @param {string} stepText - Step description
 */
export function addAgentStepMessage(stepText) {
	const row = document.createElement('div');
	row.className = 'row step';
	const bubble = document.createElement('div');
	bubble.className = 'msg step';
	bubble.textContent = `🤖 ${stepText}`;
	row.appendChild(bubble);
	log.appendChild(row);
	log.scrollTop = log.scrollHeight;
}

/**
 * Format field name to human-readable label
 * @param {string} fieldName - camelCase or snake_case field name
 * @returns {string} Formatted label
 */
export function formatFieldLabel(fieldName) {
	return fieldName
		.replace(/([A-Z])/g, ' $1')
		.replace(/^./, str => str.toUpperCase())
		.replace(/_/g, ' ')
		.trim();
}

/**
 * Render inline form for collecting missing fields
 * @param {string[]} missingFields - Field names to collect
 * @param {string|null} message - Optional message to display above form
 * @param {Function} onSubmit - Callback with form data object
 */
export function renderInputForm(missingFields, message, onSubmit) {
	// Remove any existing inline form
	removeCurrentForm();

	const row = document.createElement('div');
	row.className = 'row bot';

	const formEl = document.createElement('form');
	formEl.className = 'inline-input-form msg bot';

	if (message) {
		const title = document.createElement('div');
		title.className = 'form-title';
		title.textContent = message;
		formEl.appendChild(title);
	}

	const fieldsContainer = document.createElement('div');
	fieldsContainer.className = 'form-fields';

	const fields = Array.isArray(missingFields) ? missingFields : [];
	fields.forEach(field => {
		const fieldName = typeof field === 'string' ? field : field.name || field;
		const fieldLabel = typeof field === 'object' && field.label ? field.label : formatFieldLabel(fieldName);

		const fieldDiv = document.createElement('div');
		fieldDiv.className = 'form-field';

		const label = document.createElement('label');
		label.htmlFor = `field-${fieldName}`;
		label.textContent = fieldLabel;

		const inputEl = document.createElement('input');
		inputEl.type = fieldName.toLowerCase().includes('password') ? 'password' : 'text';
		inputEl.id = `field-${fieldName}`;
		inputEl.name = fieldName;
		inputEl.required = true;

		fieldDiv.appendChild(label);
		fieldDiv.appendChild(inputEl);
		fieldsContainer.appendChild(fieldDiv);
	});

	formEl.appendChild(fieldsContainer);

	const submitBtn = document.createElement('button');
	submitBtn.type = 'submit';
	submitBtn.className = 'form-submit';
	submitBtn.textContent = 'Submit';
	formEl.appendChild(submitBtn);

	formEl.addEventListener('submit', async (e) => {
		e.preventDefault();
		const formData = new FormData(formEl);
		const data = {};
		for (const [key, value] of formData.entries()) {
			data[key] = value;
		}
		removeCurrentForm();
		if (onSubmit) {
			await onSubmit(data);
		}
	});

	row.appendChild(formEl);
	log.appendChild(row);
	currentInlineForm = row;
	log.scrollTop = log.scrollHeight;
}

/**
 * Remove current inline form if exists
 */
export function removeCurrentForm() {
	if (currentInlineForm && currentInlineForm.parentNode) {
		currentInlineForm.parentNode.removeChild(currentInlineForm);
		currentInlineForm = null;
	}
}

/**
 * Show sticky banner for user action required
 * @param {string} message - Message to display
 */
export function showStickyBanner(message) {
	bannerMessage.textContent = message;
	stickyBanner.classList.add('visible');
}

/**
 * Hide sticky banner
 */
export function hideStickyBanner() {
	stickyBanner.classList.remove('visible');
}

/**
 * Add initial meta message
 * @param {string} text - Meta text to display
 */
export function addMetaMessage(text) {
	const meta = document.createElement('div');
	meta.className = 'meta';
	meta.textContent = text;
	log.appendChild(meta);
}
