// src/chatViewProvider.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { LollmsClient, LollmsGeneratePayload, LollmsInputDataItem } from './lollmsClient';
import { ContextManager } from './contextManager';
import * as config from './config';
import * as editorUtils from './editorUtils'; // For extractFirstCodeBlock

interface ChatMessage {
    sender: 'user' | 'assistant' | 'system';
    content: string;
    type: 'text' | 'code' | 'error' | 'info'; // Type helps rendering
    rawContent?: string; // Store raw response if needed for copy/retry
    timestamp: number;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'lollmsChatView'; // Matches the ID in package.json

    private _view?: vscode.WebviewView;
    private _chatHistory: ChatMessage[] = []; // In-memory history for now
    private _isGenerating: boolean = false; // Prevent concurrent generations

    // Keep references to shared instances
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private _contextManager: ContextManager,
        private _lollmsClient: LollmsClient | null // Can be updated
    ) {
        // Listen for context changes to potentially inform the user or update UI
        this._contextManager.onContextDidChange(() => {
            this._sendMessageToWebview({
                type: 'contextUpdated',
                payload: { fileCount: this._contextManager.getContextUris().length }
            });
        });
    }

    // Method to update the client if it changes after initialization
    public updateClient(client: LollmsClient | null) {
        if (this._lollmsClient !== client) {
            this._lollmsClient = client;
            console.log("ChatViewProvider: LOLLMS Client instance updated.");
            // Notify webview if it exists? Maybe clear status?
             if (this._view) {
                 this._sendMessageToWebview({ type: 'statusUpdate', payload: { message: client ? "Ready" : "Client disconnected", isError: !client } });
            }
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            // Restrict the webview to only loading content from our extension's 'media' directory.
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')]
        };

        // Set the HTML content
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(
            async message => {
                console.log("ChatViewProvider received message:", message.command);
                switch (message.command) {
                    case 'sendMessage':
                        if (!message.payload || !message.payload.text) {
                            console.error("ChatView: Received empty message payload.");
                            return;
                        }
                        await this.handleSendMessage(message.payload.text);
                        return;
                    case 'getViewState': // Send current state when webview loads/reloads
                        this.sendCurrentStateToWebview();
                        return;
                    case 'copyCode':
                        if (message.payload && message.payload.code) {
                             vscode.env.clipboard.writeText(message.payload.code);
                             vscode.window.showInformationMessage("Code block copied to clipboard.");
                        }
                        return;
                    // Add more cases later for actions like 'applySuggestion', 'retryGeneration' etc.
                }
            },
            undefined,
            // Make sure disposables related to the webview are managed
             // Consider adding context.extensionUri to subscriptions if needed elsewhere
            [] // No extension context disposables needed directly here yet
        );

        // Optional: Handle view disposal
        webviewView.onDidDispose(() => {
            this._view = undefined;
            console.log("ChatViewProvider: Webview disposed.");
        });

        console.log("ChatViewProvider: Webview resolved and initialized.");
        this.sendCurrentStateToWebview(); // Send initial state
    }

    /** Sends the current chat history and status to the webview */
    private sendCurrentStateToWebview() {
        if (this._view) {
            this._sendMessageToWebview({
                type: 'loadHistory',
                payload: { history: this._chatHistory, isGenerating: this._isGenerating }
            });
             this._sendMessageToWebview({
                 type: 'contextUpdated',
                 payload: { fileCount: this._contextManager.getContextUris().length }
             });
             this._sendMessageToWebview({
                 type: 'statusUpdate',
                 payload: { message: this._lollmsClient ? "Ready" : "Client not configured", isError: !this._lollmsClient }
            });
        }
    }

    /** Main handler for receiving user messages from the webview */
    private async handleSendMessage(userMessageText: string) {
        if (this._isGenerating) {
            this._addMessageToHistory({
                sender: 'system', content: 'Please wait for the current response to complete.', type: 'error', timestamp: Date.now()
            });
            return;
        }
        if (!this._lollmsClient) {
            this._addMessageToHistory({
                 sender: 'system', content: 'LOLLMS Client is not configured or connection failed. Please check settings.', type: 'error', timestamp: Date.now()
            });
            // Attempt to re-ensure client? Or just rely on user fixing config.
            // ensureClient(); // This function is in extension.ts - might need refactor or event bus
             this._sendMessageToWebview({ type: 'statusUpdate', payload: { message: "Client not configured", isError: true } });
            return;
        }

        this._isGenerating = true;
        this._addMessageToHistory({ sender: 'user', content: userMessageText, type: 'text', timestamp: Date.now() });
        this._sendMessageToWebview({ type: 'generationStatus', payload: { isGenerating: true } }); // Update UI to show loading

        try {
            // 1. Build Context String (if any files are added)
            let formattedFileContext = "";
            let contextInfo = { fileCount: 0, charCount: 0, estimatedTokens: 0, skippedFiles: [] as string[] };
            const contextUris = this._contextManager.getContextUris();

            if (contextUris.length > 0) {
                 this._sendMessageToWebview({ type: 'statusUpdate', payload: { message: `Building context from ${contextUris.length} file(s)...`, isError: false } });
                 contextInfo = await this._contextManager.buildContextStringFromManagedFiles();
                 formattedFileContext = contextInfo.context; // Get the formatted string
                 if (contextInfo.skippedFiles.length > 0) {
                    this._addMessageToHistory({
                        sender: 'system',
                        content: `Note: Skipped ${contextInfo.skippedFiles.length} context file(s) due to size/errors.`,
                        type: 'info',
                        timestamp: Date.now()
                    });
                 }
            }

            // 2. Construct the full payload for the API
            const payload = this.buildChatPayload(formattedFileContext, userMessageText);

            // 3. Estimate total prompt size (Context + History + New Message)
            let totalEstimatedChars = contextInfo.charCount;
            this._chatHistory.forEach(msg => { totalEstimatedChars += msg.content.length; });
            totalEstimatedChars += userMessageText.length;
            totalEstimatedChars += (config.getContextPromptPrefix() + config.getContextPromptSuffix()).length; // Include wrappers

            // 4. Check against context limit (Use the shared confirm function - needs access)
             // TODO: Refactor confirmLargeContext or pass necessary info here
             const proceed = await this.confirmLargeContextLocally(totalEstimatedChars); // Local temporary version
             if (!proceed) {
                 this._addMessageToHistory({ sender: 'system', content: 'Generation cancelled due to large prompt size.', type: 'info', timestamp: Date.now() });
                 this._isGenerating = false;
                 this._sendMessageToWebview({ type: 'generationStatus', payload: { isGenerating: false } });
                 return;
             }

            // 5. Make the API call
            this._sendMessageToWebview({ type: 'statusUpdate', payload: { message: "Sending request to LOLLMS...", isError: false } });
            const parameters = config.getDefaultModelParameters();
            const overrideBinding = config.getOverrideBindingInstance();
            const overrideModel = config.getOverrideModelName();

            // Use the actual client instance
            const responseText = await this._lollmsClient.generate(payload, parameters, overrideBinding, overrideModel);

            if (responseText !== null) {
                this._addMessageToHistory({ sender: 'assistant', content: responseText, rawContent: responseText, type: 'text', timestamp: Date.now() }); // Store raw for potential copy
                this._sendMessageToWebview({ type: 'statusUpdate', payload: { message: "Ready", isError: false } });
            } else {
                // Error message should have been shown by the client
                 this._addMessageToHistory({ sender: 'system', content: 'Failed to get response from LOLLMS server.', type: 'error', timestamp: Date.now() });
                 this._sendMessageToWebview({ type: 'statusUpdate', payload: { message: "Error receiving response", isError: true } });
            }

        } catch (error: any) {
            console.error("Error during chat generation:", error);
            const errorMsg = `Chat Error: ${error.message || 'Unknown error occurred.'}`;
             this._addMessageToHistory({ sender: 'system', content: errorMsg, type: 'error', timestamp: Date.now() });
             this._sendMessageToWebview({ type: 'statusUpdate', payload: { message: "Error during generation", isError: true } });
             vscode.window.showErrorMessage(errorMsg);
        } finally {
            this._isGenerating = false;
            this._sendMessageToWebview({ type: 'generationStatus', payload: { isGenerating: false } });
        }
    }

    /** Builds the LollmsGeneratePayload for a chat interaction */
    private buildChatPayload(formattedContext: string, userMessage: string): LollmsGeneratePayload {
        const inputData: LollmsInputDataItem[] = [];

        // Add system prompt / context first
        const systemPrompt = config.getContextPromptPrefix(); // Reuse context prefix as system instruction for chat
        inputData.push({ type: 'text', role: 'system_prompt', data: systemPrompt });

        if (formattedContext) {
             inputData.push({ type: 'text', role: 'system_context', data: formattedContext }); // Use a distinct role if server supports it, else maybe merge with system_prompt
             // Alternatively, could format as: System: CONTEXT \n ... \n END CONTEXT
        }

        // Add chat history (simple interleaving for now)
        this._chatHistory.forEach(msg => {
            if (msg.sender === 'user') {
                inputData.push({ type: 'text', role: 'user_prompt', data: msg.content });
            } else if (msg.sender === 'assistant') {
                 inputData.push({ type: 'text', role: 'assistant_reply', data: msg.content });
            }
            // Ignore 'system' messages from history for the prompt itself
        });

        // Add the latest user message
        inputData.push({ type: 'text', role: 'user_prompt', data: userMessage });

        // Add suffix? Maybe not needed if history provides structure. Test this.
        // const suffix = config.getContextPromptSuffix();
        // inputData.push({ type: 'text', role: 'instruction_suffix', data: suffix });

        return {
            input_data: inputData,
            generation_type: 'ttt' // Assume text generation for chat
        };
    }

     /** Temporary local version - ideally use shared one from extension.ts */
     private async confirmLargeContextLocally(charCount: number): Promise<boolean> {
         const warningThresholdChars = config.getContextCharWarningThreshold();
         if (charCount <= warningThresholdChars) return true;

         const estimatedTokens = Math.ceil(charCount / config.APPROX_CHARS_PER_TOKEN);
         let actualTokenLimit = await this._contextManager.getContextSizeLimit(); // Uses the manager's cached value

         let message = `The estimated chat prompt size (~${charCount} chars / ~${estimatedTokens} tokens) exceeds the warning threshold (${warningThresholdChars} chars).`;

         if (actualTokenLimit) { // Check if we got a valid limit
             message += `\nThe current model's context limit is ~${actualTokenLimit} tokens.`;
             if (estimatedTokens > actualTokenLimit) {
                 message += `\n\n🚨 WARNING: Estimated size likely EXCEEDS the model limit! Generation will likely fail or be truncated.`;
             } else {
                 message += `\nIt might fit within the limit, but could be slow/costly.`;
             }
         } else {
             message += `\nCould not verify against the actual model limit (using fallback or failed fetch).`;
         }
         message += `\n\nProceed anyway?`;

         const userChoice = await vscode.window.showWarningMessage(message, { modal: true }, 'Proceed', 'Cancel');
         return userChoice === 'Proceed';
     }


    /** Adds a message to the history and notifies the webview */
    private _addMessageToHistory(message: ChatMessage) {
        // Basic check to prevent excessively long history in memory
        if (this._chatHistory.length > 200) {
             this._chatHistory.shift(); // Remove the oldest message
        }
        this._chatHistory.push(message);
        this._sendMessageToWebview({ type: 'addMessage', payload: message });
    }

    /** Helper to send typed messages to the webview */
    private _sendMessageToWebview(message: { type: string, payload?: any }) {
        if (this._view) {
            this._view.webview.postMessage(message).then(
                (success) => {
                    if (!success) { console.warn(`ChatViewProvider: Failed to post message of type ${message.type} to webview.`); }
                },
                (error) => { console.error(`ChatViewProvider: Error posting message of type ${message.type} to webview:`, error); }
            );
        } else {
            console.warn(`ChatViewProvider: Cannot send message of type ${message.type}, view not available.`);
        }
    }


    /** Generates the HTML content for the Webview */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Get the local path to script run in the webview, then convert it to a URI that the webview can use
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chatView.js'));
        const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chatView.css')); // Optional CSS
         const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));


        // Use a nonce to only allow specific scripts to be run
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <!--
                    Use a content security policy to only allow loading styles from our extension directory,
                    and only allow scripts that have a specific nonce.
                    Also allow images from vscode-resource:, https:, and data: schemes. Allow fonts from vscode-resource:
                -->
                 <meta http-equiv="Content-Security-Policy" content="
                     default-src 'none';
                     style-src ${webview.cspSource} 'unsafe-inline';
                     script-src 'nonce-${nonce}';
                     img-src ${webview.cspSource} https: data:;
                     font-src ${webview.cspSource};
                 ">

                 <link href="${codiconsUri}" rel="stylesheet" />
                 <link href="${stylesUri}" rel="stylesheet"> <!-- Link the chat CSS -->

                <title>LOLLMS Chat</title>
            </head>
            <body>
                <div id="chat-container">
                     <div id="messages">
                         <!-- Chat messages will be appended here -->
                    </div>
                    <div id="status-bar">
                        <span id="context-status">Context: 0 files</span> |
                        <span id="model-status">Status: Initializing...</span>
                        <span id="spinner" class="codicon codicon-loading codicon-spin" style="display: none;"></span>
                     </div>
                    <div id="input-area">
                        <textarea id="message-input" placeholder="Ask about your code context..." rows="3"></textarea>
                        <button id="send-button" title="Send Message">
                            <span class="codicon codicon-send"></span>
                        </button>
                    </div>
                </div>

                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

// Helper function (same as in extension.ts - consider moving to a shared utils file)
function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}