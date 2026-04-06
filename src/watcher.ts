import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from './logger';
import { ReloadEvent, ReloadEventType } from './reloadPolicy';

export class FileWatcher {
    private watcher: vscode.FileSystemWatcher;
    private timer: NodeJS.Timeout | null = null;
    private pendingEvent: ReloadEvent | null = null;

    constructor(
        private readonly workspaceRoot: string,
        private readonly logger: Logger,
        private readonly onReload: (event: ReloadEvent) => void
    ) {
        this.watcher = vscode.workspace.createFileSystemWatcher('**/*.lua');
        this.watcher.onDidChange((uri) => this.schedule('change', uri));
        this.watcher.onDidCreate((uri) => this.schedule('create', uri));
        this.watcher.onDidDelete((uri) => this.schedule('delete', uri));
    }

    private schedule(type: ReloadEventType, uri: vscode.Uri) {
        const relativePath = path.relative(this.workspaceRoot, uri.fsPath).replace(/\\/g, '/');
        this.pendingEvent = { type, relativePath };
        this.logger.log(`watcher event: type=${type} path="${relativePath}"`);

        if (this.timer) {
            clearTimeout(this.timer);
            this.logger.log('debounce: canceled previous timer');
        }
        const config = vscode.workspace.getConfiguration('love2d');
        const debounce = config.get<number>('reloadDebounce') || 300;
        this.logger.log(`debounce: scheduling reload in ${debounce}ms`);
        this.timer = setTimeout(() => {
            const event = this.pendingEvent;
            this.timer = null;
            this.pendingEvent = null;
            if (!event) {
                this.logger.log('debounce fired with no pending event');
                return;
            }

            this.logger.log(`debounce fired: type=${event.type} path="${event.relativePath}"`);
            this.onReload(event);
        }, debounce);
    }

    public dispose(): void {
        this.watcher.dispose();
        if (this.timer) {
            clearTimeout(this.timer);
        }
    }
}
