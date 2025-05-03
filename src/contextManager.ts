// src/contextManager.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as config from './config';
import { LollmsClient } from './lollmsClient';

const CONTEXT_URIS_KEY = 'lollmsContextUris';
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB limit per file
const FALLBACK_CONTEXT_SIZE_TOKENS = 128 * 1024; // Fallback if server/binding info unavailable
const APPROX_CHARS_PER_TOKEN = 4; // Rough estimation factor

/**
 * Attempts to guess the markdown language tag based on the file extension.
 * Returns an empty string if no common tag is found.
 */
function guessLanguageTag(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase().substring(1);
    const langMap: { [key: string]: string } = {
        'py': 'python', 'js': 'javascript', 'ts': 'typescript', 'java': 'java',
        'c': 'c', 'cpp': 'cpp', 'cs': 'csharp', 'go': 'go', 'rb': 'ruby',
        'php': 'php', 'swift': 'swift', 'kt': 'kotlin', 'rs': 'rust',
        'html': 'html', 'css': 'css', 'scss': 'scss', 'less': 'less',
        'json': 'json', 'yaml': 'yaml', 'yml': 'yaml', 'xml': 'xml',
        'sh': 'bash', 'bash': 'bash', 'zsh': 'bash', 'ps1': 'powershell',
        'md': 'markdown', 'txt': 'text', 'sql': 'sql', 'dockerfile': 'dockerfile',
        'makefile': 'makefile', 'gradle': 'gradle', 'groovy': 'groovy', 'lua': 'lua',
        'perl': 'perl', 'r': 'r', 'scala': 'scala', 'dart': 'dart', 'vue': 'vue',
    };
    return langMap[extension] || ''; // Return empty string if not found
}


/**
 * Manages the state of the context files for the LOLLMS Copilot extension.
 */
export class ContextManager {
    private _contextUris: Set<string>;
    private _context: vscode.ExtensionContext;
    private _lollmsClient: LollmsClient | null = null;
    private _cachedContextSizeLimit: number | null = null; // Cache the fetched limit per binding

    private _onContextDidChange: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onContextDidChange: vscode.Event<void> = this._onContextDidChange.event;

    /**
     * Creates an instance of ContextManager.
     */
    constructor(context: vscode.ExtensionContext, client?: LollmsClient | null) {
        this._context = context;
        this._lollmsClient = client || null;
        this._contextUris = new Set();
        this.loadFromState();
    }

    /**
     * Sets or updates the LOLLMS client instance used by the manager.
     */
    public setClient(client: LollmsClient | null): void {
        if (this._lollmsClient !== client) {
             this._lollmsClient = client;
             this._cachedContextSizeLimit = null; // Invalidate cache if client changes
             console.log(`ContextManager: LOLLMS Client instance ${client ? 'set/updated' : 'cleared'}.`);
        }
    }

    /**
     * Loads the list of context file URI strings from workspace state.
     */
    private loadFromState(): void {
        const uriStrings = this._context.workspaceState.get<string[]>(CONTEXT_URIS_KEY, []);
        this._contextUris = new Set(uriStrings);
        console.log(`ContextManager: Loaded ${this._contextUris.size} URIs from state.`);
    }

    /**
     * Saves the current list of context file URI strings to workspace state.
     */
    private async saveToState(): Promise<void> {
        const uriStrings = Array.from(this._contextUris);
        try {
            await this._context.workspaceState.update(CONTEXT_URIS_KEY, uriStrings);
            console.log(`ContextManager: Saved ${uriStrings.length} URIs to state.`);
        } catch (error) {
            console.error("ContextManager: Failed to save workspace state:", error);
            vscode.window.showErrorMessage("Failed to save LOLLMS context state.");
        }
    }

    /**
     * Adds a file URI to the managed context.
     */
    public async addUri(uri: vscode.Uri): Promise<boolean> {
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

    /**
     * Removes a file URI from the managed context.
     */
    public async removeUri(uri: vscode.Uri): Promise<boolean> {
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

    /**
     * Removes all file URIs from the managed context.
     */
    public async clearAll(): Promise<void> {
        if (this._contextUris.size > 0) {
            this._contextUris.clear();
            await this.saveToState();
            this._onContextDidChange.fire();
            console.log("ContextManager: Cleared all context URIs.");
        } else {
            console.log("ContextManager: Context already empty.");
        }
    }

    /**
     * Returns a snapshot of the current context file URIs as a read-only array.
     */
    public getContextUris(): readonly vscode.Uri[] {
        return Object.freeze(Array.from(this._contextUris).map(uriString => vscode.Uri.parse(uriString)));
    }

    /**
     * Fetches the effective context size (in tokens) from the lollms-server for the default binding, using caching.
     * Uses the fallback value if the server doesn't provide info, fetching fails, or the default binding is not set.
     * @returns The context size in tokens.
     */
    public async getContextSizeLimit(): Promise<number> {
        // Return cached value if available
        if (this._cachedContextSizeLimit !== null) {
            return this._cachedContextSizeLimit;
        }

        const defaultBinding = config.getDefaultBindingInstance();
        if (!defaultBinding) {
             console.warn("ContextManager: Cannot fetch context size, 'lollms.defaultBindingInstance' not configured. Using fallback.");
             this._cachedContextSizeLimit = FALLBACK_CONTEXT_SIZE_TOKENS; // Cache fallback
             return this._cachedContextSizeLimit;
        }

        if (!this._lollmsClient) {
            console.warn("ContextManager: Cannot fetch context size, LOLLMS client not available. Using fallback.");
            this._cachedContextSizeLimit = FALLBACK_CONTEXT_SIZE_TOKENS; // Cache fallback
            return this._cachedContextSizeLimit;
        }

        try {
            // Fetch model info for the configured default binding
            const modelInfo = await this._lollmsClient.getModelInfo(defaultBinding);
            if (modelInfo && typeof modelInfo.context_size === 'number' && modelInfo.context_size > 0) {
                console.log(`ContextManager: Fetched context size limit from server for binding '${defaultBinding}': ${modelInfo.context_size} tokens.`);
                this._cachedContextSizeLimit = modelInfo.context_size; // Cache successful fetch
                return this._cachedContextSizeLimit;
            } else {
                console.warn(`ContextManager: Invalid or missing context size from server for binding '${defaultBinding}' (${modelInfo?.context_size}), using fallback ${FALLBACK_CONTEXT_SIZE_TOKENS}.`);
                this._cachedContextSizeLimit = FALLBACK_CONTEXT_SIZE_TOKENS; // Cache fallback
                return this._cachedContextSizeLimit;
            }
        } catch (error) {
            console.error(`ContextManager: Error fetching context size from server for binding '${defaultBinding}', using fallback:`, error);
            this._cachedContextSizeLimit = FALLBACK_CONTEXT_SIZE_TOKENS; // Cache fallback
            return this._cachedContextSizeLimit;
        }
    }


    /**
     * Builds the context string using the managed files, formatted with headers and code fences.
     * Reads file content, checks individual file limits, formats, and estimates character count.
     * @returns An object containing the formatted context string, file count, character count, estimated token count, and skipped files list.
     */
    public async buildContextStringFromManagedFiles(): Promise<{ context: string; fileCount: number; charCount: number; estimatedTokens: number; skippedFiles: string[] }> {
        const uris = this.getContextUris();
        const includePaths = config.shouldIncludeFilePathsInContext();
        console.log(`ContextManager: Building formatted context string from ${uris.length} managed files. Include paths: ${includePaths}`);

        let contextStringAccumulator = "";
        let totalCharacterCount = 0;
        let includedFileCount = 0;
        const skippedFilePaths: string[] = [];

        for (const uri of uris) {
            const relativePath = vscode.workspace.asRelativePath(uri, false);
            try {
                const stats = await vscode.workspace.fs.stat(uri);

                if (stats.type !== vscode.FileType.File) { skippedFilePaths.push(`${relativePath} (Not a file)`); continue; }
                if (stats.size === 0) { skippedFilePaths.push(`${relativePath} (Empty file)`); continue; } // Skip empty files
                if (stats.size > MAX_FILE_SIZE_BYTES) { const mb = (stats.size / 1024 / 1024).toFixed(1); skippedFilePaths.push(`${relativePath} (Too large > ${Math.round(MAX_FILE_SIZE_BYTES/1024/1024)}MB)`); continue; }

                const fileContentBytes = await vscode.workspace.fs.readFile(uri);
                // Basic binary check (look for null bytes)
                if (fileContentBytes.includes(0)) { skippedFilePaths.push(`${relativePath} (Likely binary)`); continue; }

                const fileContent = Buffer.from(fileContentBytes).toString('utf-8');
                const languageTag = guessLanguageTag(uri.fsPath);
                const pathHeader = includePaths ? `--- File: ${relativePath} ---\n` : ''; // Add path header if enabled
                const codeBlockHeader = "```" + languageTag + "\n"; // Use guessed language tag
                const codeBlockFooter = "\n```\n\n"; // Add extra newline for spacing

                const contentToAdd = pathHeader + codeBlockHeader + fileContent.trim() + codeBlockFooter; // Trim content before adding
                const currentContentLength = contentToAdd.length;

                // --- Accumulate Context ---
                contextStringAccumulator += contentToAdd;
                totalCharacterCount += currentContentLength;
                includedFileCount++;

            } catch (error: any) {
                console.error(`ContextManager: Error processing file ${relativePath} for context:`, error);
                skippedFilePaths.push(`${relativePath} (Read error: ${error.message})`);
            }
        }

        const finalContext = contextStringAccumulator.trimEnd(); // Remove trailing whitespace/newlines
        const estimatedTokenCount = Math.ceil(finalContext.length / APPROX_CHARS_PER_TOKEN);

        console.log(`ContextManager: Built formatted context string - Chars: ${totalCharacterCount}, Est Tokens: ${estimatedTokenCount}, Files Included: ${includedFileCount}, Skipped: ${skippedFilePaths.length}.`);
        return {
            context: finalContext,
            fileCount: includedFileCount,
            charCount: totalCharacterCount,
            estimatedTokens: estimatedTokenCount,
            skippedFiles: skippedFilePaths
        };
    }
}