import * as childProcess from 'child_process';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { Logger } from './logger';
import { BridgeClient } from './bridgeClient';
import { getBridgePortFile, getStartupErrorFile } from './runtimePaths';
import { FileLogStore } from './fileLogStore';

export class ProcessManager {
    private process: childProcess.ChildProcess | null = null;
    private outputChannel: vscode.OutputChannel;
    private rootLogger: Logger;
    private logger: Logger;
    private bridgeClient: BridgeClient;
    private readonly versionCache = new Map<string, string | null>();
    private expectedExit = false;
    private bridgePollTimer: NodeJS.Timeout | null = null;
    private startupErrorPollTimer: NodeJS.Timeout | null = null;
    private bridgePortFile: string | null = null;
    private startupErrorFile: string | null = null;
    private lastBridgePort: number | null = null;
    private startupErrorDelivered = false;
    private outputPartialLine = false;
    public onCrash: (() => void) | null = null;

    constructor(
        private readonly fileLogStore?: FileLogStore | null,
        inferLogTypes = true
    ) {
        this.outputChannel = vscode.window.createOutputChannel('Love2D');
        this.rootLogger = new Logger(this.outputChannel, '[love2d]', this.fileLogStore);
        this.logger = this.rootLogger.child('process');
        this.bridgeClient = new BridgeClient(this.rootLogger.child('bridge'), inferLogTypes);
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
        this.startupErrorFile = getStartupErrorFile(workspaceRoot);
        this.lastBridgePort = null;
        this.startupErrorDelivered = false;
        this.bridgeClient.disconnect();
        this.stopBridgePolling();
        this.stopStartupErrorPolling();
        try {
            fs.unlinkSync(this.bridgePortFile);
            this.logger.log(`removed stale bridge port file: "${this.bridgePortFile}"`);
        } catch {}
        try {
            fs.unlinkSync(this.startupErrorFile);
            this.logger.log(`removed stale startup error file: "${this.startupErrorFile}"`);
        } catch {}
        this.outputChannel.clear();
        this.outputPartialLine = false;
        this.outputChannel.show(true);
        const loveVersion = this.detectLoveVersion(lovePath);
        if (loveVersion) {
            this.appendOutputLine(`[Love2D] Version: ${loveVersion}`);
            this.logger.log(`detected Love version: ${loveVersion}`);
        }
        this.appendOutputLine(`[Love2D] Launching: ${lovePath} ${bootstrapDir}`);
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
                this.appendOutput(data.toString());
            });
            this.logger.log('stdout listener attached');

            proc.stderr?.on('data', (data: Buffer | string) => {
                this.appendOutput(data.toString());
            });
            this.logger.log('stderr listener attached');

            proc.on('close', (code: number | null) => {
                this.appendOutputLine(`[Love2D] Process exited with code ${code}`);
                this.logger.log(`process close observed: code=${code} expectedExit=${this.expectedExit}`);
                if (this.process === proc) {
                    this.process = null;
                    this.bridgeClient.disconnect();
                    this.stopBridgePolling();
                    this.stopStartupErrorPolling();
                    this.flushStartupErrorFile();
                    const expectedExit = this.expectedExit;
                    this.expectedExit = false;
                    if (!expectedExit) {
                        this.onCrash?.();
                    }
                }
            });

            this.startBridgePolling();
            this.startStartupErrorPolling();
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
        this.stopStartupErrorPolling();
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

    private detectLoveVersion(lovePath: string): string | null {
        const cached = this.versionCache.get(lovePath);
        if (cached !== undefined) {
            return cached;
        }

        try {
            const result = childProcess.spawnSync(lovePath, ['--version'], {
                encoding: 'utf8'
            });
            const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
            if (!output) {
                this.versionCache.set(lovePath, null);
                return null;
            }

            const firstLine = output.split(/\r?\n/, 1)[0]?.trim();
            const version = firstLine || null;
            this.versionCache.set(lovePath, version);
            return version;
        } catch (error) {
            this.logger.log(`failed to detect Love version: ${String(error)}`);
            this.versionCache.set(lovePath, null);
            return null;
        }
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

    private startStartupErrorPolling(): void {
        if (!this.startupErrorFile || this.startupErrorPollTimer) {
            return;
        }

        this.logger.log(`startup error polling started: file="${this.startupErrorFile}"`);
        this.startupErrorPollTimer = setInterval(() => {
            this.flushStartupErrorFile();
        }, 100);
    }

    private stopBridgePolling(): void {
        if (this.bridgePollTimer) {
            clearInterval(this.bridgePollTimer);
            this.bridgePollTimer = null;
            this.logger.log('bridge polling stopped');
        }
    }

    private stopStartupErrorPolling(): void {
        if (this.startupErrorPollTimer) {
            clearInterval(this.startupErrorPollTimer);
            this.startupErrorPollTimer = null;
            this.logger.log('startup error polling stopped');
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

    private flushStartupErrorFile(): void {
        if (!this.startupErrorFile || this.startupErrorDelivered) {
            return;
        }

        try {
            const message = fs.readFileSync(this.startupErrorFile, 'utf8').trim();
            if (!message) {
                return;
            }

            this.startupErrorDelivered = true;
            this.appendOutputLine(message);
            this.logger.log('startup error forwarded from temp file');
        } catch {
            return;
        }
    }

    private appendOutput(chunk: string): void {
        if (!chunk) {
            return;
        }

        const normalized = chunk.replace(/\r\n/g, '\n');
        const parts = normalized.split('\n');

        for (let index = 0; index < parts.length; index += 1) {
            const line = parts[index] ?? '';
            const isLast = index === parts.length - 1;
            const hasTrailingNewline = !isLast;

            if (!this.outputPartialLine) {
                const prefixedLine = this.rootLogger.formatLine(line);
                this.outputChannel.append(prefixedLine);
                this.fileLogStore?.appendChunk(prefixedLine);
            } else {
                this.outputChannel.append(line);
                this.fileLogStore?.appendChunk(line);
            }

            if (hasTrailingNewline) {
                this.outputChannel.append('\n');
                this.fileLogStore?.appendChunk('\n');
                this.outputPartialLine = false;
            } else {
                this.outputPartialLine = true;
            }
        }
    }

    private appendOutputLine(line: string): void {
        const formattedLine = this.rootLogger.formatLine(line);
        this.outputChannel.appendLine(formattedLine);
        this.fileLogStore?.write(formattedLine);
        this.outputPartialLine = false;
    }

    public dispose() {
        this.stop();
        this.bridgeClient.disconnect();
        this.stopBridgePolling();
        this.stopStartupErrorPolling();
        this.outputChannel.dispose();
    }
}
