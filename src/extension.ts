// src/extension.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import fetch from 'node-fetch';

import * as config from './config';
import * as gitUtils from './gitUtils';
import * as editorUtils from './editorUtils';
import { ContextManager, FALLBACK_CONTEXT_SIZE_TOKENS } from './contextManager';
import { ContextTreeDataProvider, ContextItem } from './contextTreeViewProvider';
import { ChatViewProvider } from './chatViewProvider';
import { LollmsClient, LollmsGeneratePayload, LollmsInputDataItem, LollmsAvailableModel } from './lollmsClient';

let lollmsClient: LollmsClient | null = null;
let contextManagerInstance: ContextManager | null = null;
let contextTreeViewProvider: ContextTreeDataProvider | null = null;
let chatViewProviderInstance: ChatViewProvider | null = null;
let lollmsStatusBarItem: vscode.StatusBarItem;
let configWebviewPanel: vscode.WebviewPanel | undefined = undefined;

function ensureClient(): LollmsClient | null {
    if (!config.isConfigValid()) {
        config.showConfigurationError();
        if (lollmsClient) {
            lollmsClient = null;
            contextManagerInstance?.setClient(null);
            chatViewProviderInstance?.updateClient(null);
        }
        return null;
    }
    const serverUrl = config.getServerUrl() as string;
    const apiKey = config.getApiKey();

    if (!lollmsClient || lollmsClient['baseUrl'] !== serverUrl || lollmsClient['apiKey'] !== apiKey) {
        try {
            lollmsClient = new LollmsClient(serverUrl, apiKey);
            contextManagerInstance?.setClient(lollmsClient);
             if (contextManagerInstance) {
                contextManagerInstance['_cachedContextSizeLimit'] = null;
             }
             chatViewProviderInstance?.updateClient(lollmsClient);
        } catch (error: any) {
            console.error("Failed to initialize LOLLMS Client:", error);
            vscode.window.showErrorMessage(`Failed to initialize LOLLMS Client: ${error.message}`);
            lollmsClient = null;
            contextManagerInstance?.setClient(null);
            chatViewProviderInstance?.updateClient(null);
            return null;
        }
    }
    return lollmsClient;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    contextManagerInstance = new ContextManager(context);
    chatViewProviderInstance = new ChatViewProvider(context.extensionUri, context, contextManagerInstance);
    ensureClient();
    contextTreeViewProvider = new ContextTreeDataProvider(contextManagerInstance, context);

    const contextTreeViewRegistration = vscode.window.registerTreeDataProvider('lollmsContextView', contextTreeViewProvider);
    context.subscriptions.push(contextTreeViewRegistration);

    const chatViewRegistration = vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProviderInstance, {
         webviewOptions: { retainContextWhenHidden: true }
    });
    context.subscriptions.push(chatViewRegistration);

    lollmsStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    lollmsStatusBarItem.command = 'lollms.openConfigurationUI';
    lollmsStatusBarItem.text = `$(lightbulb-sparkle) LOLLMS`;
    lollmsStatusBarItem.tooltip = 'Open LOLLMS Copilot Configuration / Chat';
    lollmsStatusBarItem.show();
    context.subscriptions.push(lollmsStatusBarItem);

    checkAndRunWizard(context).catch(err => console.error("Error during initial check/wizard launch:", err));

    const generateCommitDisposable = vscode.commands.registerCommand('lollms.generateCommitMessage', async () => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.SourceControl,
            title: "LOLLMS: Generating commit...",
            cancellable: false
        }, async (progress) => {
            const client = ensureClient(); if (!client) return;
            const git = await gitUtils.getGitAPI(); if (!git) return;
            const repositories = await git.getRepositories();
            if (!repositories || repositories.length === 0) {
                vscode.window.showInformationMessage('No Git repository found.'); return;
            }
            const repo = repositories[0];
            progress.report({ increment: 20, message: "Getting diff..." });
            const diff = await gitUtils.getStagedChangesDiff(repo);
            if (diff === undefined) { return; }
            if (!diff.trim()) {
                vscode.window.showInformationMessage('No staged changes found.'); return;
            }

            progress.report({ increment: 50, message: "Requesting generation..." });
            const promptText = `${config.getCommitMsgPromptPrefix()}${diff}${config.getCommitMsgPromptSuffix()}`;
            const parameters = config.getDefaultModelParameters();
            const overrideBinding = config.getOverrideBindingInstance();
            const overrideModel = config.getOverrideModelName();

            const payload: LollmsGeneratePayload = {
                input_data: [{ type: "text", role: "user_prompt", data: promptText }],
                generation_type: "ttt"
            };
             if (overrideBinding) payload.binding_name = overrideBinding;
             if (overrideModel) payload.model_name = overrideModel;
             payload.parameters = parameters;

            const commitMessage = await client.generate(payload, parameters, overrideBinding, overrideModel);

            if (commitMessage !== null) {
                progress.report({ increment: 30, message: "Applying..." });
                gitUtils.updateCommitInputBox(repo, commitMessage);
                vscode.window.setStatusBarMessage('LOLLMS commit message generated!', 3000);
            } else {
                console.error("Failed to get commit message from LOLLMS client.");
                 vscode.window.showErrorMessage("Failed to get commit message from LOLLMS.");
            }
        });
    });

    const generateCodeDisposable = vscode.commands.registerCommand('lollms.generateCodeFromComment', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showInformationMessage('No active editor.'); return; }
        const document = editor.document;
        const position = editor.selection.active;
        const commentText = editorUtils.findPrecedingCommentBlock(document, position);
        if (!commentText) {
             vscode.window.showInformationMessage('No preceding comment/docstring found above cursor.'); return;
        }
        const commentLineCount = commentText.split('\n').length;
        const commentStartLineNum = Math.max(0, position.line - commentLineCount);
        const insertLineNum = position.line;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "LOLLMS: Generating code...",
            cancellable: true
        }, async (progress, token) => {
            const client = ensureClient(); if (!client) return;

            progress.report({ increment: 10, message: "Preparing prompt..." });
            const targetLanguage = editor.document.languageId || "code";
            const suffix = config.getCodeGenPromptSuffix().replace(/```(\w+)?/, `\`\`\`${targetLanguage}`);
            const promptText = `${config.getCodeGenPromptPrefix()}${commentText}${suffix}`;
            const parameters = config.getDefaultModelParameters();
            const overrideBinding = config.getOverrideBindingInstance();
            const overrideModel = config.getOverrideModelName();

            const payload: LollmsGeneratePayload = {
                 input_data: [{ type: "text", role: "user_prompt", data: promptText }],
                 generation_type: "ttt"
             };
             if (overrideBinding) payload.binding_name = overrideBinding;
             if (overrideModel) payload.model_name = overrideModel;
             payload.parameters = parameters;


            if (token.isCancellationRequested) { console.log("Cancelled before API call."); return; }
            progress.report({ increment: 30, message: "Requesting generation..." });
            const fullGeneratedResponse = await client.generate(payload, parameters, overrideBinding, overrideModel);

            if (token.isCancellationRequested) { vscode.window.setStatusBarMessage('LOLLMS generation cancelled.', 3000); return; }

            if (fullGeneratedResponse !== null) {
                progress.report({ increment: 50, message: "Processing result..." });
                const extractedCode = editorUtils.extractFirstCodeBlock(fullGeneratedResponse);
                if (extractedCode) {
                     progress.report({ increment: 10, message: "Inserting code..." });
                    try {
                        await editorUtils.insertGeneratedCode(editor, commentStartLineNum, insertLineNum, extractedCode);
                        vscode.window.setStatusBarMessage('LOLLMS code generated and inserted!', 3000);
                    } catch (error: any) {
                         console.error("Error inserting generated code:", error);
                         vscode.window.showErrorMessage(`Failed to insert generated code: ${error.message}`);
                    }
                } else {
                     console.error("Extracted code block was empty.");
                     vscode.window.showWarningMessage(`LOLLMS response processed, but resulted in empty code.`);
                }
            } else {
                 vscode.window.showErrorMessage(`Failed to get response from LOLLMS.`);
                 console.error("Failed to get generated code from LOLLMS client.");
            }
        });
    });

    const generateWithContextDisposable = vscode.commands.registerCommand('lollms.generateWithContext', async () => {
        if (!contextManagerInstance) { vscode.window.showErrorMessage("Context Manager not initialized."); return; }
        const currentContextUris = contextManagerInstance.getContextUris();
        if (currentContextUris.length === 0) {
            vscode.window.showInformationMessage( "No files in LOLLMS context. Add files first.", { modal: true } ); return;
        }
        const userInstruction = await vscode.window.showInputBox({
            prompt: `Enter request based on ${currentContextUris.length} context file(s)`,
            placeHolder: "e.g., Refactor the classes, Add documentation...",
            title: "LOLLMS Context Request", ignoreFocusOut: true
        });
        if (!userInstruction) { return; }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "LOLLMS: Processing context...",
            cancellable: true
        }, async (progress, token) => {
            const client = ensureClient(); if (!client) return;
            if (!contextManagerInstance) { vscode.window.showErrorMessage("Internal Error: Context Manager unavailable."); return; }

            progress.report({ increment: 10, message: `Building context...` });
            const { context: formattedFileContext, fileCount, charCount, skippedFiles, estimatedTokens } = await contextManagerInstance.buildContextStringFromManagedFiles();
            if (skippedFiles.length > 0) { vscode.window.showWarningMessage(`Skipped ${skippedFiles.length} context file(s). Check Output.`); }
            if (token.isCancellationRequested) { return; }

            const fullPromptText = `${config.getContextPromptPrefix()}${formattedFileContext}${config.getContextPromptSuffix()}${userInstruction}`;
            progress.report({ increment: 5, message: "Checking size..." });
            const totalChars = fullPromptText.length;

            if (!await contextManagerInstance.checkAndConfirmContextSize(totalChars)) {
                vscode.window.showInformationMessage("Context generation cancelled by user due to size.");
                return;
            }
            if (token.isCancellationRequested) { return; }

            const overrideBinding = config.getOverrideBindingInstance();
            const overrideModel = config.getOverrideModelName();
            const parameters = config.getDefaultModelParameters();

             const payload: LollmsGeneratePayload = {
                 input_data: [{ type: "text", role: "user_prompt", data: fullPromptText }],
                 generation_type: "ttt"
             };
             if (overrideBinding) payload.binding_name = overrideBinding;
             if (overrideModel) payload.model_name = overrideModel;
             payload.parameters = parameters;

            progress.report({ increment: 25, message: "Requesting generation..." });
            const generatedResult = await client.generate(payload, parameters, overrideBinding, overrideModel);

            if (token.isCancellationRequested) { vscode.window.setStatusBarMessage('LOLLMS generation cancelled.', 3000); return; }

            if (generatedResult !== null) {
                progress.report({ increment: 60, message: "Displaying result..." });
                try {
                    let language = 'markdown';
                    const trimmedResult = editorUtils.extractFirstCodeBlock(generatedResult);
                    if (trimmedResult.startsWith('def ') || trimmedResult.includes('import ')) language = 'python';
                    else if (trimmedResult.startsWith('function') || trimmedResult.includes('const ')) language = 'javascript';
                    else if (trimmedResult.startsWith('<')) language = 'html';
                    else if (trimmedResult.startsWith('{') || trimmedResult.startsWith('[')) language = 'json';

                    const resultDocument = await vscode.workspace.openTextDocument({ content: trimmedResult, language: language });
                    const activeEditor = vscode.window.activeTextEditor;
                    const viewColumn = activeEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;
                    await vscode.window.showTextDocument(resultDocument, { viewColumn: viewColumn, preserveFocus: false, preview: false });
                    vscode.window.setStatusBarMessage('LOLLMS context generation complete!', 5000);
                } catch (error: any) {
                    console.error("Error opening result document:", error);
                    vscode.window.showErrorMessage(`Failed to display result: ${error.message}`);
                    vscode.window.showInformationMessage("LOLLMS Result (Preview):\n" + generatedResult.substring(0, 500) + "...", { modal: true });
                }
            } else {
                 vscode.window.showErrorMessage("Failed to generate response from LOLLMS.");
                 console.error("Failed to get context generation result from LOLLMS client.");
            }
        });
    });

    const showWizardDisposable = vscode.commands.registerCommand('lollms.showSetupWizard', async () => {
        await showSetupWizard(context);
    });

    const openConfigUIDisposable = vscode.commands.registerCommand('lollms.openConfigurationUI', () => {
         createConfigurationPanel(context);
    });

    const addCurrentFileDisposable = vscode.commands.registerCommand('lollms.context.addCurrentFile', async (uri?: vscode.Uri) => {
        if (!contextManagerInstance) { vscode.window.showErrorMessage("Context Manager not initialized."); return; }
        let fileUriToAdd: vscode.Uri | undefined = uri;
        if (!fileUriToAdd) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.scheme === 'file') fileUriToAdd = editor.document.uri;
            else if (editor) { vscode.window.showWarningMessage("Cannot add non-file editor content."); return; }
        }
        if (fileUriToAdd && fileUriToAdd.scheme === 'file') {
            const added = await contextManagerInstance.addUri(fileUriToAdd);
            if (added) vscode.window.setStatusBarMessage(`Added to LOLLMS Context: ${vscode.workspace.asRelativePath(fileUriToAdd)}`, 3000);
            else vscode.window.showInformationMessage(`File already in LOLLMS Context: ${vscode.workspace.asRelativePath(fileUriToAdd)}`);
        } else if (uri && uri.scheme !== 'file') vscode.window.showWarningMessage(`Cannot add non-file resource '${uri.scheme}'.`);
        else vscode.window.showWarningMessage("No active file editor or valid file selected.");
    });

    const addAllDisposable = vscode.commands.registerCommand('lollms.context.addAllProjectFiles', async () => {
        if (!contextManagerInstance) { vscode.window.showErrorMessage("Context Manager not initialized."); return; }
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) { vscode.window.showInformationMessage("No workspace folder open."); return; }
        const rootFolder = workspaceFolders[0].uri;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "LOLLMS: Adding project files...",
            cancellable: true
        }, async (progress, token) => {
            try {
                if (!contextManagerInstance) throw new Error("Context Manager unavailable.");
                const ignorePatterns = config.getContextIgnorePatterns();
                const excludePatternString = ignorePatterns.length > 0 ? `{${ignorePatterns.join(',')}}` : undefined;
                progress.report({ message: "Searching files...", increment: 10 });
                const maxResults = 2000;
                const allFiles = await vscode.workspace.findFiles('**/*', excludePatternString, maxResults, token);
                if (token.isCancellationRequested) { return; }
                if (allFiles.length === 0) { vscode.window.showInformationMessage("No project files found."); return; }
                if (allFiles.length === maxResults) vscode.window.showWarningMessage(`Reached file limit (${maxResults}).`);

                let estimatedChars = 0;
                progress.report({ message: `Estimating size...`, increment: 20 });
                for (const file of allFiles) {
                    if (token.isCancellationRequested) return;
                    try { const stats = await vscode.workspace.fs.stat(file); if(stats.type === vscode.FileType.File) estimatedChars += stats.size; }
                    catch { /* ignore */ }
                }
                progress.report({ message: `Checking size estimate...`, increment: 10 });
				if (!await contextManagerInstance.checkAndConfirmContextSize(estimatedChars)) {
					vscode.window.showInformationMessage("Operation cancelled by user due to size estimate.");
					return;
				}
                if (token.isCancellationRequested) return;

                progress.report({ message: `Adding ${allFiles.length} files...`, increment: 40 });
                let addedCount = 0;
                for (const fileUri of allFiles) {
                     if (token.isCancellationRequested) break;
                     const uriString = fileUri.toString();
                     if (!contextManagerInstance['_contextUris'].has(uriString)) {
                          contextManagerInstance['_contextUris'].add(uriString);
                          addedCount++;
                     }
                }
                if (token.isCancellationRequested) { return; }
                if (addedCount > 0) {
                    await contextManagerInstance['saveToState']();
                    contextManagerInstance['_onContextDidChange'].fire();
                    vscode.window.setStatusBarMessage(`Added ${addedCount} project files to LOLLMS Context.`, 4000);
                } else vscode.window.showInformationMessage("No new project files were added.");
                progress.report({ increment: 20 });
            } catch (error: any) {
                 console.error("Error adding all project files:", error);
                 vscode.window.showErrorMessage(`Failed to add project files: ${error.message}`);
            }
        });
    });

    const removeFileDisposable = vscode.commands.registerCommand('lollms.context.removeFile', async (itemOrUri?: ContextItem | vscode.Uri) => {
        if (!contextManagerInstance) { vscode.window.showErrorMessage("Context Manager not initialized."); return; }
        let uriToRemove: vscode.Uri | undefined;
        if (itemOrUri instanceof ContextItem) uriToRemove = itemOrUri.resourceUri;
        else if (itemOrUri instanceof vscode.Uri && itemOrUri.scheme === 'file') uriToRemove = itemOrUri;
        else { return; }
        if (uriToRemove) {
            const removed = await contextManagerInstance.removeUri(uriToRemove);
            if (removed) vscode.window.setStatusBarMessage(`Removed from LOLLMS Context: ${vscode.workspace.asRelativePath(uriToRemove)}`, 3000);
        }
    });

    const clearAllDisposable = vscode.commands.registerCommand('lollms.context.clearAll', async () => {
        if (!contextManagerInstance) { vscode.window.showErrorMessage("Context Manager not initialized."); return; }
        if (contextManagerInstance.getContextUris().length === 0) { vscode.window.showInformationMessage("LOLLMS Context is already empty."); return; }
        const choice = await vscode.window.showWarningMessage( "Clear all files from LOLLMS context?", { modal: true }, "Clear All" );
        if (choice === "Clear All") { await contextManagerInstance.clearAll(); vscode.window.setStatusBarMessage("LOLLMS Context Cleared.", 3000); }
    });

    const refreshDisposable = vscode.commands.registerCommand('lollms.context.refreshView', () => {
        if (contextTreeViewProvider) { contextTreeViewProvider.refresh(); vscode.window.setStatusBarMessage("Refreshed LOLLMS Context View.", 2000); }
    });

	const viewCopyContextDisposable = vscode.commands.registerCommand('lollms.context.viewAndCopy', async () => {
		if (!contextManagerInstance) { vscode.window.showErrorMessage("Context Manager not initialized."); return; }
		const currentContextUris = contextManagerInstance.getContextUris();
		if (currentContextUris.length === 0) { vscode.window.showInformationMessage("LOLLMS Context is empty."); return; }

		await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "LOLLMS: Building context prompt...",
            cancellable: false
        }, async (progress) => {
            if (!contextManagerInstance) { throw new Error("Context Manager unavailable."); }
			progress.report({ increment: 20, message: `Reading ${currentContextUris.length} file(s)...` });
			const { context: formattedFileContext, fileCount, charCount, skippedFiles, estimatedTokens } = await contextManagerInstance.buildContextStringFromManagedFiles();
			if (skippedFiles.length > 0) { vscode.window.showWarningMessage(`Skipped ${skippedFiles.length} context file(s). Check Output.`); }

			progress.report({ increment: 70, message: "Formatting..." });
            const fullPromptHeader = `--- LOLLMS Context Prompt (${fileCount} file(s), ~${estimatedTokens} tokens / ${charCount} chars) ---\n\n`;
			const fullPromptView = `${fullPromptHeader}${config.getContextPromptPrefix()}${formattedFileContext}${config.getContextPromptSuffix()}[YOUR_SPECIFIC_REQUEST_OR_INSTRUCTION_HERE]`;

			try {
				const doc = await vscode.workspace.openTextDocument({ content: fullPromptView, language: 'markdown' });
				await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false, preview: false });
				await vscode.env.clipboard.writeText(fullPromptView);
				progress.report({ increment: 10, message: "Done!" });
				vscode.window.setStatusBarMessage('LOLLMS Context Prompt displayed and copied!', 4000);
			} catch (error: any) {
                console.error("Error showing/copying context:", error);
                vscode.window.showErrorMessage(`Failed to show/copy context: ${error.message}`);
            }
		});
	});

    const openChatDisposable = vscode.commands.registerCommand('lollms.openChatView', () => {
        vscode.commands.executeCommand('lollms-copilot-view-container.focus');
    });

    const newDiscussionDisposable = vscode.commands.registerCommand('lollms.chat.newDiscussion', async () => {
        if (chatViewProviderInstance) {
            await chatViewProviderInstance.startNewDiscussion();
             vscode.commands.executeCommand('lollmsChatView.focus');
        } else {
            vscode.window.showErrorMessage("Chat view provider not available.");
        }
    });

    context.subscriptions.push(
        generateCommitDisposable, generateCodeDisposable, generateWithContextDisposable,
        showWizardDisposable, openConfigUIDisposable, addCurrentFileDisposable,
        addAllDisposable, removeFileDisposable, clearAllDisposable,
        refreshDisposable, viewCopyContextDisposable,
        openChatDisposable, newDiscussionDisposable
    );

    console.log('LOLLMS Copilot extension activation complete.');
}

/**
 * Creates or reveals the configuration webview panel
 */
function createConfigurationPanel(context: vscode.ExtensionContext) {
    const column = vscode.window.activeTextEditor?.viewColumn;
    const panelType = 'lollmsConfiguration';
    const panelTitle = 'LOLLMS Configuration';

    if (configWebviewPanel) {
        configWebviewPanel.reveal(column);
        // No need to send settings immediately, webview will request 'getViewState' or similar
        // Maybe trigger a bindings refresh explicitly if revealing an old panel?
         configWebviewPanel.webview.postMessage({ command: 'requestBindingsList' });
        return;
    }

    const mediaFolder = vscode.Uri.joinPath(context.extensionUri, 'media');
    const scriptUri = vscode.Uri.joinPath(mediaFolder, 'configView.js');
    const codiconsUri = vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'); // Get codicons URI

    configWebviewPanel = vscode.window.createWebviewPanel(
        panelType, panelTitle, column || vscode.ViewColumn.One,
        {
            enableScripts: true,
            // Update localResourceRoots to include node_modules for codicons
            localResourceRoots: [mediaFolder, vscode.Uri.joinPath(context.extensionUri, 'node_modules')]
        }
    );

    const webviewScriptUri = configWebviewPanel.webview.asWebviewUri(scriptUri);
    const webviewCodiconsUri = configWebviewPanel.webview.asWebviewUri(codiconsUri); // Make codicons URI accessible

    configWebviewPanel.webview.html = getConfigurationWebviewContent(configWebviewPanel.webview, webviewScriptUri, webviewCodiconsUri); // Pass URIs

    // **UPDATED** Message Handler
    configWebviewPanel.webview.onDidReceiveMessage(
        async message => {
            // Ensure client for most operations, but not for getCurrentSettings
            let client = null;
             if (message.command !== 'getCurrentSettings') {
                client = ensureClient(); // Initialize/get client
             }

            switch (message.command) {
                case 'saveSettings':
                    if (message.payload) {
                        try {
                            await config.updateGlobalSettings(message.payload);
                            ensureClient(); // Re-initialize client with new settings if needed
                            configWebviewPanel?.webview.postMessage({ command: 'settingsSaved' });
                            // Trigger a rescan automatically after saving potentially changed URL/Key
                            configWebviewPanel?.webview.postMessage({ command: 'requestBindingsList' });
                        } catch (error: any) {
                             configWebviewPanel?.webview.postMessage({ command: 'saveError', error: error.message });
                        }
                    }
                    break;
                case 'getCurrentSettings': // Send current settings when webview asks
                    sendSettingsToWebview();
                    break;
                case 'getBindingsList': // Handle explicit request for bindings
                     if (!client) {
                         configWebviewPanel?.webview.postMessage({ command: 'showError', payload: 'LOLLMS client not available. Check server URL/API Key.' });
                         configWebviewPanel?.webview.postMessage({ command: 'bindingsList', payload: [] }); // Send empty list
                         break;
                     }
                     try {
						// listActiveBindings now returns string[] | null
						const activeBindingNames = await client.listActiveBindings();
						// If activeBindingNames is null (e.g., API error handled in client), default to empty array
						const bindingNamesToSend = activeBindingNames ? activeBindingNames : [];
						configWebviewPanel?.webview.postMessage({ command: 'bindingsList', payload: bindingNamesToSend });
					} catch (error: any) {
						 console.error("Error fetching bindings:", error);
						 configWebviewPanel?.webview.postMessage({ command: 'showError', payload: `Error fetching bindings: ${error.message}` });
						 configWebviewPanel?.webview.postMessage({ command: 'bindingsList', payload: [] }); // Send empty list on error
					}
                    break;
                 case 'rescanServer': // **NEW** Handle rescan request
                     console.log("ConfigView: Received rescanServer request.");
                      if (!client) {
                          configWebviewPanel?.webview.postMessage({ command: 'showError', payload: 'LOLLMS client not available. Check server URL/API Key.' });
                          configWebviewPanel?.webview.postMessage({ command: 'scanError', payload: 'Client not available.' }); // Explicit scan error
                          break;
                      }
                      try {
                          // 1. Fetch active bindings again
                          const activeBindingNames = await client.listActiveBindings(); // Returns string[] | null
                          // If activeBindingNames is null, default to empty array
                          const bindingNamesToSend = activeBindingNames ? activeBindingNames : [];

                          // 2. Send updated bindings list back to webview
                          configWebviewPanel?.webview.postMessage({ command: 'bindingsList', payload: bindingNamesToSend });
                          // 3. Send success signal
                           configWebviewPanel?.webview.postMessage({ command: 'scanComplete' });
                          // The webview's existing logic will handle fetching models for the selected binding
                          vscode.window.setStatusBarMessage("LOLLMS server scan complete.", 3000);
                      } catch (error: any) {
                           console.error("Error during server rescan:", error);
                           const errorMsg = `Server rescan failed: ${error.message}`;
                           configWebviewPanel?.webview.postMessage({ command: 'showError', payload: errorMsg });
                           configWebviewPanel?.webview.postMessage({ command: 'scanError', payload: errorMsg }); // Explicit scan error
                      }
                    break;
                case 'getModelsList': // (Keep existing logic)
                     if (!client) { /* ... handle error ... */ break; }
                     if (message.payload?.bindingName) {
                         try {
                             const models = await client.listAvailableModels(message.payload.bindingName);
                             const modelNames = models ? models.map(m => m.name) : [];
                             configWebviewPanel?.webview.postMessage({ command: 'modelsList', /*...*/ });
                         } catch (error: any) { /* ... handle error ... */ }
                     }
                    break;
            }
        }, undefined, context.subscriptions );

    configWebviewPanel.onDidDispose( () => { configWebviewPanel = undefined; }, null, context.subscriptions );

    // Request initial settings and bindings when panel is first created
    sendSettingsToWebview();
    configWebviewPanel.webview.postMessage({ command: 'requestBindingsList' });
}

/**
 * Generates the HTML content for the configuration webview.
 */
/** Generates the HTML content for the configuration webview. */
function getConfigurationWebviewContent(webview: vscode.Webview, scriptUri: vscode.Uri, codiconsUri: vscode.Uri): string {
    const nonce = getNonce();
    // Add Codicons CSS link and the Rescan button HTML
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
    <link href="${codiconsUri}" rel="stylesheet" />
    <title>LOLLMS Configuration</title>
    <style>
        /* Keep the same CSS styles as before */
        body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); padding: 20px; }
        label { display: block; margin-top: 15px; margin-bottom: 5px; font-weight: bold; color: var(--vscode-foreground); }
        input[type="text"], input[type="password"], input[type="number"], select { width: 95%; padding: 8px; border: 1px solid var(--vscode-input-border, #ccc); background-color: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 3px; }
        input:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); }
        button { margin-top: 20px; padding: 10px 15px; border: none; border-radius: 3px; background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; font-weight: bold; }
        button:hover { background-color: var(--vscode-button-hoverBackground); }
        button:disabled { background-color: var(--vscode-button-secondaryBackground); opacity: 0.6; cursor: not-allowed; }
        .setting-group { margin-bottom: 25px; border-bottom: 1px solid var(--vscode-editorWidget-border, #444); padding-bottom: 15px; }
        h3 { margin-top: 0; color: var(--vscode-foreground); border-bottom: 1px solid var(--vscode-editorWidget-border, #444); padding-bottom: 5px; }
        .description { font-size: 0.9em; color: var(--vscode-descriptionForeground); margin-bottom: 10px; margin-top: 2px; }
        #save-feedback, #loading-feedback, #error-feedback { margin-top: 15px; font-weight: bold; min-height: 1.2em; }
        .success { color: var(--vscode-terminal-ansiGreen); }
        .error { color: var(--vscode-terminal-ansiRed); }
        .info { color: var(--vscode-descriptionForeground); }
        .checkbox-container { display: flex; align-items: center; margin-top: 10px; }
        .checkbox-container label { margin-top: 0; margin-left: 8px; margin-bottom: 0; font-weight: normal; }
        input[type="checkbox"] { width: auto; accent-color: var(--vscode-focusBorder); }
        select:disabled { background-color: var(--vscode-input-disabledBackground); opacity: 0.5; }
        /* Style for secondary button */
        .button-secondary { background-color: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); margin-left: 10px; }
        .button-secondary:hover { background-color: var(--vscode-button-secondaryHoverBackground); }
        .button-secondary .codicon { margin-right: 4px; } /* Space icon and text */
    </style>
</head>
<body>
    <h1><span class="codicon codicon-lightbulb-sparkle"></span> LOLLMS Copilot Configuration</h1>
    <div id="loading-feedback" class="info" style="display: none;">Loading...</div>
    <div id="error-feedback" class="error" style="display: none;"></div>

    <div class="setting-group">
        <h3>Server Connection</h3>
        <label for="serverUrl">Server URL:</label>
        <input type="text" id="serverUrl" name="serverUrl" placeholder="e.g., http://localhost:9601">
        <div class="description">Base URL of your running lollms-server. (Required)</div>
        <label for="apiKey">API Key (Optional):</label>
        <input type="password" id="apiKey" name="apiKey" placeholder="Leave blank if not required">
         <div class="description">API Key if your server requires authentication.</div>
         <!-- Add Rescan Button Here -->
         <button id="rescanButton" class="button-secondary" title="Check connection and refresh available bindings/models from the server">
            <span class="codicon codicon-refresh"></span> Rescan Server
         </button>
    </div>

    <div class="setting-group">
        <h3>Generation Overrides (Optional)</h3>
         <div class="description">Select specific bindings/models configured on your server to override the server's defaults. Requires successful server connection.</div>
        <label for="overrideBindingInstance">Override Binding Instance:</label>
        <select id="overrideBindingInstance" name="overrideBindingInstance">
             <option value="">-- Use Server Default --</option>
             <!-- Options populated by JS -->
        </select>
        <div class="description">Leave as default or select an active binding instance.</div>
        <label for="overrideModelName">Override Model Name:</label>
        <select id="overrideModelName" name="overrideModelName" disabled>
            <option value="">-- Use Binding Default --</option>
             <!-- Options populated by JS -->
        </select>
        <div class="description">Select a model available to the chosen binding.</div>
    </div>

     <div class="setting-group">
        <h3>Context Behavior</h3>
         <label for="contextCharWarningThreshold">Context Warning Threshold (Characters):</label>
        <input type="number" id="contextCharWarningThreshold" name="contextCharWarningThreshold" min="1000" step="1000">
        <div class="description">Warn if estimated prompt character count exceeds this value.</div>
        <div class="checkbox-container">
            <input type="checkbox" id="includeFilePathsInContext" name="includeFilePathsInContext">
            <label for="includeFilePathsInContext">Include file paths in context prompt</label>
        </div>
         <div class="description">Prepend each file's content with its relative path in the prompt.</div>
    </div>

    <button id="saveButton">Save Settings</button>
    <div id="save-feedback"></div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
/**
 * Sends current settings to the configuration webview.
 */
function sendSettingsToWebview() {
    if (configWebviewPanel) {
         configWebviewPanel.webview.postMessage({
            command: 'loadSettings',
            payload: {
                serverUrl: config.getServerUrl() || '',
                apiKey: config.getApiKey() || '',
                overrideBindingInstance: config.getOverrideBindingInstance() || '',
                overrideModelName: config.getOverrideModelName() || '',
                contextCharWarningThreshold: config.getContextCharWarningThreshold(),
                includeFilePathsInContext: config.shouldIncludeFilePathsInContext()
            }
        });
    }
}

/**
 * Generates a random nonce string.
 */
function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

/**
 * Confirms if the user wants to proceed with a large context prompt.
 * @param charCount Estimated character count of the prompt.
 * @param manager The ContextManager instance to fetch the actual token limit.
 * @returns True if the user confirms, false otherwise.
 */
async function confirmLargeContext(charCount: number, manager: ContextManager | null): Promise<boolean> {
    const warningThresholdChars = config.getContextCharWarningThreshold();
    if (charCount <= warningThresholdChars) return true;

    const estimatedTokens = Math.ceil(charCount / config.APPROX_CHARS_PER_TOKEN);
    const actualTokenLimit = manager ? await manager.getContextSizeLimit() : FALLBACK_CONTEXT_SIZE_TOKENS;

    let message = `The estimated prompt size (~${charCount} chars / ~${estimatedTokens} tokens) exceeds the warning threshold of ${warningThresholdChars} chars.`;

    if (manager && actualTokenLimit && actualTokenLimit !== FALLBACK_CONTEXT_SIZE_TOKENS) {
        message += `\nThe current default model's context limit is ~${actualTokenLimit} tokens.`;
        if (estimatedTokens > actualTokenLimit) {
            message += `\n\n🚨 WARNING: Estimated size may exceed model limit! Generation could fail or be truncated.`;
        } else {
             message += `\nIt might fit within the limit, but could be slow/costly.`
        }
    } else {
         message += `\nCould not verify against the actual model limit (using fallback: ${FALLBACK_CONTEXT_SIZE_TOKENS} or failed fetch).`;
    }
    message += `\n\nProceed anyway?`;

    const userChoice = await vscode.window.showWarningMessage( message, { modal: true }, 'Proceed', 'Cancel' );
    return userChoice === 'Proceed';
}

/**
 * Checks if initial setup is needed and runs the wizard.
 */
async function checkAndRunWizard(context: vscode.ExtensionContext): Promise<void> {
    try {
        const firstRunComplete = await context.globalState.get<boolean>('lollmsCopilotFirstRunComplete');
        const currentConfigValid = config.isConfigValid();
        if (!firstRunComplete || !currentConfigValid) {
            setImmediate(() => { showSetupWizard(context).catch(error => console.error("Error running auto wizard:", error)); });
        }
    } catch (error) { console.error("Error during wizard check:", error); }
}

/**
 * Displays the setup wizard UI (URL and optional API Key).
 */
async function showSetupWizard(context: vscode.ExtensionContext): Promise<void> {
    const configureButton = "Configure Server URL Now";
    const choice = await vscode.window.showInformationMessage(
        'Configure LOLLMS Copilot Server Connection',
        { modal: true }, configureButton, "Cancel Setup"
    );
    if (choice !== configureButton) { vscode.window.showInformationMessage("Config cancelled."); return; }

    let currentUrl = config.getServerUrl() || "http://localhost:9601";
    let healthCheckOk = false;
    let apiKeyRequired = false;
    let serverVersion: string | null = null;
    let userCancelled = false;
    const configTarget = vscode.ConfigurationTarget.Global;
    const HEALTH_CHECK_TIMEOUT_MS = 10000;

    while (!healthCheckOk && !userCancelled) {
        const urlInput = await vscode.window.showInputBox({
            prompt: "Enter base URL of lollms-server", placeHolder: "e.g., http://localhost:9601", value: currentUrl, ignoreFocusOut: true,
            validateInput: (v: string) => { if (!v) return 'URL required.'; try { new URL(v); return null; } catch { return 'Invalid URL.'; } }
        });
        if (urlInput === undefined) { userCancelled = true; break; }
        currentUrl = urlInput.trim().replace(/\/$/, '');
        const healthUrl = `${currentUrl}/health`;

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Connecting...`, cancellable: false }, async (progress) => {
            const controller = new AbortController();
            const signal = controller.signal;
            const timeoutId = setTimeout(() => { controller.abort(); }, HEALTH_CHECK_TIMEOUT_MS);
            try {
                progress.report({ message: `Checking ${healthUrl}...` });
                // Use signal directly with node-fetch v2+
                const response = await fetch(healthUrl, { method: 'GET', signal: signal as any}); // Cast signal for v2 compatibility if needed
                clearTimeout(timeoutId);
                if (!response.ok) { const errText = await response.text(); throw new Error(`Status ${response.status}: ${errText}`); }
                const healthData = await response.json() as { status: string; api_key_required?: boolean; version?: string };
                if (healthData.status !== 'ok') { throw new Error(`Server status: ${healthData.status || 'Unknown'}`); }
                healthCheckOk = true; apiKeyRequired = healthData.api_key_required === true; serverVersion = healthData.version || null;
                vscode.window.showInformationMessage(`Connected to LOLLMS Server v${serverVersion || 'unknown'}! API Key Required: ${apiKeyRequired ? 'Yes' : 'No'}`);
            } catch (error: any) {
                clearTimeout(timeoutId);
                healthCheckOk = false;
                let errorMsg = error.message || 'Unknown connection error';
                if (error.name === 'AbortError') errorMsg = `Connection timed out (${HEALTH_CHECK_TIMEOUT_MS / 1000}s).`;
                const retryChoice = await vscode.window.showWarningMessage( `Failed connection to '${currentUrl}'. Check URL, server, CORS.\nError: ${errorMsg}`, { modal: true }, "Retry URL", "Cancel Setup" );
                if (retryChoice !== "Retry URL") userCancelled = true;
            }
        });
    }

    if (userCancelled) { vscode.window.showWarningMessage("Setup cancelled."); return; }

    if (healthCheckOk && currentUrl) {
        await vscode.workspace.getConfiguration('lollms').update('serverUrl', currentUrl, configTarget);
        let apiKeyFlowCompleted = !apiKeyRequired;
        if (apiKeyRequired) {
            const apiKeyInput = await vscode.window.showInputBox({ prompt: `Enter API Key for ${currentUrl}`, password: true, ignoreFocusOut: true, value: config.getApiKey() || "" });
            if (apiKeyInput !== undefined) {
                await vscode.workspace.getConfiguration('lollms').update('apiKey', apiKeyInput.trim(), configTarget);
                apiKeyFlowCompleted = true;
            } else {
                vscode.window.showWarningMessage("API Key prompt cancelled."); apiKeyFlowCompleted = false;
            }
        }
        if (apiKeyFlowCompleted) {
            await context.globalState.update('lollmsCopilotFirstRunComplete', true);
            vscode.window.showInformationMessage("LOLLMS config updated!");
            ensureClient();
        } else {
            vscode.window.showWarningMessage("Server URL saved, but API key setup skipped.");
        }
    } else if (!userCancelled) {
        vscode.window.showErrorMessage("Setup failed unexpectedly after URL entry.");
    }
}

/**
 * Deactivation function.
 */
export function deactivate(): void {
    lollmsStatusBarItem?.dispose();
    configWebviewPanel?.dispose();
    lollmsClient = null;
    contextManagerInstance = null;
    contextTreeViewProvider = null;
    chatViewProviderInstance = null;
}