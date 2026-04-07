import * as net from 'net';
import { Logger } from './logger';

interface BridgeCommand {
    cmd: string;
    [key: string]: unknown;
}

interface BridgeResponse {
    id?: number;
    type: string;
    success?: boolean;
    data?: unknown;
    error?: string;
}

type BridgePrintLevel = 'ERROR' | 'WARN' | 'INFO' | 'TRACE';
interface InferredBridgePrint {
    level: BridgePrintLevel;
    message: string;
}

export class BridgeClient {
    private socket: net.Socket | null = null;
    private buffer = '';
    private nextRequestId = 0;
    private readonly pendingRequests = new Map<number, {
        resolve: (value: BridgeResponse) => void;
        reject: (reason: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();
    private _connected = false;

    constructor(
        private readonly logger: Logger,
        private readonly inferLogTypes = true
    ) {}

    public get connected(): boolean {
        return this._connected;
    }

    public async connect(port: number): Promise<void> {
        if (this._connected) {
            this.disconnect();
        }

        this.logger.log(`bridge connect requested: port=${port}`);
        return new Promise<void>((resolve, reject) => {
            const socket = new net.Socket();
            this.socket = socket;

            socket.on('connect', () => {
                this._connected = true;
                this.logger.log(`bridge connected: port=${port}`);
                resolve();
            });

            socket.on('data', (data: Buffer) => {
                this.handleData(data);
            });

            socket.on('close', () => {
                this.handleDisconnect('socket closed');
            });

            socket.on('error', (err: Error) => {
                if (!this._connected) {
                    reject(err);
                }
                this.handleDisconnect(`socket error: ${err.message}`);
            });

            socket.connect(port, '127.0.0.1');
        });
    }

    public disconnect(): void {
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        this.handleDisconnect('disconnect requested');
    }

    public async reload(moduleName: string): Promise<void> {
        const response = await this.send({ cmd: 'reload', module: moduleName });
        if (!response.success) {
            throw new Error(response.error || `bridge reload failed for ${moduleName}`);
        }
    }

    private async send(command: BridgeCommand, timeoutMs = 5000): Promise<BridgeResponse> {
        if (!this._connected || !this.socket) {
            throw new Error('bridge not connected');
        }

        const id = ++this.nextRequestId;
        const payload = JSON.stringify({ ...command, id }) + '\n';
        this.logger.log(`bridge send: id=${id} payload="${payload.trim()}"`);

        return new Promise<BridgeResponse>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`bridge command "${command.cmd}" timed out`));
            }, timeoutMs);

            this.pendingRequests.set(id, { resolve, reject, timer });
            this.socket?.write(payload);
        });
    }

    private handleData(data: Buffer): void {
        this.buffer += data.toString('utf8');

        let newlineIndex = this.buffer.indexOf('\n');
        while (newlineIndex !== -1) {
            const line = this.buffer.slice(0, newlineIndex).trim();
            this.buffer = this.buffer.slice(newlineIndex + 1);

            if (line.length > 0) {
                this.logger.log(`bridge receive: "${line}"`);
                try {
                    const message = JSON.parse(line) as BridgeResponse;
                    this.handleMessage(message);
                } catch {
                    this.logger.log(`bridge received malformed message: ${line}`);
                }
            }

            newlineIndex = this.buffer.indexOf('\n');
        }
    }

    private handleMessage(message: BridgeResponse): void {
        if (message.type === 'log') {
            this.logBridgePrint(String(message.data));
            return;
        }

        if (message.id === undefined) {
            this.logger.log(`bridge message without id ignored: type=${message.type}`);
            return;
        }

        const pending = this.pendingRequests.get(message.id);
        if (!pending) {
            this.logger.log(`bridge response without pending request ignored: id=${message.id}`);
            return;
        }

        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.id);
        this.logger.log(`bridge response: id=${message.id} success=${message.success === true}`);
        pending.resolve(message);
    }

    private handleDisconnect(reason: string): void {
        if (!this._connected && this.pendingRequests.size === 0) {
            return;
        }

        const hadConnection = this._connected;
        this._connected = false;

        for (const [id, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(new Error('bridge disconnected'));
            this.pendingRequests.delete(id);
        }

        if (hadConnection) {
            this.logger.log(`bridge disconnected: ${reason}`);
        }
    }

    private logBridgePrint(message: string): void {
        if (!this.inferLogTypes) {
            this.logger.log(`bridge log: ${message}`);
            return;
        }

        const inferred = inferBridgePrint(message);
        switch (inferred.level) {
        case 'ERROR':
            this.logger.error(inferred.message);
            break;
        case 'WARN':
            this.logger.warn(inferred.message);
            break;
        case 'INFO':
            this.logger.info(inferred.message);
            break;
        default:
            this.logger.log(inferred.message);
            break;
        }
    }
}

function inferBridgePrint(message: string): InferredBridgePrint {
    const trimmed = message.trim();
    const lowered = trimmed.toLowerCase();

    const errorMessage = stripLeadingKeyword(trimmed, lowered, 'error');
    if (errorMessage) {
        return { level: 'ERROR', message: errorMessage };
    }

    const warnMessage = stripLeadingKeyword(trimmed, lowered, 'warn')
        ?? stripLeadingKeyword(trimmed, lowered, 'warning');
    if (warnMessage) {
        return { level: 'WARN', message: warnMessage };
    }

    const infoMessage = stripLeadingKeyword(trimmed, lowered, 'info');
    if (infoMessage) {
        return { level: 'INFO', message: infoMessage };
    }

    return { level: 'TRACE', message };
}

function stripLeadingKeyword(original: string, lowered: string, keyword: string): string | null {
    if (!lowered.startsWith(keyword)) {
        return null;
    }

    let index = keyword.length;
    while (index < original.length) {
        const char = original.charAt(index);
        if (char === ':' || char === ' ' || char === '\t' || char === ']' || char === '-') {
            index += 1;
            continue;
        }
        break;
    }

    if (index === keyword.length && original.length !== keyword.length) {
        return null;
    }

    const stripped = original.slice(index).trimStart();
    return stripped.length > 0 ? stripped : original;
}
