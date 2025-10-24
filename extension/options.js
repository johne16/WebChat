// extension/options.js
let {isTestingMode, modelType} = await chrome.storage.local.get(['isTestingMode', 'modelType']);

const switchBtn = document.getElementById('modeSwitch');
const aiLabel = document.getElementById('ai-mode');
const testingLabel = document.getElementById('testing-mode');
const modelForm = document.getElementById('modelForm');

function setMode(v) {
	isTestingMode = v;
	chrome.storage.local.set({isTestingMode});
	switchBtn.setAttribute('aria-checked', v ? 'true' : 'false');
	switchBtn.classList.toggle('on', v);
	aiLabel.classList.toggle('active', !v);
	testingLabel.classList.toggle('active', v);
	switchBtn.setAttribute('aria-label', v ? 'Testing Mode' : 'AI Mode');
	document.documentElement.dataset.mode = v ? 'testing' : 'ai';
}

setMode(isTestingMode);

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
	modelType = e.target.value;
	chrome.storage.local.set({modelType});
});

