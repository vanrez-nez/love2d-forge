import * as vscode from 'vscode';

export class Logger {
    constructor(private readonly outputChannel: vscode.OutputChannel, private readonly prefix: string) {}

    public log(message: string): void {
        this.outputChannel.appendLine(`${this.prefix} ${message}`);
    }

    public child(scope: string): Logger {
        return new Logger(this.outputChannel, `${this.prefix}[${scope}]`);
    }
}
