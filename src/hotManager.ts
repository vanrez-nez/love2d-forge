import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class HotManager {
    private hotDirPath: string;
    private hotFilePath: string;
    private gitIgnorePath: string;

    constructor(private workspaceRoot: string) {
        this.hotDirPath = path.join(this.workspaceRoot, '.love2d-hot');
        this.hotFilePath = path.join(this.hotDirPath, 'hot.lua');
        this.gitIgnorePath = path.join(this.workspaceRoot, '.gitignore');
    }

    public async enableHotReload(hotLuaTemplate: string): Promise<void> {
        try {
            // Create directory if not exists
            if (!fs.existsSync(this.hotDirPath)) {
                fs.mkdirSync(this.hotDirPath);
            }

            // Write hot.lua
            fs.writeFileSync(this.hotFilePath, hotLuaTemplate);
            vscode.window.showInformationMessage('Hot Reload enabled. `.love2d-hot/hot.lua` created.');

            // Update .gitignore
            this.addToGitIgnore();

            // Show instruction
            const action = 'Copy to Clipboard';
            const msg = 'Add this line to your main.lua: pcall(require, ".love2d-hot.hot")';
            const choice = await vscode.window.showInformationMessage(msg, action);
            if (choice === action) {
                await vscode.env.clipboard.writeText('pcall(require, ".love2d-hot.hot")');
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
            if (fs.existsSync(this.hotDirPath)) {
                const files = fs.readdirSync(this.hotDirPath);
                if (files.length === 0) {
                    fs.rmdirSync(this.hotDirPath);
                }
            }
            this.removeFromGitIgnore();
            vscode.window.showInformationMessage('Hot Reload disabled. `.love2d-hot/` removed.');
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to disable hot reload: ${err}`);
        }
    }

    public isHotReloadEnabled(): boolean {
        return fs.existsSync(this.hotFilePath);
    }

    private addToGitIgnore(): void {
        if (!fs.existsSync(this.gitIgnorePath)) {
            fs.writeFileSync(this.gitIgnorePath, '.love2d-hot/\n');
            return;
        }

        const content = fs.readFileSync(this.gitIgnorePath, 'utf8');
        if (!content.includes('.love2d-hot/')) {
            fs.appendFileSync(this.gitIgnorePath, '\n.love2d-hot/\n');
        }
    }

    private removeFromGitIgnore(): void {
        if (!fs.existsSync(this.gitIgnorePath)) {
            return;
        }

        const lines = fs.readFileSync(this.gitIgnorePath, 'utf8').split('\n');
        const filtered = lines.filter((line: string) => line.trim() !== '.love2d-hot' && line.trim() !== '.love2d-hot/');
        fs.writeFileSync(this.gitIgnorePath, filtered.join('\n'));
    }
}
