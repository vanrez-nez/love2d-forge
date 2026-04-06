import * as vscode from 'vscode';
import { FileLogStore } from './fileLogStore';

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'TRACE';

class LogClock {
    private readonly startedAt = Date.now();

    public formatPrefix(): string {
        const elapsedMs = Date.now() - this.startedAt;
        const seconds = Math.floor(elapsedMs / 1000);
        const milliseconds = elapsedMs % 1000;
        return `${seconds}.${milliseconds.toString().padStart(3, '0')}`;
    }
}

export class Logger {
    private readonly clock: LogClock;

    constructor(
        private readonly outputChannel: vscode.OutputChannel,
        private readonly scope: string,
        private readonly fileLogStore?: FileLogStore | null,
        clock?: LogClock
    ) {
        this.clock = clock ?? new LogClock();
    }

    public log(message: string): void {
        this.write('TRACE', message);
    }

    public info(message: string): void {
        this.write('INFO', message);
    }

    public warn(message: string): void {
        this.write('WARN', message);
    }

    public error(message: string): void {
        this.write('ERROR', message);
    }

    public write(level: LogLevel, message: string): void {
        const line = this.formatMessage(level, message);
        this.outputChannel.appendLine(line);
        this.fileLogStore?.write(line);
    }

    public formatMessage(level: LogLevel, message: string): string {
        return `${this.clock.formatPrefix()} [${this.scope}] ${level} ${message}`;
    }

    public child(scope: string): Logger {
        return new Logger(this.outputChannel, `${this.scope}:${scope}`, this.fileLogStore, this.clock);
    }
}
