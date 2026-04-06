import * as vscode from 'vscode';

export enum ExtensionState {
    Stopped,
    Running
}

export class StatusBarController {
    private statusBarItem: vscode.StatusBarItem;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.command = 'love2d.launch';
        this.update(ExtensionState.Stopped);
        this.statusBarItem.show();
    }

    public update(state: ExtensionState) {
        switch (state) {
            case ExtensionState.Stopped:
                this.statusBarItem.text = '$(debug-start) Love2D';
                this.statusBarItem.tooltip = 'Click to launch Love2D game';
                this.statusBarItem.color = undefined;
                break;
            case ExtensionState.Running:
                this.statusBarItem.text = '$(zap) Love2D';
                this.statusBarItem.tooltip = 'Love2D is running. Save events are watched and logged in the Love2D output channel.';
                this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
                break;
        }
    }

    public dispose() {
        this.statusBarItem.dispose();
    }
}
