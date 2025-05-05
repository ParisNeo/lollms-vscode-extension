// src/chatViewProvider.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises'; // Use promises version of fs for async operations
import { LollmsClient, LollmsGeneratePayload, LollmsInputDataItem } from './lollmsClient';
import { ContextManager } from './contextManager';
import * as config from './config';
import * as editorUtils from './editorUtils';

// --- Interfaces ---

interface ChatMessage {
    sender: 'user' | 'assistant' | 'system';
    content: string;
    type: 'text' | 'code' | 'error' | 'info';
    rawContent?: string;
    timestamp: number;
}

interface Discussion {
    id: string; // Unique ID (e.g., timestamp based)
    title: string; // Display title (e.g., first user message or timestamp)
    createdAt: number;
    messages: ChatMessage[];
}

// --- Provider Class ---

export class ChatViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'lollmsChatView';

    private _view?: vscode.WebviewView;
    private _isGenerating: boolean = false;
    private _lollmsClient: LollmsClient | null = null;
    private _activeDiscussionId: string | null = null;
    private _discussions: Map<string, Discussion> = new Map(); // Store loaded discussions by ID

    // Keep references to shared instances
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _extensionContext: vscode.ExtensionContext, // Need context for state
        private _contextManager: ContextManager // Need context manager
    ) {
        this._contextManager.onContextDidChange(() => {
            this._sendMessageToWebview({
                type: 'contextUpdated',
                payload: { fileCount: this._contextManager.getContextUris().length }
            });
        });

        // Listen for configuration changes that might affect the save folder
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('lollms.chatSaveFolder')) {
                // Re-evaluate save directory (might require reloading discussions if path changes significantly)
                console.log("Chat save folder configuration changed.");
                // For simplicity, we might just inform the user or require a reload for major path changes.
            }
        });
    }

    // Method to update the client if it changes after initialization
    public updateClient(client: LollmsClient | null) {
        if (this._lollmsClient !== client) {
            this._lollmsClient = client;
            console.log("ChatViewProvider: LOLLMS Client instance updated.");
            this._updateStatus(client ? "Ready" : "Client disconnected", !client);
        }
    }

    // --- Webview Resolution ---

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'media'),
                vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons') // Allow codicons
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            async message => {
                console.log("ChatViewProvider received message:", message.command);
                switch (message.command) {
                    case 'sendMessage':
                        await this.handleSendMessage(message.payload?.text); return;
                    case 'getViewState':
                        await this._loadDiscussions(); // Load discussions when view requests state
                        this.sendCurrentStateToWebview(); return;
                    case 'copyCode':
                        if (message.payload?.code) { vscode.env.clipboard.writeText(message.payload.code); vscode.window.showInformationMessage("Code block copied."); } return;
                    case 'newDiscussion':
                        await this.startNewDiscussion(); return;
                    case 'switchDiscussion':
                        await this.switchDiscussion(message.payload?.discussionId); return;
                    case 'deleteDiscussion':
                        await this.deleteDiscussion(message.payload?.discussionId); return;
                    case 'setTitle': // Optional: Allow webview to suggest title update
                        await this.updateDiscussionTitle(this._activeDiscussionId, message.payload?.title); return;
                }
            },
            undefined,
            this._extensionContext.subscriptions // Use extension context subscriptions
        );

        webviewView.onDidDispose(() => { this._view = undefined; }, null, this._extensionContext.subscriptions);

        // Load existing discussions when the view is first resolved
        await this._loadDiscussions();
        // Determine initial active discussion (e.g., last active or newest)
        if (!this._activeDiscussionId && this._discussions.size > 0) {
             // Sort discussions by creation time descending to get the newest
            const sortedDiscussions = Array.from(this._discussions.values()).sort((a, b) => b.createdAt - a.createdAt);
            this._activeDiscussionId = sortedDiscussions[0].id;
            console.log(`ChatViewProvider: Auto-selected newest discussion '${this._activeDiscussionId}' as active.`);
        } else if (!this._activeDiscussionId) {
            // If no discussions exist, start a new one automatically
            await this.startNewDiscussion();
        }

        console.log("ChatViewProvider: Webview resolved.");
        this.sendCurrentStateToWebview(); // Send initial state after loading
    }

    // --- Discussion Management ---

    private _generateNewDiscussionId(): string {
        const now = new Date();
        // Format: chat_YYYYMMDD_HHMMSS_ms
        return `chat_${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}_${now.getMilliseconds().toString().padStart(3, '0')}`;
    }

    private async _getChatSaveDirUri(): Promise<vscode.Uri | null> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            // Cannot save without a workspace folder
            this._updateStatus("Cannot save chat: No workspace open.", true);
            return null;
        }
        const workspaceRoot = workspaceFolders[0].uri;
        const relativePath = config.getChatSaveFolder();
        const saveDirUri = vscode.Uri.joinPath(workspaceRoot, relativePath);

        // Ensure the directory exists
        try {
            await vscode.workspace.fs.createDirectory(saveDirUri);
            return saveDirUri;
        } catch (error: any) {
            console.error(`Failed to create or access chat save directory '${saveDirUri.fsPath}':`, error);
            this._updateStatus(`Error accessing chat save dir: ${error.message}`, true);
            vscode.window.showErrorMessage(`Could not create chat save directory: ${saveDirUri.fsPath}. Check permissions and the 'lollms.chatSaveFolder' setting.`);
            return null;
        }
    }

    private async _loadDiscussions(): Promise<void> {
        const saveDirUri = await this._getChatSaveDirUri();
        if (!saveDirUri) {
            this._discussions.clear(); // Clear existing if we can't access dir
            this._activeDiscussionId = null;
            return;
        }

        console.log(`ChatViewProvider: Loading discussions from ${saveDirUri.fsPath}`);
        this._discussions.clear(); // Clear previous map
        let loadedCount = 0;
        let failedCount = 0;

        try {
            const entries = await vscode.workspace.fs.readDirectory(saveDirUri);
            for (const [fileName, fileType] of entries) {
                if (fileType === vscode.FileType.File && fileName.endsWith('.json')) {
                    const fileUri = vscode.Uri.joinPath(saveDirUri, fileName);
                    try {
                        const contentBytes = await vscode.workspace.fs.readFile(fileUri);
                        const contentString = Buffer.from(contentBytes).toString('utf-8');
                        const discussion = JSON.parse(contentString) as Discussion;
                        // Basic validation
                        if (discussion && discussion.id && Array.isArray(discussion.messages)) {
                            this._discussions.set(discussion.id, discussion);
                            loadedCount++;
                        } else {
                            console.warn(`Skipping invalid discussion file: ${fileName}`);
                            failedCount++;
                        }
                    } catch (readError: any) {
                        console.error(`Error reading or parsing discussion file ${fileName}:`, readError);
                        failedCount++;
                    }
                }
            }
        } catch (error: any) {
            // Error reading directory - might not exist yet, which is fine on first load
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                 console.log(`Chat save directory '${saveDirUri.fsPath}' not found. Will be created on first save.`);
            } else {
                console.error(`Error reading chat save directory ${saveDirUri.fsPath}:`, error);
                this._updateStatus(`Error reading chats: ${error.message}`, true);
            }
        }
        console.log(`ChatViewProvider: Loaded ${loadedCount} discussions, failed ${failedCount}.`);
    }

    private async _saveDiscussion(discussionId: string | null): Promise<boolean> {
        if (!discussionId || !this._discussions.has(discussionId)) {
            console.warn(`Attempted to save non-existent or inactive discussion: ${discussionId}`);
            return false;
        }
        const saveDirUri = await this._getChatSaveDirUri();
        if (!saveDirUri) return false; // Error shown by getChatSaveDirUri

        const discussion = this._discussions.get(discussionId);
        if (!discussion) return false; // Should not happen if ID is valid

        const fileName = `${discussion.id}.json`;
        const fileUri = vscode.Uri.joinPath(saveDirUri, fileName);
        try {
            const contentString = JSON.stringify(discussion, null, 2); // Pretty print JSON
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(contentString, 'utf-8'));
            console.log(`ChatViewProvider: Saved discussion '${discussionId}' to ${fileUri.fsPath}`);
            return true;
        } catch (error: any) {
            console.error(`Error saving discussion '${discussionId}' to ${fileUri.fsPath}:`, error);
            this._updateStatus(`Error saving chat: ${error.message}`, true);
            vscode.window.showErrorMessage(`Failed to save chat: ${error.message}`);
            return false;
        }
    }

    private async _deleteDiscussionFile(discussionId: string): Promise<boolean> {
        const saveDirUri = await this._getChatSaveDirUri();
        if (!saveDirUri || !this._discussions.has(discussionId)) return false;

        const fileName = `${discussionId}.json`;
        const fileUri = vscode.Uri.joinPath(saveDirUri, fileName);
        try {
            await vscode.workspace.fs.delete(fileUri);
            console.log(`ChatViewProvider: Deleted discussion file ${fileUri.fsPath}`);
            return true;
        } catch (error: any) {
            console.error(`Error deleting discussion file ${fileUri.fsPath}:`, error);
             this._updateStatus(`Error deleting chat: ${error.message}`, true);
             vscode.window.showErrorMessage(`Failed to delete chat file: ${error.message}`);
            return false;
        }
    }

    public async startNewDiscussion(): Promise<void> {
        if (this._isGenerating) {
            vscode.window.showWarningMessage("Please wait for the current response to complete before starting a new discussion.");
            return;
        }
        // Save current discussion before switching (if one is active)
        await this._saveDiscussion(this._activeDiscussionId);

        const newId = this._generateNewDiscussionId();
        const now = Date.now();
        const newDiscussion: Discussion = {
            id: newId,
            title: `Discussion from ${new Date(now).toLocaleString()}`,
            createdAt: now,
            messages: [] // Start with empty history
        };
        this._discussions.set(newId, newDiscussion);
        this._activeDiscussionId = newId;
        console.log(`ChatViewProvider: Started new discussion '${newId}'`);

        // Save the newly created (empty) discussion file immediately
        await this._saveDiscussion(newId);

        this.sendCurrentStateToWebview(); // Update UI
        this._updateStatus("Ready");
    }

    public async switchDiscussion(discussionId: string | null): Promise<void> {
        if (!discussionId || !this._discussions.has(discussionId)) {
             vscode.window.showErrorMessage(`Discussion with ID '${discussionId}' not found.`);
             return;
        }
        if (this._isGenerating) {
             vscode.window.showWarningMessage("Please wait for the current response to complete before switching discussions.");
             return;
        }
        if (this._activeDiscussionId === discussionId) {
             console.log(`ChatViewProvider: Already on discussion '${discussionId}'.`);
             return; // No change needed
        }

        // Save current before switching
        await this._saveDiscussion(this._activeDiscussionId);

        this._activeDiscussionId = discussionId;
        console.log(`ChatViewProvider: Switched to discussion '${discussionId}'`);
        this.sendCurrentStateToWebview(); // Send new state (includes history of new active discussion)
        this._updateStatus("Ready");
    }

    public async deleteDiscussion(discussionId: string | null): Promise<void> {
        if (!discussionId || !this._discussions.has(discussionId)) {
             vscode.window.showErrorMessage(`Discussion with ID '${discussionId}' not found for deletion.`);
             return;
        }
         if (this._isGenerating && this._activeDiscussionId === discussionId) {
             vscode.window.showWarningMessage("Cannot delete the active discussion while generating a response.");
             return;
         }

        const discussionToDelete = this._discussions.get(discussionId);
        const choice = await vscode.window.showWarningMessage(
            `Permanently delete discussion "${discussionToDelete?.title}"?`,
            { modal: true },
            "Delete"
        );

        if (choice !== "Delete") return;

        const deleted = await this._deleteDiscussionFile(discussionId);
        if (deleted) {
            this._discussions.delete(discussionId);
            // If the deleted discussion was the active one, switch to another or start new
            if (this._activeDiscussionId === discussionId) {
                 const remainingIds = Array.from(this._discussions.keys());
                 if (remainingIds.length > 0) {
                     // Switch to the most recent remaining one
                     const sortedDiscussions = Array.from(this._discussions.values()).sort((a, b) => b.createdAt - a.createdAt);
                     await this.switchDiscussion(sortedDiscussions[0].id);
                 } else {
                     // No discussions left, start a new one
                     await this.startNewDiscussion();
                 }
            } else {
                // If a different discussion was deleted, just update the webview list
                 this.sendCurrentStateToWebview();
            }
             vscode.window.showInformationMessage(`Discussion "${discussionToDelete?.title}" deleted.`);
        }
    }

    public async updateDiscussionTitle(discussionId: string | null, newTitle: string | undefined) {
        if (!discussionId || !newTitle || !this._discussions.has(discussionId)) return;

        const discussion = this._discussions.get(discussionId);
        if (discussion) {
            discussion.title = newTitle.trim();
            await this._saveDiscussion(discussionId); // Save the title change
            // Send updated discussion list to webview
            this._sendMessageToWebview({
                type: 'updateDiscussionList',
                payload: { discussions: this.getDiscussionListForWebview() }
            });
        }
    }

    // --- Message Handling & Generation ---

    private async handleSendMessage(userMessageText: string | undefined) {
        if (!userMessageText || userMessageText.trim().length === 0) return;
        if (this._isGenerating) { this._addSystemMessage("Please wait...", 'error'); return; }
        if (!this._lollmsClient) { this._addSystemMessage("Client not configured.", 'error'); return; }
        if (!this._activeDiscussionId || !this._discussions.has(this._activeDiscussionId)) {
            this._addSystemMessage("No active discussion. Starting new one.", 'info');
            await this.startNewDiscussion(); // Start one if none is active
            if (!this._activeDiscussionId) { // Check again if starting failed
                this._addSystemMessage("Failed to start a new discussion.", 'error');
                return;
            }
        }

        this._isGenerating = true;
        const currentDiscussion = this._discussions.get(this._activeDiscussionId);
        if (!currentDiscussion) { // Should not happen, but safety check
            this._isGenerating = false;
            this._addSystemMessage("Internal error: Active discussion not found.", 'error');
            return;
        }

        this._addMessageToHistory({ sender: 'user', content: userMessageText, type: 'text', timestamp: Date.now() });
        this._sendMessageToWebview({ type: 'generationStatus', payload: { isGenerating: true } });
        this._updateStatus("Generating...");

        try {
            // 1. Build Context
            let formattedFileContext = "";
            let contextInfo = { charCount: 0, skippedFiles: [] as string[] }; // Simplified info needed here
             const contextUris = this._contextManager.getContextUris();
            if (contextUris.length > 0) {
                 this._updateStatus(`Building context (${contextUris.length} files)...`);
                 // Destructure to get only what's needed here
                 const { context, charCount, skippedFiles } = await this._contextManager.buildContextStringFromManagedFiles();
                 formattedFileContext = context;
                 contextInfo = { charCount, skippedFiles };
                 if (skippedFiles.length > 0) { this._addSystemMessage(`Note: Skipped ${skippedFiles.length} context file(s).`, 'info'); }
            }

            // 2. Build Payload (using current discussion history)
            const payload = this.buildChatPayload(formattedFileContext, currentDiscussion.messages); // Pass history

            // 3. Estimate Size & Confirm
            let totalEstimatedChars = contextInfo.charCount;
            currentDiscussion.messages.forEach(msg => { totalEstimatedChars += msg.content.length; }); // Include full history
            totalEstimatedChars += (config.getContextPromptPrefix() + config.getContextPromptSuffix()).length;
            // TODO: Replace with shared/refactored confirmLargeContext call
             const proceed = await this.confirmLargeContextLocally(totalEstimatedChars);
            if (!proceed) { throw new Error("Generation cancelled by user due to large prompt size."); }

            // 4. API Call
            this._updateStatus("Sending request...");
            const parameters = config.getDefaultModelParameters();
            const overrideBinding = config.getOverrideBindingInstance();
            const overrideModel = config.getOverrideModelName();
            const responseText = await this._lollmsClient.generate(payload, parameters, overrideBinding, overrideModel);

            if (responseText !== null) {
                this._addMessageToHistory({ sender: 'assistant', content: responseText, rawContent: responseText, type: 'text', timestamp: Date.now() });
                this._updateStatus("Ready");
                // Try to update title with first user message if it's the default title
                if (currentDiscussion.messages.length === 2 && currentDiscussion.title.startsWith("Discussion from")) { // User + Assistant = 2
                     await this.updateDiscussionTitle(this._activeDiscussionId, userMessageText.substring(0, 50) + (userMessageText.length > 50 ? "..." : ""));
                }
            } else {
                this._addSystemMessage('Failed to get response from LOLLMS server.', 'error');
                this._updateStatus("Error receiving response", true);
            }
        } catch (error: any) {
            console.error("Error during chat generation:", error);
            const errorMsg = `Chat Error: ${error.message || 'Unknown error'}`;
            this._addSystemMessage(errorMsg, 'error');
            this._updateStatus("Error during generation", true);
        } finally {
            this._isGenerating = false;
            this._sendMessageToWebview({ type: 'generationStatus', payload: { isGenerating: false } });
            // Save discussion after generation attempt (success or failure)
             await this._saveDiscussion(this._activeDiscussionId);
        }
    }

    /** Builds the LollmsGeneratePayload for chat, using provided history */
    private buildChatPayload(formattedContext: string, history: ChatMessage[]): LollmsGeneratePayload {
        const inputData: LollmsInputDataItem[] = [];
        inputData.push({ type: 'text', role: 'system_prompt', data: config.getContextPromptPrefix() });
        if (formattedContext) { inputData.push({ type: 'text', role: 'system_context', data: formattedContext }); }
        inputData.push({ type: 'text', role: 'system_prompt', data: config.getContextPromptSuffix() }); // Add suffix after context

        history.forEach(msg => {
            if (msg.sender === 'user') inputData.push({ type: 'text', role: 'user_prompt', data: msg.content });
            else if (msg.sender === 'assistant') inputData.push({ type: 'text', role: 'assistant_reply', data: msg.content });
        });
        // The last message in history is the one we are responding to (the user's latest message)

        return { input_data: inputData, generation_type: 'ttt' };
    }

    // TODO: Refactor this to use a shared utility or event bus
    private async confirmLargeContextLocally(charCount: number): Promise<boolean> {
        // ... (Implementation is the same as the previous version) ...
         const warningThresholdChars = config.getContextCharWarningThreshold();
         if (charCount <= warningThresholdChars) return true;
         const estimatedTokens = Math.ceil(charCount / config.APPROX_CHARS_PER_TOKEN);
         let actualTokenLimit = await this._contextManager.getContextSizeLimit();
         let message = `Est. prompt size (~${charCount} chars / ~${estimatedTokens} tokens) > warning threshold (${warningThresholdChars} chars).`;
         if (actualTokenLimit) {
             message += `\nModel limit: ~${actualTokenLimit} tokens.`;
             if (estimatedTokens > actualTokenLimit) message += `\n\n🚨 WARNING: Estimated size likely EXCEEDS model limit!`;
             else message += `\nIt might fit, but could be slow/costly.`;
         } else message += `\nCould not verify against actual model limit.`;
         message += `\n\nProceed anyway?`;
         const userChoice = await vscode.window.showWarningMessage(message, { modal: true }, 'Proceed', 'Cancel');
         return userChoice === 'Proceed';
     }

    // --- Webview State & Communication ---

    /** Sends the complete current state (discussions, active ID, history) to the webview */
    private sendCurrentStateToWebview() {
        if (this._view) {
            const activeHistory = this._activeDiscussionId ? this._discussions.get(this._activeDiscussionId)?.messages || [] : [];
            this._sendMessageToWebview({
                type: 'loadState', // Use a single message to load everything
                payload: {
                    discussions: this.getDiscussionListForWebview(),
                    activeDiscussionId: this._activeDiscussionId,
                    history: activeHistory,
                    isGenerating: this._isGenerating,
                    contextFileCount: this._contextManager.getContextUris().length,
                    // Send initial status based on client
                    statusMessage: this._lollmsClient ? "Ready" : "Client not configured",
                    statusIsError: !this._lollmsClient
                }
            });
        }
    }

    /** Gets discussion list formatted for the webview (id, title) */
     private getDiscussionListForWebview(): { id: string, title: string, createdAt: number }[] {
         return Array.from(this._discussions.values())
             .sort((a, b) => b.createdAt - a.createdAt) // Sort newest first
             .map(d => ({ id: d.id, title: d.title, createdAt: d.createdAt }));
     }

    /** Adds a message to the *active* discussion's history and saves */
    private async _addMessageToHistory(message: ChatMessage) {
        if (this._activeDiscussionId && this._discussions.has(this._activeDiscussionId)) {
            const activeDiscussion = this._discussions.get(this._activeDiscussionId);
            if (activeDiscussion) {
                // Basic history limiting per discussion
                 if (activeDiscussion.messages.length > 200) {
                     activeDiscussion.messages.shift();
                 }
                activeDiscussion.messages.push(message);
                this._sendMessageToWebview({ type: 'addMessage', payload: message }); // Update UI immediately
                 await this._saveDiscussion(this._activeDiscussionId); // Save after adding message
            }
        } else {
            console.error("Cannot add message, no active discussion set.");
             this._sendMessageToWebview({ type: 'addMessage', payload: { sender: 'system', content: 'Error: No active discussion selected.', type: 'error', timestamp: Date.now() } });
        }
    }

    /** Convenience method to add system messages */
    private _addSystemMessage(content: string, type: 'info' | 'error') {
         this._addMessageToHistory({ sender: 'system', content, type, timestamp: Date.now() });
    }

     /** Updates the status message in the webview */
     private _updateStatus(message: string, isError: boolean = false) {
         this._sendMessageToWebview({ type: 'statusUpdate', payload: { message: message, isError: isError } });
     }

    /** Helper to send typed messages to the webview */
    private _sendMessageToWebview(message: { type: string, payload?: any }) {
        if (this._view) {
            this._view.webview.postMessage(message).then(
                (success) => { if (!success) console.warn(`ChatViewProvider: Failed postMessage ${message.type}`); },
                (error) => console.error(`ChatViewProvider: Error postMessage ${message.type}:`, error)
            );
        }
    }

    /** Generates the HTML content for the Webview */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chatView.js'));
        const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chatView.css'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));
        const nonce = getNonce(); // Function needs to be defined/imported

        // Add discussion management UI elements
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                 <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource};">
                 <link href="${codiconsUri}" rel="stylesheet" />
                 <link href="${stylesUri}" rel="stylesheet">
                <title>LOLLMS Chat</title>
            </head>
            <body>
                <div id="chat-container">
                    <div id="discussion-header">
                         <select id="discussion-selector" title="Switch Discussion">
                             <option value="">-- Select Discussion --</option>
                         </select>
                         <button id="new-discussion-btn" title="New Discussion"><span class="codicon codicon-add"></span></button>
                         <button id="delete-discussion-btn" title="Delete Current Discussion"><span class="codicon codicon-trash"></span></button>
                    </div>
                    <div id="messages"></div>
                    <div id="status-bar">
                        <span id="context-status">Context: 0 files</span> |
                        <span id="model-status">Status: Initializing...</span>
                        <span id="spinner" class="codicon codicon-loading codicon-spin" style="display: none;"></span>
                     </div>
                    <div id="input-area">
                        <textarea id="message-input" placeholder="Ask about your code context..." rows="3"></textarea>
                        <button id="send-button" title="Send Message"><span class="codicon codicon-send"></span></button>
                    </div>
                </div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

// Helper function (should be shared or moved)
function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}