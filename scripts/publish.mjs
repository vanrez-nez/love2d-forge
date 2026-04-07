/**
 * Marketplace Publish & Sync Script
 * ---------------------------------
 * This script ensures the current extension version is synchronized across
 * the Microsoft Visual Studio Marketplace and the Open VSX Registry.
 *
 * It validates if the version in package.json is already live on each registry
 * before attempting to publish, preventing unnecessary failures in CI and
 * allowing for effortless "back-filling" of missing versions.
 *
 * Usage:
 *   node scripts/publish.mjs --target=all --pat=... --token=...
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
const { name, publisher, version } = packageJson;
const extensionId = `${publisher}.${name}`;

const args = process.argv.slice(2);
function getArg(name) {
    const idx = args.findIndex(arg => arg.startsWith(`--${name}`));
    if (idx === -1) return undefined;
    const arg = args[idx];
    if (arg.includes('=')) return arg.split('=')[1];
    return args[idx + 1];
}

const target = getArg('target') || 'all';
const pat = getArg('pat') || process.env.VSCE_PAT;
const token = getArg('token') || process.env.OVSX_TOKEN;

async function checkMarketplace() {
    console.log(`Checking VS Marketplace for ${extensionId}@${version}...`);
    try {
        const output = execSync(`npx vsce show ${extensionId} --json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        const data = JSON.parse(output);
        const exists = data.versions.some(v => v.version === version);
        return exists;
    } catch (e) {
        return false;
    }
}

async function checkOVSX() {
    console.log(`Checking Open VSX for ${extensionId}@${version}...`);
    try {
        // ovsx get --metadata returns JSON or errors out if not found
        const output = execSync(`npx ovsx get ${extensionId} --metadata`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        // Since ovsx show --json didn't work previously, we check if version is in the output
        // The output of 'ovsx get --metadata' contains the full metadata JSON
        const data = JSON.parse(output);
        // data.allVersions is usually an array of objects
        const exists = data.allVersions?.[version] !== undefined || data.version === version;
        return exists;
    } catch (e) {
        return false;
    }
}

async function run() {
    const checkMS = (target === 'all' || target === 'marketplace');
    const checkVSX = (target === 'all' || target === 'ovsx');

    let needsMS = false;
    let needsVSX = false;

    if (checkMS) {
        const existsMS = await checkMarketplace();
        if (existsMS) {
            console.log(`✅ Version ${version} already exists on VS Marketplace. Skipping.`);
        } else {
            console.log(`⚠️ Version ${version} is missing on VS Marketplace.`);
            needsMS = true;
        }
    }

    if (checkVSX) {
        const existsVSX = await checkOVSX();
        if (existsVSX) {
            console.log(`✅ Version ${version} already exists on Open VSX. Skipping.`);
        } else {
            console.log(`⚠️ Version ${version} is missing on Open VSX.`);
            needsVSX = true;
        }
    }

    if (needsMS) {
        console.log(`Publishing to VS Marketplace...`);
        const cmd = `npx vsce publish ${pat ? `-p ${pat}` : ''}`;
        execSync(cmd, { stdio: 'inherit' });
    }

    if (needsVSX) {
        console.log(`Publishing to Open VSX...`);
        const cmd = `npx ovsx publish ${token ? `--token ${token}` : ''}`;
        execSync(cmd, { stdio: 'inherit' });
    }

    if (!needsMS && !needsVSX) {
        console.log('✨ Everything is in sync. No publishing required.');
    }
}

run().catch(err => {
    console.error('❌ Publish failed:', err.message);
    process.exit(1);
});
