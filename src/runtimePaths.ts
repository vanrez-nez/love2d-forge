import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

function getWorkspaceHash(workspaceRoot: string): string {
    return crypto.createHash('sha1').update(workspaceRoot).digest('hex').slice(0, 8);
}

export function getBootstrapDir(workspaceRoot: string): string {
    return path.join(os.tmpdir(), `love2d-hot-${getWorkspaceHash(workspaceRoot)}`);
}

export function getBridgePortFile(workspaceRoot: string): string {
    return path.join(os.tmpdir(), `love2d-hot-${getWorkspaceHash(workspaceRoot)}.port`);
}

export function getStartupErrorFile(workspaceRoot: string): string {
    return path.join(os.tmpdir(), `love2d-hot-${getWorkspaceHash(workspaceRoot)}.startup-error.log`);
}
