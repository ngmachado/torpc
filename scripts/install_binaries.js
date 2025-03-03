/**
 * Script to download and install pre-built Arti binaries
 * This runs during npm/bun install
 */

import { platform, arch } from 'os';
import { join, dirname } from 'path';
import { createWriteStream, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import https from 'https';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Constants
 */
const GITHUB_REPO = 'ngmachado/torpc';
const BINARY_VERSION = 'latest';
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Determine the platform-specific directory name and binary name
 */
function getPlatformInfo() {
    const plat = platform();
    const architecture = arch();

    let platformDir;
    let binaryName;
    let extension;
    let prefix = 'lib';

    if (plat === 'darwin') {
        platformDir = architecture === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
        extension = '.dylib';
    } else if (plat === 'linux') {
        platformDir = architecture === 'arm64' || architecture === 'aarch64'
            ? 'linux-arm64'
            : 'linux-x64';
        extension = '.so';
    } else if (plat === 'win32') {
        platformDir = 'win32-x64';
        extension = '.dll';
        prefix = ''; // No 'lib' prefix on Windows
    } else {
        throw new Error(`Unsupported platform: ${plat}-${architecture}`);
    }

    binaryName = `${prefix}arti_ffi${extension}`;

    return { platformDir, binaryName };
}

/**
 * Ensure the lib directory exists
 */
function ensureLibDir(platformDir) {
    const libDir = join(PROJECT_ROOT, 'lib', platformDir);

    if (!existsSync(join(PROJECT_ROOT, 'lib'))) {
        mkdirSync(join(PROJECT_ROOT, 'lib'));
    }

    if (!existsSync(libDir)) {
        mkdirSync(libDir, { recursive: true });
    }

    return libDir;
}

/**
 * Get the URL for the binary release
 */
async function getBinaryUrl(version, platformDir, binaryName) {
    let releaseTag = version;

    if (version === 'latest') {
        // Get the latest release tag
        console.log('Fetching latest release info...');
        try {
            const data = await new Promise((resolve, reject) => {
                const request = https.get(
                    `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
                    {
                        headers: { 'User-Agent': 'torpc-install-script' }
                    },
                    (response) => {
                        if (response.statusCode !== 200) {
                            reject(new Error(`Failed to fetch release info: ${response.statusCode}`));
                            return;
                        }

                        let data = '';
                        response.on('data', (chunk) => data += chunk);
                        response.on('end', () => resolve(data));
                    }
                );

                request.on('error', reject);
                request.end();
            });

            const releaseInfo = JSON.parse(data);
            releaseTag = releaseInfo.tag_name;
            console.log(`Latest release: ${releaseTag}`);
        } catch (err) {
            console.error('Error fetching latest release:', err.message);
            throw err;
        }
    }

    // Construct the URL for the binary asset
    // GitHub release asset URLs typically follow this pattern:
    return `https://github.com/${GITHUB_REPO}/releases/download/${releaseTag}/arti-ffi-${platformDir}.zip`;
}

/**
 * Download and extract the binary
 */
async function downloadBinary(url, destDir, binaryName) {
    const tempZipPath = join(destDir, 'temp.zip');

    console.log(`Downloading from ${url}...`);

    // Download the zip file
    await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(tempZipPath);

        const request = https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download binary: ${response.statusCode}`));
                return;
            }

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                resolve();
            });
        });

        request.on('error', (err) => {
            fs.unlink(tempZipPath, () => { });
            reject(err);
        });

        file.on('error', (err) => {
            fs.unlink(tempZipPath, () => { });
            reject(err);
        });

        request.end();
    });

    console.log('Download complete. Extracting...');

    // Extract the zip file
    try {
        if (platform() === 'win32') {
            // On Windows, use PowerShell to extract
            execSync(`powershell -command "Expand-Archive -Path '${tempZipPath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'inherit' });
        } else {
            // On Unix-like systems, use unzip
            execSync(`unzip -o "${tempZipPath}" -d "${destDir}"`, { stdio: 'inherit' });
        }

        // Delete the zip file
        fs.unlinkSync(tempZipPath);

        // Verify the binary exists
        const binaryPath = join(destDir, binaryName);
        if (!existsSync(binaryPath)) {
            throw new Error(`Binary not found after extraction: ${binaryPath}`);
        }

        console.log(`Binary extracted to: ${binaryPath}`);
    } catch (err) {
        console.error('Error extracting binary:', err.message);
        throw err;
    }
}

/**
 * Main function
 */
async function main() {
    try {
        // Get platform-specific information
        const { platformDir, binaryName } = getPlatformInfo();
        console.log(`Detected platform: ${platformDir}`);

        // Create lib directory if it doesn't exist
        const libDir = ensureLibDir(platformDir);

        // Check if binary already exists
        const binaryPath = join(libDir, binaryName);
        if (existsSync(binaryPath)) {
            console.log(`Binary already exists at: ${binaryPath}`);
            console.log('To force re-download, delete the existing binary first.');
            return;
        }

        // Try to find a locally built binary
        const localBinaryPath = join(PROJECT_ROOT, 'rust', 'arti-ffi', 'target', 'release', binaryName);
        if (existsSync(localBinaryPath)) {
            console.log(`Found locally built binary at: ${localBinaryPath}`);
            console.log(`Copying to ${binaryPath}...`);
            fs.copyFileSync(localBinaryPath, binaryPath);
            console.log('Local binary copied successfully.');
            return;
        }

        // Try downloading from GitHub releases
        try {
            // Get binary URL
            const url = await getBinaryUrl(BINARY_VERSION, platformDir, binaryName);

            // Download and extract binary
            await downloadBinary(url, libDir, binaryName);

            console.log('Binary installation completed successfully.');
        } catch (githubErr) {
            console.error('Error downloading from GitHub:', githubErr.message);

            // GitHub download failed
            console.error('\n⚠️  Could not download pre-built binary. ⚠️');
            console.error('\nPlease try one of the following options:');
            console.error('1. Check your internet connection and try again');
            console.error('2. Download the binary manually from the GitHub releases page:');
            console.error(`   https://github.com/${GITHUB_REPO}/releases`);
            console.error('3. If you have Rust installed, build from source:');
            console.error('   make dev-build');
            console.error('\nIf you\'re a user (not a developer), please report this issue:');
            console.error(`https://github.com/${GITHUB_REPO}/issues/new`);

            process.exit(1);
        }
    } catch (err) {
        console.error('Error installing binary:', err.message);
        process.exit(1);
    }
}

// Run the script
main(); 