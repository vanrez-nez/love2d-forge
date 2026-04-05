import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class HotManager {
    private hotFilePath: string;
    private gitIgnorePath: string;

    constructor(private workspaceRoot: string) {
        this.hotFilePath = path.join(this.workspaceRoot, 'hot.lua');
        this.gitIgnorePath = path.join(this.workspaceRoot, '.gitignore');
    }

    public async enableHotReload(hotLuaTemplate: string): Promise<void> {
        try {
            // Write hot.lua
            fs.writeFileSync(this.hotFilePath, hotLuaTemplate);
            vscode.window.showInformationMessage('Hot Reload enabled. `hot.lua` created.');

            // Update .gitignore
            this.addToGitIgnore();

            // Show instruction
            const action = 'Copy to Clipboard';
            const msg = 'Add this line to your main.lua: pcall(require, "hot")';
            const choice = await vscode.window.showInformationMessage(msg, action);
            if (choice === action) {
                await vscode.env.clipboard.writeText('pcall(require, "hot")');
            }
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to enable hot reload: ${err}`);
        }
    }

    public async disableHotReload(): Promise<void> {
        try {
            if (fs.existsSync(this.hotFilePath)) {
                fs.unlinkSync(this.hotFilePath);
            }
            this.removeFromGitIgnore();
            vscode.window.showInformationMessage('Hot Reload disabled. `hot.lua` removed.');
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to disable hot reload: ${err}`);
        }
    }

    public isHotReloadEnabled(): boolean {
        return fs.existsSync(this.hotFilePath);
    }

    private addToGitIgnore(): void {
        if (!fs.existsSync(this.gitIgnorePath)) {
            fs.writeFileSync(this.gitIgnorePath, 'hot.lua\n');
            return;
        }

        const content = fs.readFileSync(this.gitIgnorePath, 'utf8');
        if (!content.includes('hot.lua')) {
            fs.appendFileSync(this.gitIgnorePath, '\nhot.lua\n');
        }
    }

    private removeFromGitIgnore(): void {
        if (!fs.existsSync(this.gitIgnorePath)) {
            return;
        }

        const lines = fs.readFileSync(this.gitIgnorePath, 'utf8').split('\n');
        const filtered = lines.filter((line: string) => line.trim() !== 'hot.lua');
        fs.writeFileSync(this.gitIgnorePath, filtered.join('\n'));
    }
}
