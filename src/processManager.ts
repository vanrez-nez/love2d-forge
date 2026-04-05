import * as child_process from 'child_process';
import * as vscode from 'vscode';
import * as fs from 'fs';

export class ProcessManager {
    private process: child_process.ChildProcess | null = null;
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Love2D');
    }

    public async launch(workspaceRoot: string, executablePath: string): Promise<boolean> {
        if (this.process) {
            await this.stop();
        }

        const lovePath = executablePath || this.detectLovePath();
        if (!lovePath) {
            vscode.window.showErrorMessage('Love2D executable not found. Please configure "love2d.executablePath" in settings.');
            return false;
        }

        this.outputChannel.clear();
        this.outputChannel.show(true);
        this.outputChannel.appendLine(`[Love2D] Launching: ${lovePath} ${workspaceRoot}`);

        try {
            this.process = child_process.spawn(lovePath, [workspaceRoot], {
                cwd: workspaceRoot,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            this.process.stdout?.on('data', (data: Buffer | string) => {
                this.outputChannel.append(data.toString());
            });

            this.process.stderr?.on('data', (data: Buffer | string) => {
                this.outputChannel.append(data.toString());
            });

            this.process.on('close', (code: number | null) => {
                this.outputChannel.appendLine(`[Love2D] Process exited with code ${code}`);
                this.process = null;
            });

            return true;
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to launch Love2D: ${err}`);
            return false;
        }
    }

    public async stop(): Promise<void> {
        if (!this.process) {
            return;
        }

        const proc = this.process;
        this.process = null;

        return new Promise((resolve) => {
            proc.kill('SIGTERM');
            const timer = setTimeout(() => {
                proc.kill('SIGKILL');
                resolve();
            }, 200);

            proc.on('close', () => {
                clearTimeout(timer);
                resolve();
            });
        });
    }

    public isRunning(): boolean {
        return this.process !== null;
    }

    private detectLovePath(): string {
        // macOS detection
        if (process.platform === 'darwin') {
            const commonPaths = [
                '/Applications/love.app/Contents/MacOS/love',
                '/usr/local/bin/love',
                '/opt/homebrew/bin/love'
            ];
            for (const p of commonPaths) {
                if (fs.existsSync(p)) {
                    return p;
                }
            }
        }
        // Fallback to searching in PATH
        return 'love';
    }

    public dispose() {
        this.stop();
        this.outputChannel.dispose();
    }
}
