import * as childProcess from 'child_process';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { Logger } from './logger';
import { BridgeClient } from './bridgeClient';
import { getBridgePortFile } from './runtimePaths';

export class ProcessManager {
    private process: childProcess.ChildProcess | null = null;
    private outputChannel: vscode.OutputChannel;
    private logger: Logger;
    private bridgeClient: BridgeClient;
    private expectedExit = false;
    private bridgePollTimer: NodeJS.Timeout | null = null;
    private bridgePortFile: string | null = null;
    private lastBridgePort: number | null = null;
    public onCrash: (() => void) | null = null;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Love2D');
        this.logger = new Logger(this.outputChannel, '[love2d]').child('process');
        this.bridgeClient = new BridgeClient(new Logger(this.outputChannel, '[love2d]').child('bridge'));
    }

    public async launch(bootstrapDir: string, workspaceRoot: string, executablePath: string, reason: string): Promise<boolean> {
        this.logger.log(`launch requested: reason="${reason}" running=${this.isRunning()} workspace="${workspaceRoot}" bootstrap="${bootstrapDir}"`);
        if (this.process) {
            await this.stop();
        }

        const lovePath = executablePath || this.detectLovePath();
        this.logger.log(`resolved Love executable: "${lovePath}" (configured=${executablePath ? 'yes' : 'no'})`);
        if (!lovePath) {
            vscode.window.showErrorMessage('Love2D executable not found. Please configure "love2d.executablePath" in settings.');
            return false;
        }

        this.expectedExit = false;
        this.bridgePortFile = getBridgePortFile(workspaceRoot);
        this.lastBridgePort = null;
        this.bridgeClient.disconnect();
        this.stopBridgePolling();
        try {
            fs.unlinkSync(this.bridgePortFile);
            this.logger.log(`removed stale bridge port file: "${this.bridgePortFile}"`);
        } catch {}
        this.outputChannel.clear();
        this.outputChannel.show(true);
        this.outputChannel.appendLine(`[Love2D] Launching: ${lovePath} ${bootstrapDir}`);
        this.logger.log('output channel cleared and shown');

        try {
            this.logger.log('spawning Love2D process');
            const proc = childProcess.spawn(lovePath, [bootstrapDir], {
                cwd: workspaceRoot,  // keep cwd at project so io.open relative paths work
                env: {
                    ...process.env,
                    LOVE2D_HOT_PORT: '0'
                },
                stdio: ['ignore', 'pipe', 'pipe']
            });

            this.process = proc;
            this.logger.log(`spawned child pid=${proc.pid ?? 'unknown'}`);

            proc.stdout?.on('data', (data: Buffer | string) => {
                this.outputChannel.append(data.toString());
            });
            this.logger.log('stdout listener attached');

            proc.stderr?.on('data', (data: Buffer | string) => {
                this.outputChannel.append(data.toString());
            });
            this.logger.log('stderr listener attached');

            proc.on('close', (code: number | null) => {
                this.outputChannel.appendLine(`[Love2D] Process exited with code ${code}`);
                this.logger.log(`process close observed: code=${code} expectedExit=${this.expectedExit}`);
                if (this.process === proc) {
                    this.process = null;
                    this.bridgeClient.disconnect();
                    this.stopBridgePolling();
                    const expectedExit = this.expectedExit;
                    this.expectedExit = false;
                    if (!expectedExit) {
                        this.onCrash?.();
                    }
                }
            });

            this.startBridgePolling();
            return true;
        } catch (err) {
            this.logger.log(`launch failed: ${String(err)}`);
            vscode.window.showErrorMessage(`Failed to launch Love2D: ${err}`);
            return false;
        }
    }

    public async stop(): Promise<void> {
        if (!this.process) {
            this.logger.log('stop requested but no process is running');
            return;
        }
        const proc = this.process;
        this.process = null;
        this.expectedExit = true;
        this.bridgeClient.disconnect();
        this.stopBridgePolling();
        this.logger.log(`stop requested for pid=${proc.pid ?? 'unknown'}`);

        return new Promise((resolve) => {
            this.logger.log('sending SIGTERM');
            proc.kill('SIGTERM');
            const timer = setTimeout(() => {
                this.logger.log('SIGTERM timeout reached; sending SIGKILL');
                proc.kill('SIGKILL');
                resolve();
            }, 200);
            proc.on('close', () => {
                clearTimeout(timer);
                this.logger.log('process closed during stop');
                resolve();
            });
        });
    }

    public isRunning(): boolean {
        return this.process !== null;
    }

    public isBridgeConnected(): boolean {
        return this.bridgeClient.connected;
    }

    public async reloadModule(moduleName: string): Promise<void> {
        this.logger.log(`bridge reload requested: module=${moduleName} connected=${this.bridgeClient.connected}`);
        await this.bridgeClient.reload(moduleName);
        this.logger.log(`bridge reload completed: module=${moduleName}`);
    }

    private detectLovePath(): string {
        if (process.platform === 'darwin') {
            const commonPaths = [
                '/Applications/love.app/Contents/MacOS/love',
                '/usr/local/bin/love',
                '/opt/homebrew/bin/love'
            ];
            for (const p of commonPaths) {
                if (fs.existsSync(p)) {
                    this.logger.log(`auto-detected Love executable at "${p}"`);
                    return p;
                }
            }
        }
        this.logger.log('falling back to "love" from PATH');
        return 'love';
    }

    public getOutputChannel(): vscode.OutputChannel {
        return this.outputChannel;
    }

    private startBridgePolling(): void {
        if (!this.bridgePortFile || this.bridgePollTimer) {
            return;
        }

        this.logger.log(`bridge polling started: portFile="${this.bridgePortFile}"`);
        this.bridgePollTimer = setInterval(() => {
            void this.tryConnectBridge();
        }, 250);
    }

    private stopBridgePolling(): void {
        if (this.bridgePollTimer) {
            clearInterval(this.bridgePollTimer);
            this.bridgePollTimer = null;
            this.logger.log('bridge polling stopped');
        }
    }

    private async tryConnectBridge(): Promise<void> {
        if (!this.process || !this.bridgePortFile || this.bridgeClient.connected) {
            return;
        }

        let port: number;
        try {
            const raw = fs.readFileSync(this.bridgePortFile, 'utf8').trim();
            port = Number.parseInt(raw, 10);
            if (!Number.isFinite(port) || port <= 0) {
                return;
            }
        } catch {
            return;
        }

        if (this.lastBridgePort === port) {
            return;
        }

        try {
            await this.bridgeClient.connect(port);
            this.lastBridgePort = port;
            this.stopBridgePolling();
        } catch (error) {
            this.lastBridgePort = null;
            this.logger.log(`bridge connect failed: port=${port} error=${String(error)}`);
        }
    }

    public dispose() {
        this.stop();
        this.bridgeClient.disconnect();
        this.stopBridgePolling();
        this.outputChannel.dispose();
    }
}
