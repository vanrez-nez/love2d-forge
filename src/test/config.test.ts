import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { normalizeLocations, readProjectConfig } from '../projectConfig';
import { normalizeConfiguredLocation } from '../locationResolver';

suite('Project Config', () => {
    test('normalizeLocations accepts string and array values', () => {
        assert.strictEqual(normalizeLocations(' apps/game '), 'apps/game');
        assert.deepStrictEqual(
            normalizeLocations(['apps/game', ' tools/editor/main.lua ', 42, '']),
            ['apps/game', 'tools/editor/main.lua']
        );
        assert.strictEqual(normalizeLocations([]), undefined);
        assert.strictEqual(normalizeLocations({}), undefined);
    });

    test('readProjectConfig normalizes locations field', async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'love2d-forge-config-'));
        const configDir = path.join(workspaceRoot, '.love2d-forge');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
            autoDiscovery: false,
            autoDiscoverySearchDepth: 4,
            locations: ['apps/game', ' tools/editor/main.lua ', '', false]
        }), 'utf8');

        const config = await readProjectConfig(workspaceRoot);
        assert.strictEqual(config.autoDiscovery, false);
        assert.strictEqual(config.autoDiscoverySearchDepth, 4);
        assert.deepStrictEqual(config.locations, ['apps/game', 'tools/editor/main.lua']);
    });
});

suite('Location Resolution', () => {
    test('normalizeConfiguredLocation appends main.lua for directories', () => {
        assert.strictEqual(normalizeConfiguredLocation('apps/game'), 'apps/game/main.lua');
        assert.strictEqual(normalizeConfiguredLocation('apps/game/main.lua'), 'apps/game/main.lua');
        assert.strictEqual(normalizeConfiguredLocation('main.lua'), 'main.lua');
    });
});
