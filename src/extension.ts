import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProcessManager } from './processManager';
import { HotManager } from './hotManager';
import { FileWatcher } from './watcher';
import { StatusBarController, ExtensionState } from './statusBar';

export function activate(context: vscode.ExtensionContext) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        return;
    }

    const processManager = new ProcessManager();
    const hotManager = new HotManager(workspaceRoot);
    const statusBar = new StatusBarController();

    const reload = async () => {
        if (!processManager.isRunning()) {
            await launch();
            return;
        }

        if (hotManager.isHotReloadEnabled()) {
            // hot.lua is polling, no action needed from extension side
            // (could add a TCP nudge here in the future)
            return;
        }

        // Mode 1: Restart
        await launch();
    };

    const launch = async () => {
        const config = vscode.workspace.getConfiguration('love2d');
        const executablePath = config.get<string>('executablePath') || '';
        
        const success = await processManager.launch(workspaceRoot, executablePath);
        if (success) {
            updateStatusBar();
        }
    };

    const stop = async () => {
        await processManager.stop();
        updateStatusBar();
    };

    const updateStatusBar = () => {
        if (!processManager.isRunning()) {
            statusBar.update(ExtensionState.Stopped);
        } else if (hotManager.isHotReloadEnabled()) {
            statusBar.update(ExtensionState.RunningHotSwap);
        } else {
            statusBar.update(ExtensionState.Runningrestart);
        }
    };

    const watcher = new FileWatcher(reload);

    // Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('love2d.launch', launch),
        vscode.commands.registerCommand('love2d.stop', stop),
        vscode.commands.registerCommand('love2d.reload', reload),
        vscode.commands.registerCommand('love2d.enableHotReload', async () => {
            const templatePath = path.join(context.extensionPath, 'assets', 'hot.lua');
            const template = fs.readFileSync(templatePath, 'utf8');
            await hotManager.enableHotReload(template);
            updateStatusBar();
        }),
        vscode.commands.registerCommand('love2d.disableHotReload', async () => {
            await hotManager.disableHotReload();
            updateStatusBar();
        })
    );

    context.subscriptions.push(processManager, statusBar, watcher);
}

export function deactivate() {}
