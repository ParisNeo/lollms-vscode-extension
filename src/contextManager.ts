// src/contextManager.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as config from './config'; // Import config for threshold and token factor
import { LollmsClient } from './lollmsClient';

const CONTEXT_URIS_KEY = 'lollmsContextUris';
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
// Make fallback size easily accessible if needed externally, though getContextSizeLimit is preferred
export const FALLBACK_CONTEXT_SIZE_TOKENS = 32000; // Updated fallback as requested
// APPROX_CHARS_PER_TOKEN is now imported from config

export class ContextManager {
    private _contextUris: Set<string>;
    private _context: vscode.ExtensionContext;
    private _lollmsClient: LollmsClient | null = null;
    private _cachedContextSizeLimit: number | null = null;

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

    private loadFromState(): void {
        const uriStrings = this._context.workspaceState.get<string[]>(CONTEXT_URIS_KEY, []);
        this._contextUris = new Set(uriStrings);
        console.log(`ContextManager: Loaded ${this._contextUris.size} URIs from state.`);
    }

    private async saveToState(): Promise<void> {
         const uriStrings = Array.from(this._contextUris);
        try {
            await this._context.workspaceState.update(CONTEXT_URIS_KEY, uriStrings);
            // console.log(`ContextManager: Saved ${uriStrings.length} URIs to state.`); // Less verbose logging
        } catch (error) {
            console.error("ContextManager: Failed to save workspace state:", error);
            vscode.window.showErrorMessage("Failed to save LOLLMS context state.");
        }
    }

    // addUri, removeUri, clearAll (keep existing implementations)
     public async addUri(uri: vscode.Uri): Promise<boolean> {
         const uriString = uri.toString();
         if (!this._contextUris.has(uriString)) {
             this._contextUris.add(uriString);
             await this.saveToState();
             this._onContextDidChange.fire();
             return true;
         }
         return false;
      }

     public async removeUri(uri: vscode.Uri): Promise<boolean> {
         const uriString = uri.toString();
         if (this._contextUris.has(uriString)) {
             this._contextUris.delete(uriString);
             await this.saveToState();
             this._onContextDidChange.fire();
             return true;
         }
         return false;
     }

     public async clearAll(): Promise<void> {
         if (this._contextUris.size > 0) {
             this._contextUris.clear();
             await this.saveToState();
             this._onContextDidChange.fire();
         }
      }


    public getContextUris(): readonly vscode.Uri[] {
        return Object.freeze(Array.from(this._contextUris).map(uriString => vscode.Uri.parse(uriString)));
    }

    /**
     * Fetches the context size (in tokens) of the server's default TTT binding, using caching.
     * Uses the fallback value if the server doesn't provide info or fetching fails.
     * @returns The context size in tokens.
     */
    public async getContextSizeLimit(): Promise<number> {
        if (this._cachedContextSizeLimit !== null) {
            return this._cachedContextSizeLimit;
        }

        if (!this._lollmsClient) {
            console.warn("ContextManager: Cannot fetch context size, client not available. Using fallback.");
            this._cachedContextSizeLimit = FALLBACK_CONTEXT_SIZE_TOKENS;
            return this._cachedContextSizeLimit;
        }

        try {
            // Fetch default TTT context length directly
            const contextLength = await this._lollmsClient.getDefaultTttContextLength();

            if (contextLength !== null && contextLength > 0) {
                console.log(`ContextManager: Fetched default TTT context size limit: ${contextLength} tokens.`);
                this._cachedContextSizeLimit = contextLength;
                return this._cachedContextSizeLimit;
            } else {
                console.warn(`ContextManager: Invalid context size from server (${contextLength}), using fallback ${FALLBACK_CONTEXT_SIZE_TOKENS}.`);
                this._cachedContextSizeLimit = FALLBACK_CONTEXT_SIZE_TOKENS;
                return this._cachedContextSizeLimit;
            }
        } catch (error) {
            console.error(`ContextManager: Error fetching default context size, using fallback:`, error);
            this._cachedContextSizeLimit = FALLBACK_CONTEXT_SIZE_TOKENS;
            return this._cachedContextSizeLimit;
        }
    }

    /**
     * Checks if the estimated prompt size exceeds thresholds and prompts the user for confirmation if needed.
     * @param estimatedCharCount The estimated character count of the full prompt.
     * @returns `true` if the user confirms or if the size is within limits, `false` if the user cancels.
     */
    public async checkAndConfirmContextSize(estimatedCharCount: number): Promise<boolean> {
        const warningThresholdChars = config.getContextCharWarningThreshold();

        // Skip confirmation if below the warning threshold
        if (estimatedCharCount <= warningThresholdChars) {
            return true;
        }

        const estimatedTokens = Math.ceil(estimatedCharCount / config.APPROX_CHARS_PER_TOKEN);
        // Fetch the actual limit (uses cache if available)
        const actualTokenLimit = await this.getContextSizeLimit();

        let message = `The estimated prompt size (~${estimatedCharCount} chars / ~${estimatedTokens} tokens) exceeds the warning threshold (${warningThresholdChars} chars).`;

        if (actualTokenLimit && actualTokenLimit !== FALLBACK_CONTEXT_SIZE_TOKENS) {
            message += `\nThe current model's context limit is ~${actualTokenLimit} tokens.`;
            if (estimatedTokens > actualTokenLimit) {
                message += `\n\n🚨 WARNING: Estimated size may exceed model limit! Generation could fail or be truncated.`;
            } else {
                message += `\nIt might fit within the limit, but could be slow/costly.`;
            }
        } else {
             message += `\nCould not verify against the actual model limit (using fallback: ${FALLBACK_CONTEXT_SIZE_TOKENS} or failed fetch).`;
        }
        message += `\n\nProceed anyway?`;

        const userChoice = await vscode.window.showWarningMessage(
            message,
            { modal: true }, // Make the dialog modal
            'Proceed',
            'Cancel'
        );

        return userChoice === 'Proceed';
    }


    // buildContextStringFromManagedFiles (keep existing implementation)
    public async buildContextStringFromManagedFiles(): Promise<{ context: string; fileCount: number; charCount: number; estimatedTokens: number; skippedFiles: string[] }> {
        const uris = this.getContextUris();
        const includePaths = config.shouldIncludeFilePathsInContext();
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
                // Basic binary check (look for null bytes) - can be improved
                if (fileContentBytes.includes(0)) { skippedFilePaths.push(`${relativePath} (Likely binary)`); continue; }

                const fileContent = Buffer.from(fileContentBytes).toString('utf-8');
                const languageTag = guessLanguageTag(uri.fsPath);
                const pathHeader = includePaths ? `--- File: ${relativePath} ---\n` : '';
                const codeBlockHeader = "```" + languageTag + "\n";
                const codeBlockFooter = "\n```\n\n"; // Add double newline for separation
                const contentToAdd = pathHeader + codeBlockHeader + fileContent.trim() + codeBlockFooter;
                const currentContentLength = contentToAdd.length;

                contextStringAccumulator += contentToAdd;
                totalCharacterCount += currentContentLength;
                includedFileCount++;
            } catch (error: any) {
                console.error(`ContextManager: Error processing file ${relativePath} for context:`, error);
                skippedFilePaths.push(`${relativePath} (Read error: ${error.message || 'Unknown'})`);
            }
        }
        const finalContext = contextStringAccumulator.trimEnd(); // Trim trailing whitespace/newlines
        const estimatedTokenCount = Math.ceil(finalContext.length / config.APPROX_CHARS_PER_TOKEN);
        // console.log(`ContextManager: Built context string - Chars: ${totalCharacterCount}, Est Tokens: ${estimatedTokenCount}, Files Included: ${includedFileCount}, Skipped: ${skippedFilePaths.length}.`);
        return { context: finalContext, fileCount: includedFileCount, charCount: totalCharacterCount, estimatedTokens: estimatedTokenCount, skippedFiles: skippedFilePaths };
    }
}

// Helper function defined locally or imported
function guessLanguageTag(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase().substring(1);
    // Add more mappings as needed
    const langMap: { [key: string]: string } = {
         'py': 'python', 'js': 'javascript', 'ts': 'typescript', 'java': 'java',
         'c': 'c', 'cpp': 'cpp', 'cs': 'csharp', 'go': 'go', 'rb': 'ruby',
         'php': 'php', 'html': 'html', 'css': 'css', 'scss': 'scss', 'json': 'json',
         'yaml': 'yaml', 'yml': 'yaml', 'xml': 'xml', 'sh': 'bash', 'md': 'markdown',
         'txt': '', '': '' // Default to empty for text or no extension
    };
    return langMap[extension] ?? ''; // Use nullish coalescing for safety
}