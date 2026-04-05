import * as vscode from 'vscode';

export class FileWatcher {
    private watcher: vscode.FileSystemWatcher;
    private timer: NodeJS.Timeout | null = null;

    constructor(private onReload: () => void) {
        this.watcher = vscode.workspace.createFileSystemWatcher('**/*.lua');
        this.watcher.onDidChange(() => this.triggerReload());
        this.watcher.onDidCreate(() => this.triggerReload());
        this.watcher.onDidDelete(() => this.triggerReload());
    }

    private triggerReload() {
        if (this.timer) {
            clearTimeout(this.timer);
        }

        const config = vscode.workspace.getConfiguration('love2d');
        const debounce = config.get<number>('reloadDebounce') || 300;

        this.timer = setTimeout(() => {
            this.onReload();
            this.timer = null;
        }, debounce);
    }

    public dispose() {
        this.watcher.dispose();
        if (this.timer) {
            clearTimeout(this.timer);
        }
    }
}
