// extension/ui.js
// UI rendering functions for chat messages, forms, and banners

const log = document.getElementById('log');
const stickyBanner = document.getElementById('sticky-banner');
const bannerMessage = document.getElementById('banner-message');
const headerProgress = document.getElementById('header-progress');

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
 * Add a step message with a prefix icon
 * @param {string} stepText - Step description
 * @param {string} prefix - Emoji/icon prefix (default: research icon)
 */
export function addStepMessage(stepText, prefix = '\uD83D\uDD0D') {
	const row = document.createElement('div');
	row.className = 'row step';
	const bubble = document.createElement('div');
	bubble.className = 'msg step';
	bubble.textContent = `${prefix} ${stepText}`;
	row.appendChild(bubble);
	log.appendChild(row);
	log.scrollTop = log.scrollHeight;
}


/**
 * Update header progress indicator text
 * @param {string} text - Progress text to display, or empty string to hide
 */
export function updateHeaderProgress(text) {
	if (!headerProgress) return;
	if (text) {
		headerProgress.textContent = text;
		headerProgress.hidden = false;
		// Trigger reflow so the transition fires after hidden is removed
		headerProgress.offsetWidth;
		headerProgress.classList.add('visible');
	} else {
		headerProgress.classList.remove('visible');
		// Hide element after fade-out transition
		const onEnd = () => {
			headerProgress.hidden = true;
			headerProgress.textContent = '';
			headerProgress.removeEventListener('transitionend', onEnd);
		};
		headerProgress.addEventListener('transitionend', onEnd);
		// Fallback if transition doesn't fire (already hidden, etc.)
		setTimeout(() => {
			headerProgress.hidden = true;
			headerProgress.textContent = '';
		}, 300);
	}
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

// =============================================================================
// Password Modal
// =============================================================================

const passwordModal = document.getElementById('password-modal');
const modalPassphrase = document.getElementById('modal-passphrase');
const modalCancel = document.getElementById('modal-cancel');
const modalSubmit = document.getElementById('modal-submit');

/**
 * Show the password modal and focus the input
 */
export function showPasswordModal() {
	passwordModal.classList.add('visible');
	modalPassphrase.value = '';
	modalPassphrase.focus();
}

/**
 * Hide the password modal and clear the input
 */
export function hidePasswordModal() {
	passwordModal.classList.remove('visible');
	modalPassphrase.value = '';
}

/**
 * Register callbacks for password modal interactions
 * @param {Object} callbacks - { onSubmit, onCancel }
 */
export function onPasswordModal({ onSubmit, onCancel }) {
	modalCancel.addEventListener('click', () => {
		hidePasswordModal();
		if (onCancel) onCancel();
	});

	modalSubmit.addEventListener('click', async () => {
		const passphrase = modalPassphrase.value;
		if (!passphrase) return;
		if (onSubmit) await onSubmit(passphrase);
	});

	modalPassphrase.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			modalSubmit.click();
		}
	});
}

// =============================================================================
// Stop Agent Button
// =============================================================================

const stopAgentBtn = document.getElementById('stop-agent-btn');

/**
 * Show the stop agent button
 */
export function showStopButton() {
	stopAgentBtn.hidden = false;
}

/**
 * Hide the stop agent button
 */
export function hideStopButton() {
	stopAgentBtn.hidden = true;
}

/**
 * Register click handler for the stop agent button
 * @param {Function} handler - Async click handler
 */
export function onStopAgentClick(handler) {
	stopAgentBtn.addEventListener('click', async () => {
		await handler();
	});
}
