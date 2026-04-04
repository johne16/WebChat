// native_host/setup.js
// One-time setup: generates host manifest and registers in Windows registry
// Usage: node native_host/setup.js --id=<extension-id>
//        node native_host/setup.js --uninstall

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const HOST_NAME = 'com.webchat.service_manager';
const MANIFEST_FILE = path.join(__dirname, `${HOST_NAME}.json`);
const BAT_PATH = path.join(__dirname, 'service_manager.bat');

// Registry paths for Chrome and Brave
const REG_PATHS = [
	`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
	`HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${HOST_NAME}`
];

// Parse CLI args
const args = process.argv.slice(2);
const uninstall = args.includes('--uninstall');
const idArg = args.find(a => a.startsWith('--id='));
const extensionId = idArg ? idArg.substring('--id='.length) : null;

if (uninstall) {
	doUninstall();
} else {
	if (!extensionId) {
		console.error('Usage: node setup.js --id=<extension-id>');
		console.error('       node setup.js --uninstall');
		process.exit(1);
	}
	doInstall(extensionId);
}

function doInstall(extId) {
	// Write manifest
	const manifest = {
		name: HOST_NAME,
		description: 'WebChat Service Manager',
		path: BAT_PATH,
		type: 'stdio',
		allowed_origins: [`chrome-extension://${extId}/`]
	};

	fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, '\t'));
	console.log(`Wrote manifest: ${MANIFEST_FILE}`);

	// Register in Windows registry
	for (const regPath of REG_PATHS) {
		try {
			execFileSync('reg', ['add', regPath, '/ve', '/t', 'REG_SZ', '/d', MANIFEST_FILE, '/f'], { stdio: 'pipe' });
			console.log(`Registered: ${regPath}`);
		} catch (e) {
			console.error(`Failed to register ${regPath}: ${e.message}`);
		}
	}

	console.log('\nSetup complete. Reload the extension to activate native messaging.');
}

function doUninstall() {
	// Remove registry keys
	for (const regPath of REG_PATHS) {
		try {
			execFileSync('reg', ['delete', regPath, '/f'], { stdio: 'pipe' });
			console.log(`Removed: ${regPath}`);
		} catch (e) {
			console.log(`Not found or failed: ${regPath}`);
		}
	}

	// Remove manifest file
	if (fs.existsSync(MANIFEST_FILE)) {
		fs.unlinkSync(MANIFEST_FILE);
		console.log(`Deleted: ${MANIFEST_FILE}`);
	}

	console.log('\nUninstall complete.');
}
