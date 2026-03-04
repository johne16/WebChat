// extension/options.js

try {
	let { isTestingMode, provider, modelType, agentProvider, agentModelType } = await chrome.storage.local.get([
		'isTestingMode', 'provider', 'modelType', 'agentProvider', 'agentModelType'
	]);

	const switchBtn = document.getElementById('modeSwitch');
	const aiLabel = document.getElementById('ai-mode');
	const testingLabel = document.getElementById('testing-mode');
	const modelForm = document.getElementById('modelForm');
	const agentModelForm = document.getElementById('agentModelForm');

	function setMode(v) {
		isTestingMode = v;
		chrome.storage.local.set({ isTestingMode });
		switchBtn.setAttribute('aria-checked', v ? 'true' : 'false');
		switchBtn.classList.toggle('on', v);
		aiLabel.classList.toggle('active', !v);
		testingLabel.classList.toggle('active', v);
		switchBtn.setAttribute('aria-label', v ? 'Testing Mode' : 'AI Mode');
		document.documentElement.dataset.mode = v ? 'testing' : 'ai';
	}

	setMode(isTestingMode);

	// Pre-select the stored provider:model radio button on page load
	if (provider && modelType) {
		const composite = `${provider}:${modelType}`;
		const radio = modelForm.querySelector(`input[value="${composite}"]`);
		if (radio) radio.checked = true;
	} else if (modelType) {
		// Legacy: modelType without provider
		const radio = modelForm.querySelector(`input[value="openai:${modelType}"]`);
		if (radio) radio.checked = true;
	}

	// Pre-select the stored agent provider:model radio
	if (agentProvider && agentModelType) {
		const composite = `${agentProvider}:${agentModelType}`;
		const radio = agentModelForm.querySelector(`input[value="${composite}"]`);
		if (radio) radio.checked = true;
	} else if (agentModelType) {
		const radio = agentModelForm.querySelector(`input[value="openai:${agentModelType}"]`);
		if (radio) radio.checked = true;
	}

	switchBtn.addEventListener('click', () => {
		setMode(switchBtn.getAttribute('aria-checked') !== 'true');
	});

	switchBtn.addEventListener('keydown', (e) => {
		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			switchBtn.click();
		}
		if (e.key === 'ArrowRight') setMode(true);
		if (e.key === 'ArrowLeft') setMode(false);
	});

	modelForm.addEventListener('change', (e) => {
		// Value format: "provider:model"
		const [newProvider, ...rest] = e.target.value.split(':');
		const newModel = rest.join(':');
		provider = newProvider;
		modelType = newModel;
		chrome.storage.local.set({ provider, modelType });
	});

	agentModelForm.addEventListener('change', (e) => {
		const [newProvider, ...rest] = e.target.value.split(':');
		const newModel = rest.join(':');
		agentProvider = newProvider;
		agentModelType = newModel;
		chrome.storage.local.set({ agentProvider, agentModelType });
	});
} catch (error) {
	console.error('[Options] Initialization error:', error);
}
