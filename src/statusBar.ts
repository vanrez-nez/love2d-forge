import * as vscode from 'vscode';

export enum ExtensionState {
    Stopped,
    Runningrestart,
    RunningHotSwap
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
            case ExtensionState.Runningrestart:
                this.statusBarItem.text = '$(sync) Love2D (restart mode)';
                this.statusBarItem.tooltip = 'Running in full restart mode. Saving a file will kill and relaunch.';
                this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
                break;
            case ExtensionState.RunningHotSwap:
                this.statusBarItem.text = '$(zap) Love2D (hot swap)';
                this.statusBarItem.tooltip = 'Running in hot swap mode. State is preserved across reloads.';
                this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
                break;
        }
    }

    public dispose() {
        this.statusBarItem.dispose();
    }
}
