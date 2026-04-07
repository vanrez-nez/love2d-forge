import * as vscode from 'vscode';
import { FileLogStore } from './fileLogStore';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

class LogClock {
    private readonly startedAt = Date.now();

    public formatPrefix(): string {
        const elapsedMs = Date.now() - this.startedAt;
        const seconds = Math.floor(elapsedMs / 1000);
        const milliseconds = elapsedMs % 1000;
        return `${seconds}.${milliseconds.toString().padStart(3, '0')}`;
    }
}

export interface LogFilter {
    rules: ReadonlySet<string> | null;
}

export class Logger {
    private readonly clock: LogClock;
    private readonly filter: LogFilter;

    constructor(
        private readonly outputChannel: vscode.OutputChannel,
        private readonly scope: string,
        private readonly fileLogStore?: FileLogStore | null,
        clock?: LogClock,
        filter?: LogFilter
    ) {
        this.clock = clock ?? new LogClock();
        this.filter = filter ?? { rules: null };
    }

    public updateFilter(rules?: string | string[] | null): void {
        if (!rules) {
            this.filter.rules = null;
            return;
        }
        const arr = Array.isArray(rules) ? rules : [rules];
        this.filter.rules = new Set(arr.map(r => r.toLowerCase()));
    }

    public log(message: string): void {
        this.write('trace', message);
    }

    public debug(message: string): void {
        this.write('debug', message);
    }

    public info(message: string): void {
        this.write('info', message);
    }

    public warn(message: string): void {
        this.warnMessage(message);
    }

    public warnMessage(message: string): void {
        this.write('warn', message);
    }

    public error(message: string): void {
        this.errorMessage(message);
    }

    public errorMessage(message: string): void {
        this.write('error', message);
    }

    public write(level: LogLevel, message: string): void {
        this.appendLine(level, message);
    }

    public appendRaw(level: LogLevel, message: string): void {
        if (!this.isLevelAllowed(level)) {
            return;
        }
        this.outputChannel.append(message);
        this.fileLogStore?.appendChunk(message);
    }

    public appendLine(level: LogLevel, message: string): void {
        if (!this.isLevelAllowed(level)) {
            return;
        }
        const line = this.formatMessage(level, message);
        this.outputChannel.appendLine(line);
        this.fileLogStore?.write(line);
    }

    private isLevelAllowed(level: LogLevel): boolean {
        if (!this.filter.rules || this.filter.rules.has('*')) {
            return true;
        }

        // 1. Direct level match (e.g., "info")
        if (this.filter.rules.has(level)) {
            return true;
        }

        // 2. Scope:Level match (e.g., "bridge:info")
        const segments = this.scope.split(':');
        for (const segment of segments) {
            if (this.filter.rules.has(`${segment}:${level}`)) {
                return true;
            }
        }

        return false;
    }

    public formatMessage(level: LogLevel, message: string): string {
        return `${this.clock.formatPrefix()} [${this.scope}] ${level.toUpperCase()} ${message}`;
    }

    public child(scope: string): Logger {
        return new Logger(this.outputChannel, `${this.scope}:${scope}`, this.fileLogStore, this.clock, this.filter);
    }

    public getOutputChannel(): vscode.OutputChannel {
        return this.outputChannel;
    }
}
