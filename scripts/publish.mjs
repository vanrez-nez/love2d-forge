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
import { readFileSync, appendFileSync } from 'fs';
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

const results = {
    marketplace: { status: 'Skipped', message: 'Not targeted' },
    ovsx: { status: 'Skipped', message: 'Not targeted' }
};

async function checkMarketplace() {
    console.log(`🔍 Checking VS Marketplace for ${extensionId}@${version}...`);
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
    console.log(`🔍 Checking Open VSX for ${extensionId}@${version}...`);
    try {
        const output = execSync(`npx ovsx get ${extensionId} --metadata`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        const data = JSON.parse(output);
        const exists = data.allVersions?.[version] !== undefined || data.version === version;
        return exists;
    } catch (e) {
        return false;
    }
}

function writeGithubSummary(text) {
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile) {
        try {
            appendFileSync(summaryFile, text + '\n');
        } catch (err) {
            console.error('Failed to write to GITHUB_STEP_SUMMARY:', err.message);
        }
    }
}

async function run() {
    const checkMS = (target === 'all' || target === 'marketplace');
    const checkVSX = (target === 'all' || target === 'ovsx');

    if (checkMS) {
        const exists = await checkMarketplace();
        if (exists) {
            console.log(`✅ Version ${version} already exists on VS Marketplace.`);
            results.marketplace = { status: 'Skipped', message: 'Already published' };
        } else {
            console.log(`🚀 Publishing to VS Marketplace...`);
            try {
                const cmd = `npx vsce publish ${pat ? `-p ${pat}` : ''}`;
                execSync(cmd, { stdio: 'inherit' });
                results.marketplace = { status: 'Success', message: `Published version ${version}` };
            } catch (err) {
                results.marketplace = { status: 'Failed', message: err.message };
                throw err;
            }
        }
    }

    if (checkVSX) {
        const exists = await checkOVSX();
        if (exists) {
            console.log(`✅ Version ${version} already exists on Open VSX.`);
            results.ovsx = { status: 'Skipped', message: 'Already published' };
        } else {
            console.log(`🚀 Publishing to Open VSX...`);
            try {
                const cmd = `npx ovsx publish ${token ? `--pat ${token}` : ''}`;
                execSync(cmd, { stdio: 'inherit' });
                results.ovsx = { status: 'Success', message: `Published version ${version}` };
            } catch (err) {
                results.ovsx = { status: 'Failed', message: err.message };
                throw err;
            }
        }
    }

    console.log('\n--- Publishing Summary ---');
    console.table(results);

    const summaryMd = `### 📦 Release Summary (${version})
| Registry | Status | Details |
| :--- | :--- | :--- |
| VS Marketplace | ${results.marketplace.status === 'Success' ? '✅' : (results.marketplace.status === 'Skipped' ? '⚪' : '❌')} ${results.marketplace.status} | ${results.marketplace.message} |
| Open VSX | ${results.ovsx.status === 'Success' ? '✅' : (results.ovsx.status === 'Skipped' ? '⚪' : '❌')} ${results.ovsx.status} | ${results.ovsx.message} |
`;
    writeGithubSummary(summaryMd);

    if (results.marketplace.status === 'Skipped' && results.ovsx.status === 'Skipped') {
        process.stdout.write('✨ Everything is already in sync.\n');
    }
}

run().catch(err => {
    console.error('\n❌ Publish failed during execution.');
    console.table(results);
    process.exit(1);
});
