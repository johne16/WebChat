// extension/options.js
// ============================================================================
// TODO_CLEANUP: Added ReAct mode toggle handling
// ============================================================================
let {isTestingMode, modelType, useReActMode} = await chrome.storage.local.get(['isTestingMode', 'modelType', 'useReActMode']);

// Default to true if not set
if (useReActMode === undefined) {
	useReActMode = true;
	chrome.storage.local.set({useReActMode});
}

const switchBtn = document.getElementById('modeSwitch');
const aiLabel = document.getElementById('ai-mode');
const testingLabel = document.getElementById('testing-mode');
const modelForm = document.getElementById('modelForm');

// ============================================================================
// TODO_CLEANUP: ReAct switch element
// ============================================================================
const reactSwitch = document.getElementById('reactSwitch');
const simpleModeLabel = document.getElementById('simple-mode');
const reactModeLabel = document.getElementById('research-mode-label');

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

// ============================================================================
// TODO_CLEANUP: ReAct mode toggle function
// ============================================================================
function setReActMode(v) {
	useReActMode = v;
	chrome.storage.local.set({useReActMode});
	reactSwitch.setAttribute('aria-checked', v ? 'true' : 'false');
	reactSwitch.classList.toggle('on', v);
	simpleModeLabel.classList.toggle('active', !v);
	reactModeLabel.classList.toggle('active', v);
	reactSwitch.setAttribute('aria-label', v ? 'ReAct Mode' : 'Simple Mode');
}

setMode(isTestingMode);
setReActMode(useReActMode);

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

// ============================================================================
// TODO_CLEANUP: ReAct switch event listeners
// ============================================================================
reactSwitch.addEventListener('click', () => {
	setReActMode(reactSwitch.getAttribute('aria-checked') !== 'true');
});

reactSwitch.addEventListener('keydown', (e) => {
	if (e.key === ' ' || e.key === 'Enter') {
		e.preventDefault();
		reactSwitch.click();
	}
	if (e.key === 'ArrowRight') setReActMode(true);
	if (e.key === 'ArrowLeft') setReActMode(false);
});

modelForm.addEventListener('change', (e) => {
	modelType = e.target.value;
	chrome.storage.local.set({modelType});
});

