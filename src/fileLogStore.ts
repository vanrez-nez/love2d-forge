import * as fs from 'fs';
import * as path from 'path';

export class FileLogStore {
    private readonly lines: string[] = [];
    private flushTimer: NodeJS.Timeout | null = null;
    private partialLine = '';
    private isActive = false;

    constructor(
        private readonly filePath: string,
        private readonly maxLines = 1000
    ) { }

    public setActive(active: boolean): void {
        this.isActive = active;
    }

    public async clear(header?: string): Promise<void> {
        this.lines.length = 0;
        this.partialLine = '';
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (header) {
            this.lines.push(header);
        }
        await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.promises.writeFile(this.filePath, header ? `${header}\n` : '', 'utf8');
    }

    public write(line: string): void {
        if (!this.isActive) {
            return;
        }
        this.lines.push(line);
        if (this.lines.length > this.maxLines) {
            this.lines.splice(0, this.lines.length - this.maxLines);
        }
        this.scheduleFlush();
    }

    public appendChunk(chunk: string): void {
        if (!chunk || !this.isActive) {
            return;
        }

        const normalized = chunk.replace(/\r\n/g, '\n');
        const parts = normalized.split('\n');
        parts[0] = `${this.partialLine}${parts[0]}`;

        for (let index = 0; index < parts.length - 1; index += 1) {
            this.write(parts[index]);
        }

        this.partialLine = parts[parts.length - 1] ?? '';
        this.scheduleFlush();
    }

    public async initialize(): Promise<void> {
        await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
        try {
            const content = await fs.promises.readFile(this.filePath, 'utf8');
            const existingLines = content.split(/\r?\n/).filter((line) => line.length > 0);
            this.lines.push(...existingLines.slice(-this.maxLines));
        } catch {
            await fs.promises.writeFile(this.filePath, '', 'utf8');
        }
    }

    public async flush(): Promise<void> {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }

        if (this.partialLine.length > 0) {
            this.write(this.partialLine);
            this.partialLine = '';
            if (this.flushTimer) {
                clearTimeout(this.flushTimer);
                this.flushTimer = null;
            }
        }

        await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
        const tempPath = `${this.filePath}.tmp`;
        const content = this.lines.join('\n');
        await fs.promises.writeFile(tempPath, content, 'utf8');
        await fs.promises.rename(tempPath, this.filePath);
    }

    private scheduleFlush(): void {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
        }

        this.flushTimer = setTimeout(() => {
            void this.flush();
        }, 150);
    }
}
