import * as vscode from 'vscode';
import { FileLogStore } from './fileLogStore';

class LogClock {
    private readonly startedAt = Date.now();

    public formatPrefix(): string {
        const elapsedMs = Date.now() - this.startedAt;
        const seconds = Math.floor(elapsedMs / 1000);
        const milliseconds = elapsedMs % 1000;
        return `[${seconds}.${milliseconds.toString().padStart(3, '0')}]`;
    }
}

export class Logger {
    private readonly clock: LogClock;

    constructor(
        private readonly outputChannel: vscode.OutputChannel,
        private readonly prefix: string,
        private readonly fileLogStore?: FileLogStore | null,
        clock?: LogClock
    ) {
        this.clock = clock ?? new LogClock();
    }

    public log(message: string): void {
        const line = this.formatLine(`${this.prefix} ${message}`);
        this.outputChannel.appendLine(line);
        this.fileLogStore?.write(line);
    }

    public formatLine(line: string): string {
        return `${this.clock.formatPrefix()} ${line}`;
    }

    public child(scope: string): Logger {
        return new Logger(this.outputChannel, `${this.prefix}[${scope}]`, this.fileLogStore, this.clock);
    }
}
