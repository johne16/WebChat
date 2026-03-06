// extension/profile.js
// Profile management page logic

import { encryptProfile, decryptProfile } from './crypto.js';
import { formatFieldLabel } from './ui.js';
import { getConfig, loadConfig } from './config.js';

// Load config from server (profile.html is a standalone page)
await loadConfig();

const MIN_PASSPHRASE_LENGTH = getConfig()?.extension?.profile?.minPassphraseLength || 4;

// DOM elements
const statusEl = document.getElementById('status');
const messageEl = document.getElementById('message');
const unlockSection = document.getElementById('unlock-section');
const createSection = document.getElementById('create-section');
const profileSection = document.getElementById('profile-section');
const siteDataSection = document.getElementById('site-data-section');
const siteDataContainer = document.getElementById('site-data-container');
const passphraseSection = document.getElementById('passphrase-section');
const dangerSection = document.getElementById('danger-section');
const unlockForm = document.getElementById('unlock-form');
const createForm = document.getElementById('create-form');
const profileForm = document.getElementById('profile-form');
const changePassphraseForm = document.getElementById('change-passphrase-form');
const passphraseInput = document.getElementById('passphrase');
const createPassphraseInput = document.getElementById('create-passphrase');
const confirmPassphraseInput = document.getElementById('confirm-passphrase');
const lockBtn = document.getElementById('lock-btn');
const deleteProfileBtn = document.getElementById('delete-profile-btn');
const dynamicFieldsContainer = document.getElementById('dynamic-fields');

// State
let currentPassphrase = null;
let currentProfile = null; // Keep track of full profile including siteData

// Profile field names (standard fields)
const STANDARD_FIELDS = [
	'firstName', 'lastName', 'email', 'phone',
	'address', 'city', 'state', 'zip', 'country', 'birthDate'
];

// Fields to mask in the site data display
const SENSITIVE_FIELDS = ['password', 'secret', 'token', 'key', 'pin', 'cvv', 'ssn'];

// Validate passphrase for create/change flows
function validatePassphrase(passphrase, confirmPassphrase) {
	if (!passphrase) {
		return { valid: false, error: 'Please enter a passphrase' };
	}
	if (passphrase !== confirmPassphrase) {
		return { valid: false, error: 'Passphrases do not match' };
	}
	if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
		return { valid: false, error: `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters` };
	}
	return { valid: true, error: null };
}

// Initialize
async function init() {
	const { encryptedUserProfile } = await chrome.storage.local.get('encryptedUserProfile');

	if (encryptedUserProfile) {
		// Existing profile - show unlock form
		unlockSection.hidden = false;
		createSection.hidden = true;
	} else {
		// No profile - show create form
		unlockSection.hidden = true;
		createSection.hidden = false;
	}
}

// Show message
function showMessage(text, type = 'error') {
	messageEl.textContent = text;
	messageEl.className = `message ${type}`;
	setTimeout(() => {
		messageEl.className = 'message hidden';
	}, 5000);
}

// Create new profile
createForm.addEventListener('submit', async (e) => {
	e.preventDefault();

	const passphrase = createPassphraseInput.value;
	const confirmPassphrase = confirmPassphraseInput.value;

	const result = validatePassphrase(passphrase, confirmPassphrase);
	if (!result.valid) {
		showMessage(result.error);
		return;
	}

	currentPassphrase = passphrase;
	unlockSuccess({});
	showMessage('Profile created. Fill in your information and save.', 'success');
});

// Unlock existing profile
unlockForm.addEventListener('submit', async (e) => {
	e.preventDefault();
	const passphrase = passphraseInput.value;

	if (!passphrase) {
		showMessage('Please enter a passphrase');
		return;
	}

	try {
		const { encryptedUserProfile } = await chrome.storage.local.get('encryptedUserProfile');
		const profile = await decryptProfile(encryptedUserProfile, passphrase);
		currentPassphrase = passphrase;
		unlockSuccess(profile);
	} catch (error) {
		console.error('Unlock error:', error);
		showMessage('Incorrect passphrase. Please try again.');
	}
});

// Handle successful unlock
function unlockSuccess(profile) {
	currentProfile = profile;

	// Update UI state
	statusEl.textContent = 'Unlocked';
	statusEl.className = 'status unlocked';
	unlockSection.hidden = true;
	createSection.hidden = true;
	profileSection.hidden = false;
	siteDataSection.hidden = false;
	passphraseSection.hidden = false;
	dangerSection.hidden = false;

	// Populate standard fields
	STANDARD_FIELDS.forEach(field => {
		const input = document.getElementById(field);
		if (input && profile[field]) {
			input.value = profile[field];
		}
	});

	// Populate dynamic fields (excluding siteData)
	renderDynamicFields(profile);

	// Render site-specific data
	renderSiteData(profile.siteData || {});
}

// Render dynamic fields (fields not in STANDARD_FIELDS, excluding siteData)
function renderDynamicFields(profile) {
	dynamicFieldsContainer.innerHTML = '';

	const dynamicKeys = Object.keys(profile).filter(
		key => !STANDARD_FIELDS.includes(key) && key !== 'siteData'
	);

	if (dynamicKeys.length === 0) return;

	const header = document.createElement('h3');
	header.textContent = 'Additional Fields';
	header.style.marginTop = '16px';
	header.style.marginBottom = '8px';
	header.style.fontSize = '14px';
	dynamicFieldsContainer.appendChild(header);

	dynamicKeys.forEach(key => {
		const row = document.createElement('div');
		row.className = 'form-row';

		const label = document.createElement('label');
		label.htmlFor = `dynamic-${key}`;
		label.textContent = formatFieldLabel(key);

		const input = document.createElement('input');
		input.type = 'text';
		input.id = `dynamic-${key}`;
		input.name = key;
		input.value = profile[key] || '';

		row.appendChild(label);
		row.appendChild(input);
		dynamicFieldsContainer.appendChild(row);
	});
}

// Small DOM helper to reduce createElement boilerplate
function el(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text != null) node.textContent = text;
	return node;
}

// Check if a field name is sensitive
function isSensitiveField(fieldName) {
	const lower = fieldName.toLowerCase();
	return SENSITIVE_FIELDS.some(s => lower.includes(s));
}

// Render site-specific data
function renderSiteData(siteData) {
	siteDataContainer.innerHTML = '';

	const sites = Object.keys(siteData);
	if (sites.length === 0) {
		siteDataContainer.innerHTML = '<p class="empty-state">No site data saved yet.</p>';
		return;
	}

	sites.forEach(site => {
		const fields = siteData[site];
		const siteItem = el('div', 'site-item');

		// Site header (clickable to expand)
		const siteHeader = el('div', 'site-header');

		const siteName = el('span', 'site-name');
		siteName.innerHTML = `<span class="chevron">▶</span> ${site}`;

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

		// Toggle expand on header click
		siteHeader.addEventListener('click', () => {
			siteItem.classList.toggle('expanded');
		});

		// Site fields container
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

			const deleteFieldBtn = el('button', 'btn-icon delete', '\u2715');
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

// Delete a single field from a site
async function deleteField(site, fieldName) {
	if (!currentProfile.siteData || !currentProfile.siteData[site]) return;

	delete currentProfile.siteData[site][fieldName];

	// If no more fields for this site, remove the site entirely
	if (Object.keys(currentProfile.siteData[site]).length === 0) {
		delete currentProfile.siteData[site];
	}

	// Save and re-render
	await saveProfile();
	renderSiteData(currentProfile.siteData || {});
	showMessage(`Deleted "${formatFieldLabel(fieldName)}" from ${site}`, 'success');
}

// Delete all data for a site
async function deleteSite(site) {
	const confirmed = confirm(`Delete all saved data for ${site}?`);
	if (!confirmed) return;

	if (!currentProfile.siteData) return;

	delete currentProfile.siteData[site];

	// Save and re-render
	await saveProfile();
	renderSiteData(currentProfile.siteData || {});
	showMessage(`Deleted all data for ${site}`, 'success');
}

// Helper to save the current profile
async function saveProfile() {
	if (!currentPassphrase) return;

	// Collect form data for standard/dynamic fields
	const formData = new FormData(profileForm);
	const profile = {};

	for (const [key, value] of formData.entries()) {
		if (value.trim()) {
			profile[key] = value.trim();
		}
	}

	// Preserve siteData
	if (currentProfile.siteData && Object.keys(currentProfile.siteData).length > 0) {
		profile.siteData = currentProfile.siteData;
	}

	currentProfile = profile;

	const encrypted = await encryptProfile(profile, currentPassphrase);
	await chrome.storage.local.set({ encryptedUserProfile: encrypted });
}

// Save profile (form submit)
profileForm.addEventListener('submit', async (e) => {
	e.preventDefault();

	if (!currentPassphrase) {
		showMessage('Profile is locked. Please unlock first.');
		return;
	}

	try {
		await saveProfile();
		showMessage('Profile saved successfully!', 'success');
	} catch (error) {
		console.error('Save error:', error);
		showMessage('Failed to save profile. Please try again.');
	}
});

// Lock profile
lockBtn.addEventListener('click', () => {
	currentPassphrase = null;
	currentProfile = null;

	// Clear forms
	profileForm.reset();
	changePassphraseForm.reset();
	dynamicFieldsContainer.innerHTML = '';
	siteDataContainer.innerHTML = '<p class="empty-state">No site data saved yet.</p>';

	// Update UI
	statusEl.textContent = 'Locked';
	statusEl.className = 'status locked';
	unlockSection.hidden = false;
	createSection.hidden = true;
	profileSection.hidden = true;
	siteDataSection.hidden = true;
	passphraseSection.hidden = true;
	dangerSection.hidden = true;
	passphraseInput.value = '';

	showMessage('Profile locked.', 'success');
});

// Change passphrase
changePassphraseForm.addEventListener('submit', async (e) => {
	e.preventDefault();

	const oldPassphrase = document.getElementById('oldPassphrase').value;
	const newPassphrase = document.getElementById('newPassphrase').value;
	const confirmPassphrase = document.getElementById('confirmPassphrase').value;

	if (!oldPassphrase) {
		showMessage('Please fill in all passphrase fields.');
		return;
	}

	const result = validatePassphrase(newPassphrase, confirmPassphrase);
	if (!result.valid) {
		showMessage(result.error);
		return;
	}

	// Verify old passphrase by attempting to decrypt
	try {
		const { encryptedUserProfile } = await chrome.storage.local.get('encryptedUserProfile');

		if (encryptedUserProfile) {
			await decryptProfile(encryptedUserProfile, oldPassphrase);
		} else if (oldPassphrase !== currentPassphrase) {
			throw new Error('Incorrect passphrase');
		}
	} catch (error) {
		console.error('Old passphrase verification failed:', error);
		showMessage('Current passphrase is incorrect.');
		return;
	}

	try {
		// Re-encrypt with new passphrase (preserving siteData)
		await saveProfile(); // Ensure currentProfile is up to date
		const encrypted = await encryptProfile(currentProfile, newPassphrase);
		await chrome.storage.local.set({ encryptedUserProfile: encrypted });

		currentPassphrase = newPassphrase;
		changePassphraseForm.reset();

		showMessage('Passphrase changed successfully!', 'success');
	} catch (error) {
		console.error('Change passphrase error:', error);
		showMessage('Failed to change passphrase.');
	}
});

// Delete profile
deleteProfileBtn.addEventListener('click', async () => {
	const confirmed = confirm(
		'Are you sure you want to delete your profile?\n\n' +
		'This will permanently erase all your saved information and cannot be undone.'
	);

	if (!confirmed) return;

	// Double confirmation
	const doubleConfirm = confirm(
		'This is your last chance to cancel.\n\n' +
		'Click OK to permanently delete your profile.'
	);

	if (!doubleConfirm) return;

	try {
		await chrome.storage.local.remove('encryptedUserProfile');
		currentPassphrase = null;
		currentProfile = null;

		// Clear and reset UI
		profileForm.reset();
		changePassphraseForm.reset();
		dynamicFieldsContainer.innerHTML = '';
		siteDataContainer.innerHTML = '<p class="empty-state">No site data saved yet.</p>';

		statusEl.textContent = 'Locked';
		statusEl.className = 'status locked';
		unlockSection.hidden = true;
		createSection.hidden = false;
		profileSection.hidden = true;
		siteDataSection.hidden = true;
		passphraseSection.hidden = true;
		dangerSection.hidden = true;

		// Clear create form
		createPassphraseInput.value = '';
		confirmPassphraseInput.value = '';

		showMessage('Profile deleted.', 'success');
	} catch (error) {
		console.error('Delete profile error:', error);
		showMessage('Failed to delete profile.');
	}
});

// Initialize on load
init();

export { isSensitiveField, validatePassphrase, SENSITIVE_FIELDS, STANDARD_FIELDS };
