/**
 * This script checks that all platform binaries are present before publishing.
 * It's used in the prepublishOnly npm script.
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Define the platforms we support
const PLATFORMS = [
    { dir: 'darwin-arm64', binary: 'libarti_ffi.dylib' },
    { dir: 'darwin-x64', binary: 'libarti_ffi.dylib' },
    { dir: 'linux-x64', binary: 'libarti_ffi.so' },
    { dir: 'linux-arm64', binary: 'libarti_ffi.so' },
    { dir: 'win32-x64', binary: 'arti_ffi.dll' }
];

// Check for all required binaries
console.log('Checking for required binaries before publishing...');
let missingBinaries = false;

for (const platform of PLATFORMS) {
    const binaryPath = join(PROJECT_ROOT, 'lib', platform.dir, platform.binary);
    if (!existsSync(binaryPath)) {
        console.error(`❌ Missing binary: ${platform.dir}/${platform.binary}`);
        missingBinaries = true;
    } else {
        console.log(`✅ Found binary: ${platform.dir}/${platform.binary}`);
    }
}

// If any binaries are missing, exit with an error
if (missingBinaries) {
    console.error('\n⚠️ Error: Missing platform binaries');
    console.error('Pre-built binaries must be present for all platforms before publishing.');
    console.error('Please run the GitHub workflow to build all binaries, or build them locally.');
    console.error('Local build: cd rust/arti-ffi && cargo build --release');
    console.error('For all platforms: Use the GitHub Action or run scripts/build-binaries.sh on each platform.');
    process.exit(1);
}

// Check that lib is included in the "files" field in package.json
try {
    const packageJson = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
    const filesField = packageJson.files || [];

    if (!filesField.includes('lib/')) {
        console.error('\n⚠️ Warning: The "files" field in package.json does not include "lib/"');
        console.error('This means the pre-built binaries will not be included in the published package.');
        console.error('Please add "lib/" to the "files" field in package.json.');
        process.exit(1);
    }
} catch (error) {
    console.error('Error reading package.json:', error.message);
    process.exit(1);
}

console.log('\n✅ All checks passed. Ready to publish!'); 