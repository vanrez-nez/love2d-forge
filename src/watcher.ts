import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import ignore, { Ignore } from 'ignore';
import { Logger } from './logger';
import { ReloadEvent, ReloadEventType } from './reloadPolicy';

export interface WatcherOptions {
    workspaceRoot: string;
    appRoot: string;
    watchScope: 'location' | 'project';
    watchExclude?: string[];
    logger: Logger;
    onReload: (event: ReloadEvent) => void;
}

const DEFAULT_SAFE_EXTENSIONS = new Set([
    '.lua', '.glsl', '.frag', '.vert',
    '.png', '.jpg', '.jpeg', '.aseprite',
    '.json', '.toml', '.yaml', '.txt',
    '.mp3', '.wav', '.ogg'
]);

export class FileWatcher {
    private watcher: vscode.FileSystemWatcher;
    private gitignore: Ignore | null = null;
    private timer: NodeJS.Timeout | null = null;
    private pendingEvent: ReloadEvent | null = null;

    constructor(private readonly options: WatcherOptions) {
        const { workspaceRoot, appRoot, watchScope } = options;
        
        // Load .gitignore if present
        this.loadGitignore();

        const pattern = watchScope === 'project' 
            ? new vscode.RelativePattern(workspaceRoot, '**/*')
            : new vscode.RelativePattern(path.join(workspaceRoot, appRoot), '**/*');

        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.watcher.onDidChange((uri) => this.schedule('change', uri));
        this.watcher.onDidCreate((uri) => this.schedule('create', uri));
        this.watcher.onDidDelete((uri) => this.schedule('delete', uri));
        
        options.logger.debug(`FileWatcher initialized: scope=${watchScope} base=${pattern.base} pattern=${pattern.pattern} gitignore=${!!this.gitignore}`);
    }

    private loadGitignore() {
        const gitignorePath = path.join(this.options.workspaceRoot, '.gitignore');
        if (fs.existsSync(gitignorePath)) {
            try {
                const content = fs.readFileSync(gitignorePath, 'utf8');
                this.gitignore = ignore().add(content);
                this.options.logger.debug('loaded .gitignore rules');
            } catch (error) {
                this.options.logger.debug(`failed to read .gitignore: ${String(error)}`);
            }
        }
    }

    private schedule(type: ReloadEventType, uri: vscode.Uri) {
        const fsPath = uri.fsPath.replace(/\\/g, '/');
        const workspaceRoot = this.options.workspaceRoot.replace(/\\/g, '/');
        const relativePath = path.relative(workspaceRoot, fsPath).replace(/\\/g, '/');

        // Check excludes
        if (this.isExcluded(relativePath)) {
            return;
        }

        this.pendingEvent = { type, relativePath };
        this.options.logger.debug(`watcher event: type=${type} path="${relativePath}"`);

        if (this.timer) {
            clearTimeout(this.timer);
        }
        
        const config = vscode.workspace.getConfiguration('love2d');
        const debounce = config.get<number>('reloadDebounce') || 300;
        
        this.timer = setTimeout(() => {
            const event = this.pendingEvent;
            this.timer = null;
            this.pendingEvent = null;
            if (event) {
                this.options.onReload(event);
            }
        }, debounce);
    }

    private isExcluded(relativePath: string): boolean {
        // ALWAYS IGNORE internal files, common noise, and gitignored files.
        // These have the highest authority and cannot be overridden.
        // Always ignore our own log file and common patterns
        if (relativePath.endsWith('.tmp') || 
            this.options.watchExclude?.some(e => relativePath === e || relativePath.startsWith(`${e}/`))) {
            return true;
        }

        const internalExcludes = ['.love2d-forge/', '.git/', 'node_modules/', '.vscode/'];
        if (internalExcludes.some(exclude => relativePath === exclude || relativePath.startsWith(exclude))) {
            return true;
        }

        if (this.gitignore && this.gitignore.ignores(relativePath)) {
            return true;
        }

        // 2. fallback: if no gitignore, filter by safe extensions
        if (!this.gitignore) {
            const ext = path.extname(relativePath).toLowerCase();
            if (!DEFAULT_SAFE_EXTENSIONS.has(ext)) {
                return true;
            }
        }

        return false;
    }

    public dispose(): void {
        this.watcher.dispose();
        if (this.timer) {
            clearTimeout(this.timer);
        }
    }
}
