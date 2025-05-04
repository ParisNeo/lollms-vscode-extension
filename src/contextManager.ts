// src/contextManager.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as config from './config';
import { LollmsClient } from './lollmsClient';

const CONTEXT_URIS_KEY = 'lollmsContextUris';
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const FALLBACK_CONTEXT_SIZE_TOKENS = 8 * 1024; // Lower fallback if server info fails
const APPROX_CHARS_PER_TOKEN = config.APPROX_CHARS_PER_TOKEN;

// guessLanguageTag function remains the same

export class ContextManager {
    private _contextUris: Set<string>;
    private _context: vscode.ExtensionContext;
    private _lollmsClient: LollmsClient | null = null;
    private _cachedContextSizeLimit: number | null = null; // Cache the fetched *default* limit

    private _onContextDidChange: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onContextDidChange: vscode.Event<void> = this._onContextDidChange.event;

    constructor(context: vscode.ExtensionContext, client?: LollmsClient | null) {
        this._context = context;
        this._lollmsClient = client || null;
        this._contextUris = new Set();
        this.loadFromState();
    }

    public setClient(client: LollmsClient | null): void {
        if (this._lollmsClient !== client) {
             this._lollmsClient = client;
             this._cachedContextSizeLimit = null; // Invalidate cache if client changes
             console.log(`ContextManager: LOLLMS Client instance ${client ? 'set/updated' : 'cleared'}.`);
        }
    }

    private loadFromState(): void { /* ... same ... */
        const uriStrings = this._context.workspaceState.get<string[]>(CONTEXT_URIS_KEY, []);
        this._contextUris = new Set(uriStrings);
        console.log(`ContextManager: Loaded ${this._contextUris.size} URIs from state.`);
    }

    private async saveToState(): Promise<void> { /* ... same ... */
         const uriStrings = Array.from(this._contextUris);
        try {
            await this._context.workspaceState.update(CONTEXT_URIS_KEY, uriStrings);
            console.log(`ContextManager: Saved ${uriStrings.length} URIs to state.`);
        } catch (error) {
            console.error("ContextManager: Failed to save workspace state:", error);
            vscode.window.showErrorMessage("Failed to save LOLLMS context state.");
        }
    }

    public async addUri(uri: vscode.Uri): Promise<boolean> { /* ... same ... */
        const uriString = uri.toString();
        if (!this._contextUris.has(uriString)) {
            this._contextUris.add(uriString);
            await this.saveToState();
            this._onContextDidChange.fire();
            console.log(`ContextManager: Added URI - ${uri.fsPath}`);
            return true;
        }
        console.log(`ContextManager: URI already present - ${uri.fsPath}`);
        return false;
     }

    public async removeUri(uri: vscode.Uri): Promise<boolean> { /* ... same ... */
        const uriString = uri.toString();
        if (this._contextUris.has(uriString)) {
            this._contextUris.delete(uriString);
            await this.saveToState();
            this._onContextDidChange.fire();
            console.log(`ContextManager: Removed URI - ${uri.fsPath}`);
            return true;
        }
        console.log(`ContextManager: URI not found for removal - ${uri.fsPath}`);
        return false;
    }

    public async clearAll(): Promise<void> { /* ... same ... */
        if (this._contextUris.size > 0) {
            this._contextUris.clear();
            await this.saveToState();
            this._onContextDidChange.fire();
            console.log("ContextManager: Cleared all context URIs.");
        } else {
            console.log("ContextManager: Context already empty.");
        }
     }

    public getContextUris(): readonly vscode.Uri[] { /* ... same ... */
        return Object.freeze(Array.from(this._contextUris).map(uriString => vscode.Uri.parse(uriString)));
    }

    /**
     * Fetches the context size (in tokens) of the server's default TTT binding, using caching.
     * Uses the fallback value if the server doesn't provide info or fetching fails.
     * @returns The context size in tokens.
     */
    public async getContextSizeLimit(): Promise<number> {
        // Return cached value if available
        if (this._cachedContextSizeLimit !== null) {
            console.debug(`ContextManager: Returning cached context size limit: ${this._cachedContextSizeLimit}`);
            return this._cachedContextSizeLimit;
        }

        // No longer need default binding instance name from config

        if (!this._lollmsClient) {
            console.warn("ContextManager: Cannot fetch context size, LOLLMS client not available. Using fallback.");
            this._cachedContextSizeLimit = FALLBACK_CONTEXT_SIZE_TOKENS;
            return this._cachedContextSizeLimit;
        }

        try {
            // Fetch default TTT context length directly
            const contextLength = await this._lollmsClient.getDefaultTttContextLength();

            if (contextLength !== null && contextLength > 0) {
                console.log(`ContextManager: Fetched default TTT context size limit from server: ${contextLength} tokens.`);
                this._cachedContextSizeLimit = contextLength; // Cache successful fetch
                return this._cachedContextSizeLimit;
            } else {
                console.warn(`ContextManager: Invalid or missing default TTT context size from server (${contextLength}), using fallback ${FALLBACK_CONTEXT_SIZE_TOKENS}.`);
                this._cachedContextSizeLimit = FALLBACK_CONTEXT_SIZE_TOKENS; // Cache fallback
                return this._cachedContextSizeLimit;
            }
        } catch (error) {
            console.error(`ContextManager: Error fetching default TTT context size from server, using fallback:`, error);
            this._cachedContextSizeLimit = FALLBACK_CONTEXT_SIZE_TOKENS; // Cache fallback
            return this._cachedContextSizeLimit;
        }
    }

    // buildContextStringFromManagedFiles function remains the same
    public async buildContextStringFromManagedFiles(): Promise<{ context: string; fileCount: number; charCount: number; estimatedTokens: number; skippedFiles: string[] }> {
        // ... (Implementation remains the same as previous version) ...
        const uris = this.getContextUris();
        const includePaths = config.shouldIncludeFilePathsInContext();
        console.log(`ContextManager: Building formatted context string from ${uris.length} managed files. Include paths: ${includePaths}`);
        // ... rest of loop and calculation logic ...
        let contextStringAccumulator = "";
        let totalCharacterCount = 0;
        let includedFileCount = 0;
        const skippedFilePaths: string[] = [];

        for (const uri of uris) {
            const relativePath = vscode.workspace.asRelativePath(uri, false);
            try {
                const stats = await vscode.workspace.fs.stat(uri);
                if (stats.type !== vscode.FileType.File) { skippedFilePaths.push(`${relativePath} (Not a file)`); continue; }
                if (stats.size === 0) { skippedFilePaths.push(`${relativePath} (Empty file)`); continue; }
                if (stats.size > MAX_FILE_SIZE_BYTES) { const mb = (stats.size / 1024 / 1024).toFixed(1); skippedFilePaths.push(`${relativePath} (Too large > ${Math.round(MAX_FILE_SIZE_BYTES/1024/1024)}MB)`); continue; }
                const fileContentBytes = await vscode.workspace.fs.readFile(uri);
                if (fileContentBytes.includes(0)) { skippedFilePaths.push(`${relativePath} (Likely binary)`); continue; }
                const fileContent = Buffer.from(fileContentBytes).toString('utf-8');
                const languageTag = guessLanguageTag(uri.fsPath); // guessLanguageTag needs to be defined or imported
                const pathHeader = includePaths ? `--- File: ${relativePath} ---\n` : '';
                const codeBlockHeader = "```" + languageTag + "\n";
                const codeBlockFooter = "\n```\n\n";
                const contentToAdd = pathHeader + codeBlockHeader + fileContent.trim() + codeBlockFooter;
                const currentContentLength = contentToAdd.length;
                contextStringAccumulator += contentToAdd;
                totalCharacterCount += currentContentLength;
                includedFileCount++;
            } catch (error: any) {
                console.error(`ContextManager: Error processing file ${relativePath} for context:`, error);
                skippedFilePaths.push(`${relativePath} (Read error: ${error.message})`);
            }
        }
        const finalContext = contextStringAccumulator.trimEnd();
        const estimatedTokenCount = Math.ceil(finalContext.length / APPROX_CHARS_PER_TOKEN);
        console.log(`ContextManager: Built formatted context string - Chars: ${totalCharacterCount}, Est Tokens: ${estimatedTokenCount}, Files Included: ${includedFileCount}, Skipped: ${skippedFilePaths.length}.`);
        return { context: finalContext, fileCount: includedFileCount, charCount: totalCharacterCount, estimatedTokens: estimatedTokenCount, skippedFiles: skippedFilePaths };
    }
}

// Helper function defined locally or imported
function guessLanguageTag(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase().substring(1);
    const langMap: { [key: string]: string } = { 'py': 'python', 'js': 'javascript', /* ... add more ... */ 'ts': 'typescript', 'md': 'markdown', 'txt': 'text', '': '' };
    return langMap[extension] || '';
}