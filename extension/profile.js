// extension/profile.js
// Profile management page logic - uses server API

import { formatFieldLabel } from './ui.js';
import { getUserId, loadConfig, SERVER_BASE } from './config.js';

// Inline SVGs for eye toggle (no external deps)
const SVG_EYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const SVG_EYE_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

// Wrap a password input with a show/hide toggle button
function addEyeToggle(input) {
	const wrapper = document.createElement('div');
	wrapper.className = 'password-wrapper';
	input.parentNode.insertBefore(wrapper, input);
	wrapper.appendChild(input);

	const toggle = document.createElement('button');
	toggle.type = 'button';
	toggle.className = 'btn-eye-toggle';
	toggle.title = 'Show/hide';
	toggle.innerHTML = SVG_EYE;
	wrapper.appendChild(toggle);

	const reveal = () => { input.type = 'text'; toggle.innerHTML = SVG_EYE_OFF; };
	const hide = () => { input.type = 'password'; toggle.innerHTML = SVG_EYE; };
	toggle.addEventListener('mousedown', reveal);
	toggle.addEventListener('mouseup', hide);
	toggle.addEventListener('mouseleave', hide);
}

// Load config from server (profile.html is a standalone page)
await loadConfig();

const USER_ID = getUserId();

// DOM elements
const messageEl = document.getElementById('message');
const profileSection = document.getElementById('profile-section');
const siteDataSection = document.getElementById('site-data-section');
const siteDataContainer = document.getElementById('site-data-container');
const dangerSection = document.getElementById('danger-section');
const profileForm = document.getElementById('profile-form');
const deleteProfileBtn = document.getElementById('delete-profile-btn');
const dynamicFieldsContainer = document.getElementById('dynamic-fields');
const lockSection = document.getElementById('lock-section');
const unlockForm = document.getElementById('unlock-form');
const forgotLink = document.getElementById('forgot-passphrase-link');
const createPassphraseSection = document.getElementById('create-passphrase-section');
const createPassphraseForm = document.getElementById('create-passphrase-form');
const skipPassphraseBtn = document.getElementById('skip-passphrase-btn');

// Add eye toggles to static passphrase inputs
addEyeToggle(document.getElementById('unlock-passphrase'));
addEyeToggle(document.getElementById('new-passphrase'));
addEyeToggle(document.getElementById('confirm-passphrase'));

// State
let currentProfile = null;
let passphraseExists = false;

// Profile field names (standard fields in DB use snake_case)
const STANDARD_FIELDS = [
	'first_name', 'last_name', 'email', 'phone',
	'street', 'city', 'state', 'zip', 'country', 'birth_date'
];

// Fields to mask in the site data display
const SENSITIVE_FIELDS = ['password', 'secret', 'token', 'key', 'pin', 'cvv', 'ssn'];

// Show message
function showMessage(text, type = 'error') {
	messageEl.textContent = text;
	messageEl.className = `message ${type}`;
	setTimeout(() => {
		messageEl.className = 'message hidden';
	}, 5000);
}

// Initialize: check passphrase gate, then load profile
async function init() {
	try {
		const ppRes = await fetch(`${SERVER_BASE}/api/db/passphrase/exists`);
		if (!ppRes.ok) throw new Error('Failed to check passphrase');
		const ppData = await ppRes.json();
		passphraseExists = ppData.exists;

		if (passphraseExists && sessionStorage.getItem('profileUnlocked') !== 'true') {
			// Show lock screen
			lockSection.hidden = false;
			return;
		}

		await loadProfile();
	} catch (error) {
		console.error('Init error:', error);
		showMessage('Failed to connect to server. Is it running?');
		profileSection.hidden = false;
		dangerSection.hidden = false;
	}
}

async function loadProfile() {
	const res = await fetch(`${SERVER_BASE}/api/db/profile?userId=${USER_ID}`);
	if (!res.ok) throw new Error('Failed to load profile');
	const data = await res.json();
	currentProfile = data.profile || {};

	profileSection.hidden = false;
	siteDataSection.hidden = false;
	dangerSection.hidden = false;

	populateForm(currentProfile);
	await loadSiteData();
}

function formatPhoneDisplay(digits) {
	if (!digits) return '';
	if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
	if (digits.length === 11 && digits[0] === '1') return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
	return digits;
}

// Populate form with profile data
function populateForm(profile) {
	STANDARD_FIELDS.forEach(field => {
		const input = document.getElementById(field);
		if (input && profile[field]) {
			input.value = field === 'phone' ? formatPhoneDisplay(profile[field]) : profile[field];
		}
	});

	// Populate dynamic fields from extra_fields
	renderDynamicFields(profile.extra_fields || {});
}

// Render dynamic fields
function renderDynamicFields(extraFields) {
	dynamicFieldsContainer.innerHTML = '';
	const keys = Object.keys(extraFields);
	if (keys.length === 0) return;

	const header = document.createElement('h3');
	header.textContent = 'Additional Fields';
	header.style.marginTop = '16px';
	header.style.marginBottom = '8px';
	header.style.fontSize = '14px';
	dynamicFieldsContainer.appendChild(header);

	keys.forEach(key => {
		const row = document.createElement('div');
		row.className = 'extra-field-row';

		const formRow = document.createElement('div');
		formRow.className = 'form-row';

		const label = document.createElement('label');
		label.htmlFor = `dynamic-${key}`;
		label.textContent = formatFieldLabel(key);

		const input = document.createElement('input');
		input.type = isSensitiveField(key) ? 'password' : 'text';
		input.id = `dynamic-${key}`;
		input.name = `extra_${key}`;
		input.value = extraFields[key] || '';

		formRow.appendChild(label);
		formRow.appendChild(input);
		if (isSensitiveField(key)) addEyeToggle(input);

		const deleteBtn = el('button', 'btn-icon delete', '\uD83D\uDDD1\uFE0F');
		deleteBtn.type = 'button';
		deleteBtn.title = 'Delete this field';
		deleteBtn.addEventListener('click', () => deleteExtraField(key));

		row.appendChild(formRow);
		row.appendChild(deleteBtn);
		dynamicFieldsContainer.appendChild(row);
	});
}

// Small DOM helper
function el(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text != null) node.textContent = text;
	return node;
}

function isSensitiveField(fieldName) {
	const lower = fieldName.toLowerCase();
	return SENSITIVE_FIELDS.some(s => lower.includes(s));
}

// Load and render site data from server
async function loadSiteData() {
	try {
		const res = await fetch(`${SERVER_BASE}/api/db/site-data?userId=${USER_ID}`);
		if (!res.ok) return;
		const data = await res.json();

		// Group by domain
		const grouped = {};
		for (const item of (data.siteData || [])) {
			if (!grouped[item.domain]) grouped[item.domain] = {};
			grouped[item.domain][item.field_name] = item.field_value;
		}
		renderSiteData(grouped);
	} catch (error) {
		console.error('Load site data error:', error);
	}
}

// Render site-specific data
function renderSiteData(siteData) {
	// Preserve which sites are expanded before re-rendering
	const expandedSites = new Set(
		[...siteDataContainer.querySelectorAll('.site-item.expanded')]
			.map(item => item.dataset.site)
	);

	siteDataContainer.innerHTML = '';

	const sites = Object.keys(siteData);
	if (sites.length === 0) {
		siteDataContainer.innerHTML = '<p class="empty-state">No site data saved yet.</p>';
		return;
	}

	sites.forEach(site => {
		const fields = siteData[site];
		const siteItem = el('div', 'site-item');
		siteItem.dataset.site = site;
		if (expandedSites.has(site)) siteItem.classList.add('expanded');

		const siteHeader = el('div', 'site-header');
		const siteName = el('span', 'site-name');
		const chevron = document.createElement('span');
		chevron.className = 'chevron';
		chevron.innerHTML = '&#9654;';
		siteName.appendChild(chevron);
		siteName.appendChild(document.createTextNode(` ${site}`));

		const siteActions = el('div', 'site-actions');
		const deleteSiteBtn = el('button', 'btn-icon delete', '\uD83D\uDDD1\uFE0F');
		deleteSiteBtn.type = 'button';
		deleteSiteBtn.title = 'Delete all data for this site';
		deleteSiteBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			deleteSite(site);
		});

		siteActions.appendChild(deleteSiteBtn);
		siteHeader.appendChild(siteName);
		siteHeader.appendChild(siteActions);
		siteHeader.addEventListener('click', () => {
			siteItem.classList.toggle('expanded');
		});

		const siteFields = el('div', 'site-fields');
		Object.keys(fields).forEach(fieldName => {
			const fieldValue = fields[fieldName];
			const fieldItem = el('div', 'field-item');
			const fieldInfo = el('div', 'field-info');
			const fieldNameEl = el('span', 'field-name', formatFieldLabel(fieldName));

			const fieldValueEl = el('span', 'field-value');
			if (isSensitiveField(fieldName)) {
				fieldValueEl.textContent = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
				fieldValueEl.classList.add('masked');
			} else {
				fieldValueEl.textContent = fieldValue;
			}

			fieldInfo.appendChild(fieldNameEl);
			fieldInfo.appendChild(fieldValueEl);

			const deleteFieldBtn = el('button', 'btn-icon delete', '\uD83D\uDDD1\uFE0F');
			deleteFieldBtn.type = 'button';
			deleteFieldBtn.title = 'Delete this field';
			deleteFieldBtn.addEventListener('click', () => {
				deleteField(site, fieldName);
			});

			fieldItem.appendChild(fieldInfo);
			fieldItem.appendChild(deleteFieldBtn);
			siteFields.appendChild(fieldItem);
		});

		siteItem.appendChild(siteHeader);
		siteItem.appendChild(siteFields);
		siteDataContainer.appendChild(siteItem);
	});
}

// Delete a single extra field from profile
async function deleteExtraField(fieldName) {
	try {
		const res = await fetch(`${SERVER_BASE}/api/db/profile/extra`, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId: USER_ID, fieldName })
		});
		const { profile } = await res.json();
		currentProfile = profile;
		renderDynamicFields(profile.extra_fields || {});
		showMessage(`Deleted "${formatFieldLabel(fieldName)}"`, 'success');
	} catch (error) {
		console.error('Delete extra field error:', error);
		showMessage('Failed to delete field.');
	}
}

// Delete a single field from a site
async function deleteField(site, fieldName) {
	try {
		await fetch(`${SERVER_BASE}/api/db/site-data`, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId: USER_ID, domain: site, fieldName })
		});
		await loadSiteData();
		showMessage(`Deleted "${formatFieldLabel(fieldName)}" from ${site}`, 'success');
	} catch (error) {
		console.error('Delete field error:', error);
		showMessage('Failed to delete field.');
	}
}

// Delete all data for a site
async function deleteSite(site) {
	const confirmed = confirm(`Delete all saved data for ${site}?`);
	if (!confirmed) return;

	try {
		await fetch(`${SERVER_BASE}/api/db/site-data`, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId: USER_ID, domain: site })
		});
		await loadSiteData();
		showMessage(`Deleted all data for ${site}`, 'success');
	} catch (error) {
		console.error('Delete site error:', error);
		showMessage('Failed to delete site data.');
	}
}

// Save profile (form submit)
profileForm.addEventListener('submit', async (e) => {
	e.preventDefault();

	try {
		const formData = new FormData(profileForm);
		const profile = {};
		const extraFields = {};

		for (const [key, value] of formData.entries()) {
			if (key.startsWith('extra_')) {
				const extraKey = key.slice(6);
				if (value.trim()) extraFields[extraKey] = value.trim();
			} else if (value.trim()) {
				profile[key] = value.trim();
			}
		}

		if (Object.keys(extraFields).length > 0) {
			profile.extra_fields = extraFields;
		}

		const res = await fetch(`${SERVER_BASE}/api/db/profile`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId: USER_ID, ...profile })
		});

		if (!res.ok) throw new Error('Save failed');

		const data = await res.json();
		currentProfile = data.profile;
		showMessage('Profile saved successfully!', 'success');

		// Prompt to create passphrase after first save if none exists
		if (!passphraseExists) {
			createPassphraseSection.hidden = false;
			createPassphraseSection.scrollIntoView({ behavior: 'smooth' });
		}
	} catch (error) {
		console.error('Save error:', error);
		showMessage('Failed to save profile. Is the server running?');
	}
});

// Delete profile
deleteProfileBtn.addEventListener('click', async () => {
	const confirmed = confirm(
		'Are you sure you want to delete your profile?\n\n' +
		'This will permanently erase all your saved information and cannot be undone.'
	);
	if (!confirmed) return;

	const doubleConfirm = confirm(
		'This is your last chance to cancel.\n\n' +
		'Click OK to permanently delete your profile.'
	);
	if (!doubleConfirm) return;

	try {
		await fetch(`${SERVER_BASE}/api/db/profile?userId=${USER_ID}`, { method: 'DELETE' });

		currentProfile = {};
		passphraseExists = false;
		sessionStorage.removeItem('profileUnlocked');
		profileForm.reset();
		dynamicFieldsContainer.innerHTML = '';
		siteDataContainer.innerHTML = '<p class="empty-state">No site data saved yet.</p>';

		showMessage('Profile deleted.', 'success');
	} catch (error) {
		console.error('Delete profile error:', error);
		showMessage('Failed to delete profile.');
	}
});

// Unlock form handler
unlockForm.addEventListener('submit', async (e) => {
	e.preventDefault();
	const passphrase = document.getElementById('unlock-passphrase').value;
	try {
		const res = await fetch(`${SERVER_BASE}/api/db/passphrase/verify`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ passphrase })
		});
		const data = await res.json();
		if (data.valid) {
			sessionStorage.setItem('profileUnlocked', 'true');
			lockSection.hidden = true;
			await loadProfile();
		} else {
			showMessage('Incorrect passphrase.');
		}
	} catch (error) {
		console.error('Unlock error:', error);
		showMessage('Failed to verify passphrase.');
	}
});

// Forgot passphrase: wipe profile after double confirmation
forgotLink.addEventListener('click', async (e) => {
	e.preventDefault();
	const confirmed = confirm(
		'Forgot your passphrase?\n\n' +
		'This will permanently delete all profile data (personal info, site data) to reset access. This cannot be undone.'
	);
	if (!confirmed) return;

	const doubleConfirm = confirm(
		'This is your last chance to cancel.\n\n' +
		'Click OK to permanently delete all profile data and reset the passphrase.'
	);
	if (!doubleConfirm) return;

	try {
		await fetch(`${SERVER_BASE}/api/db/profile?userId=${USER_ID}`, { method: 'DELETE' });
		sessionStorage.removeItem('profileUnlocked');
		location.reload();
	} catch (error) {
		console.error('Reset error:', error);
		showMessage('Failed to reset profile.');
	}
});

// Create passphrase form handler
createPassphraseForm.addEventListener('submit', async (e) => {
	e.preventDefault();
	const passphrase = document.getElementById('new-passphrase').value;
	const confirmValue = document.getElementById('confirm-passphrase').value;

	if (passphrase !== confirmValue) {
		showMessage('Passphrases do not match.');
		return;
	}

	try {
		const res = await fetch(`${SERVER_BASE}/api/db/passphrase/set`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ passphrase })
		});
		if (!res.ok) throw new Error('Failed to set passphrase');
		sessionStorage.setItem('profileUnlocked', 'true');
		passphraseExists = true;
		createPassphraseSection.hidden = true;
		showMessage('Passphrase set.', 'success');
	} catch (error) {
		console.error('Set passphrase error:', error);
		showMessage('Failed to set passphrase.');
	}
});

// Skip passphrase creation
skipPassphraseBtn.addEventListener('click', () => {
	createPassphraseSection.hidden = true;
});

// Initialize on load
init();

export { isSensitiveField, SENSITIVE_FIELDS, STANDARD_FIELDS };
