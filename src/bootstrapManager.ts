import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';
import { getBootstrapDir, getBridgePortFile } from './runtimePaths';

export class BootstrapManager {
    private bootstrapDir: string;
    private bridgePortFile: string;

    constructor(private workspaceRoot: string, private extensionPath: string, private logger: Logger) {
        this.bootstrapDir = getBootstrapDir(workspaceRoot);
        this.bridgePortFile = getBridgePortFile(workspaceRoot);
    }

    public prepare(hotPollIntervalMs: number): string {
        this.logger.log(`bootstrap prepare start: dir="${this.bootstrapDir}" hotPollIntervalMs=${hotPollIntervalMs}`);
        fs.mkdirSync(this.bootstrapDir, { recursive: true });

        const projectPath = this.workspaceRoot.replace(/\\/g, '/');
        const assetsDir = path.join(this.extensionPath, 'assets');
        const hotPollIntervalSeconds = Math.max(hotPollIntervalMs, 1) / 1000;

        // Our bootstrap files
        const confTemplate = fs.readFileSync(path.join(assetsDir, 'bootstrap-conf.lua'), 'utf8');
        fs.writeFileSync(
            path.join(this.bootstrapDir, 'conf.lua'),
            confTemplate.replace('__PROJECT_PATH__', projectPath)
        );

        const mainTemplate = fs.readFileSync(path.join(assetsDir, 'bootstrap-main.lua'), 'utf8');
        fs.writeFileSync(
            path.join(this.bootstrapDir, 'main.lua'),
            mainTemplate
                .replace('__PROJECT_PATH__', projectPath)
                .replace('__BRIDGE_PORT_FILE__', this.bridgePortFile.replace(/\\/g, '/'))
                .replace('__HOT_POLL_INTERVAL_SECONDS__', hotPollIntervalSeconds.toFixed(3))
        );

        fs.copyFileSync(
            path.join(assetsDir, 'hot.lua'),
            path.join(this.bootstrapDir, '__hot__.lua')
        );

        // Mirror the user's project into the bootstrap dir as symlinks.
        // PhysFS scans the game source dir — symlinks appear as real files/dirs.
        // main.lua is renamed __user_main.lua to avoid conflicting with our bootstrap.
        // conf.lua is skipped — our conf.lua proxies it already.
        const reserved = new Set(['main.lua', 'conf.lua', '__hot__.lua']);

        for (const item of fs.readdirSync(this.workspaceRoot)) {
            const src = path.join(this.workspaceRoot, item);
            const linkName = item === 'main.lua' ? '__user_main.lua' : item;
            const dest = path.join(this.bootstrapDir, linkName);

            if (item === 'conf.lua') {
                continue; // handled by our conf.lua proxy
            }
            if (reserved.has(linkName)) {
                continue; // don't overwrite our own bootstrap files
            }

            this.link(src, dest);
        }

        this.logger.log(`bootstrap prepare complete: dir="${this.bootstrapDir}"`);
        return this.bootstrapDir;
    }

    private link(target: string, dest: string): void {
        try { fs.unlinkSync(dest); } catch {}
        try {
            const stat = fs.lstatSync(target);
            // junctions work without admin rights on Windows; ignored on macOS/Linux
            fs.symlinkSync(target, dest, stat.isDirectory() ? 'junction' : 'file');
        } catch {
            this.logger.log(`bootstrap link skipped: target="${target}" dest="${dest}"`);
        }
    }
}
