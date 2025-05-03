// src/extension.ts
import * as vscode from 'vscode';
import fetch from 'node-fetch'; // Ensure node-fetch is installed

import * as config from './config';
import * as gitUtils from './gitUtils';
import * as editorUtils from './editorUtils';
// import * as contextManagerHelper from './contextManager'; // No longer needed directly?
import { ContextManager } from './contextManager';
import { ContextTreeDataProvider, ContextItem } from './contextTreeViewProvider';
import { LollmsClient, LollmsGeneratePayload } from './lollmsClient';

let lollmsClient: LollmsClient | null = null;
let contextManagerInstance: ContextManager | null = null;
let contextTreeViewProvider: ContextTreeDataProvider | null = null;

/**
 * Ensures the LOLLMS client is initialized with current settings from VS Code preferences.
 * Checks if the essential configuration (server URL, default binding) is present.
 * If configuration is invalid, it shows an error message to the user.
 * If the client doesn't exist or settings have changed, it creates a new instance.
 * Also updates the client instance within the ContextManager.
 * @returns The initialized LollmsClient instance, or null if configuration is invalid or initialization fails.
 */
function ensureClient(): LollmsClient | null {
    if (!config.isConfigValid()) {
        config.showConfigurationError();
        // Clear existing client if config becomes invalid
        if (lollmsClient) {
             console.log("Configuration became invalid, clearing existing LOLLMS client.");
             lollmsClient = null;
             if (contextManagerInstance) contextManagerInstance.setClient(null);
        }
        return null;
    }
    const serverUrl = config.getServerUrl() as string; // Already checked by isConfigValid
    const apiKey = config.getApiKey();

    if (!lollmsClient || lollmsClient['baseUrl'] !== serverUrl || lollmsClient['apiKey'] !== apiKey) {
        try {
            console.log(`Initializing/Updating LOLLMS Client. URL: ${serverUrl}, API Key Set: ${!!apiKey}`);
            lollmsClient = new LollmsClient(serverUrl, apiKey);
            if (contextManagerInstance) {
                contextManagerInstance.setClient(lollmsClient); // Update manager with new client
            }
        } catch (error: any) {
             console.error("Failed to initialize LOLLMS Client:", error);
             vscode.window.showErrorMessage(`Failed to initialize LOLLMS Client: ${error.message}`);
             lollmsClient = null;
             if (contextManagerInstance) contextManagerInstance.setClient(null); // Clear in manager too
             return null;
        }
    }
    return lollmsClient;
}

/**
 * Main activation function called when the extension is loaded by VS Code.
 * Initializes managers, registers the tree view, checks for first run setup,
 * and registers all commands contributed by the extension.
 * @param context The extension context provided by VS Code, used for subscriptions and state.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('LOLLMS Copilot extension is activating...');

    // Initialize Context Manager first
    contextManagerInstance = new ContextManager(context);

    // Attempt to initialize client early (may return null if config invalid)
    // The manager needs the client instance, so pass it during provider creation
    ensureClient();
    contextManagerInstance.setClient(lollmsClient); // Ensure manager has client ref

    // Initialize TreeView Provider *after* manager and potential client init
    contextTreeViewProvider = new ContextTreeDataProvider(contextManagerInstance, context);

    const contextTreeViewRegistration = vscode.window.registerTreeDataProvider(
        'lollmsContextView',
        contextTreeViewProvider
    );
    context.subscriptions.push(contextTreeViewRegistration);

    // Check for wizard *after* core components are set up
    checkAndRunWizard(context).catch(err => {
         console.error("Error during initial check/wizard launch:", err);
    });

    // --- Register Commands ---

    const generateCommitDisposable = vscode.commands.registerCommand('lollms.generateCommitMessage', async () => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.SourceControl, // Show progress in SCM view
            title: "LOLLMS: Generating commit...",
            cancellable: false // Usually fast enough not to need cancellation
        }, async (progress) => {
            const client = ensureClient(); // Re-check config and client on command run
            if (!client) { return; }

            progress.report({ increment: 10, message: "Accessing Git..." });
            const git = await gitUtils.getGitAPI();
            if (!git) { return; } // Error shown by getGitAPI

            const repositories = await git.getRepositories();
            if (!repositories || repositories.length === 0) {
                vscode.window.showInformationMessage('No Git repository found in the current workspace.');
                return;
            }
            const repo = repositories[0]; // Assume first repo

            progress.report({ increment: 20, message: "Getting staged changes..." });
            const diff = await gitUtils.getStagedChangesDiff(repo);

            if (diff === undefined) { // Check specifically for undefined, as empty diff is possible
                console.error("Failed to get staged changes diff (returned undefined).");
                // Error messages likely shown by getStagedChangesDiff
                return;
            }
            if (!diff.trim()) {
                vscode.window.showInformationMessage('No staged changes found to generate commit message from.');
                return;
            }

            progress.report({ increment: 50, message: "Requesting generation..." });
			const promptText = `${config.getCommitMsgPromptPrefix()}${diff}${config.getCommitMsgPromptSuffix()}`;
			const parameters = config.getDefaultModelParameters();

			// Construct the new API payload WITH EXPLICIT TYPE
			const payload: LollmsGeneratePayload = { // <--- Add type annotation here
				input_data: [{ type: "text", role: "user_prompt", data: promptText }],
				generation_type: "ttt" // Ensure text-to-text
			};

			const commitMessage = await client.generate(payload, parameters);

            if (commitMessage !== null) {
                progress.report({ increment: 20, message: "Applying message..." });
                gitUtils.updateCommitInputBox(repo, commitMessage); // The generate function now trims and removes fences
                vscode.window.setStatusBarMessage('LOLLMS commit message generated!', 3000);
                console.log("Successfully generated and set commit message.");
            } else {
                console.error("Failed to get commit message from LOLLMS client (returned null).");
                // Error message likely shown by client.generate
            }
        });
    });

    const generateCodeDisposable = vscode.commands.registerCommand('lollms.generateCodeFromComment', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active text editor found.');
            return;
        }

        const document = editor.document;
        const position = editor.selection.active; // Position where user invoked command

        // Find comment block *before* the cursor's line
        const commentText = editorUtils.findPrecedingCommentBlock(document, position);
        if (!commentText) {
            vscode.window.showInformationMessage('No preceding comment or docstring block found near the cursor to generate code from.');
            return;
        }
        // Determine the line number where the comment likely starts for indentation reference
        const commentStartLine = Math.max(0, position.line - (commentText.split('\n').length) -1); //Approximate start line
        const insertLine = position.line; // Insertion happens on the line the command was invoked


        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "LOLLMS: Generating code...",
            cancellable: true
        }, async (progress, token) => {
            const client = ensureClient();
            if (!client) { return; }

            progress.report({ increment: 10, message: "Preparing prompt..." });
            const targetLanguage = editor.document.languageId || "code"; // Use generic 'code' if unknown
            const suffix = config.getCodeGenPromptSuffix().replace(/```(\w+)?/, `\`\`\`${targetLanguage}`); // Hint language
            const promptText = `${config.getCodeGenPromptPrefix()}${commentText}${suffix}`;
            const parameters = config.getDefaultModelParameters();

             // Construct the new API payload
             const payload: LollmsGeneratePayload= {
                 input_data: [{ type: "text", role: "user_prompt", data: promptText }],
                 generation_type: "ttt"
             };


            if (token.isCancellationRequested) { console.log("Code generation cancelled by user before API call."); return; }

            progress.report({ increment: 30, message: "Requesting generation..." });
            const fullGeneratedResponse = await client.generate(payload, parameters); // Pass payload

            if (token.isCancellationRequested) {
                 console.log("Code generation cancelled by user during/after API call.");
                 vscode.window.setStatusBarMessage('LOLLMS code generation cancelled.', 3000);
                 return;
            }

            if (fullGeneratedResponse !== null) {
                progress.report({ increment: 50, message: "Processing result..." });
                // extractFirstCodeBlock now also removes fences
                const extractedCode = editorUtils.extractFirstCodeBlock(fullGeneratedResponse);

                if (extractedCode) { // Check if not empty string after extraction
                     progress.report({ increment: 10, message: "Inserting code..." });
                    try {
                        // Pass the line where comment started for indentation reference
                        await editorUtils.insertGeneratedCode(editor, commentStartLine, insertLine, extractedCode);
                        vscode.window.setStatusBarMessage('LOLLMS code generated and inserted!', 3000);
                        console.log("Successfully generated, extracted, and inserted code from comment.");
                    } catch (error: any) {
                         console.error("Error inserting generated code:", error);
                         vscode.window.showErrorMessage(`Failed to insert generated code: ${error.message}`);
                    }
                } else {
                     // This case might happen if the LLM responds with empty fences or just whitespace
                     console.error("Extracted code block was empty after processing LLM response.");
                     vscode.window.showWarningMessage(`LOLLMS response processed, but resulted in empty code.`);
                     console.warn("Full LLM response received (empty result after extraction):\n", fullGeneratedResponse);
                }
            } else {
                 console.error("Failed to get generated code from LOLLMS client (returned null).");
                 // Error likely shown by client
            }
        });
    });

    const generateWithContextDisposable = vscode.commands.registerCommand('lollms.generateWithContext', async () => {
        if (!contextManagerInstance) {
            vscode.window.showErrorMessage("LOLLMS Context Manager not initialized. Please reload the window.");
            return;
        }

        const currentContextUris = contextManagerInstance.getContextUris();
        if (currentContextUris.length === 0) {
            vscode.window.showInformationMessage(
                "No files currently in the LOLLMS context view. Add files using the view's buttons or context menus first.",
                { modal: true }
                );
            return;
        }

        const userInstruction = await vscode.window.showInputBox({
            prompt: `Enter your request based on the ${currentContextUris.length} file(s) in the LOLLMS context`,
            placeHolder: "e.g., Refactor the classes, Add documentation, Implement feature X...",
            title: "LOLLMS Context Request",
            ignoreFocusOut: true // Keep open even if focus lost
        });
        if (!userInstruction) {
            console.log("User cancelled context instruction input.");
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "LOLLMS: Processing context...",
            cancellable: true
        }, async (progress, token) => {
            const client = ensureClient();
            if (!client) { return; }

            progress.report({ increment: 10, message: `Building context from ${currentContextUris.length} file(s)...` });

            if (!contextManagerInstance) { // Re-check inside async callback
                vscode.window.showErrorMessage("Internal Error: Context Manager became unavailable."); return;
            }
            // Get the formatted context string (with headers, fences)
            const { context: formattedFileContext, fileCount, charCount, skippedFiles } = await contextManagerInstance.buildContextStringFromManagedFiles();

            if (skippedFiles.length > 0) {
                vscode.window.showWarningMessage(`Skipped ${skippedFiles.length} context file(s). Check Output > LOLLMS Copilot.`);
                console.warn("Context Manager skipped files:", skippedFiles);
            }
            if (token.isCancellationRequested) { console.log("Context building cancelled."); return; }

            // Construct the full prompt text combining prefixes, formatted context, suffix, and instruction
            const fullPromptText = `${config.getContextPromptPrefix()}${formattedFileContext}${config.getContextPromptSuffix()}${userInstruction}`;

            progress.report({ increment: 5, message: "Checking size..." });
            const totalChars = fullPromptText.length; // Use length of the final prompt text

            if (!await confirmLargeContext(totalChars)) { // Use updated confirmation function
                 vscode.window.showInformationMessage("Context generation cancelled by user due to large size estimate.");
                 return;
            }
            if (token.isCancellationRequested) { console.log("Context size confirmation cancelled."); return; }

             // Construct the new API payload using the combined prompt text
             const payload: LollmsGeneratePayload= {
                 input_data: [{ type: "text", role: "user_prompt", data: fullPromptText }],
                 generation_type: "ttt"
             };

            progress.report({ increment: 25, message: "Requesting generation..." });
            const parameters = config.getDefaultModelParameters();
            const generatedResult = await client.generate(payload, parameters); // Pass new payload

            if (token.isCancellationRequested) {
                 console.log("Context generation cancelled by user during/after API call.");
                 vscode.window.setStatusBarMessage('LOLLMS context generation cancelled.', 3000);
                 return;
            }

            if (generatedResult !== null) {
                progress.report({ increment: 60, message: "Displaying result..." });
                try {
                    // Basic language detection for the output document
                    let language = 'markdown'; // Default to markdown
                    const trimmedResult = editorUtils.extractFirstCodeBlock(generatedResult); // Use util to remove fences first

                    // Simple heuristics for common languages
                    if (trimmedResult.startsWith('def ') || trimmedResult.includes('import ') || trimmedResult.startsWith('class ')) language = 'python';
                    else if (trimmedResult.startsWith('function') || trimmedResult.includes('const ') || trimmedResult.includes('let ')) language = 'javascript';
                    else if (trimmedResult.startsWith('<') && trimmedResult.includes('>')) language = 'html';
                    else if (trimmedResult.startsWith('{') || trimmedResult.startsWith('[')) language = 'json';
                    else if (trimmedResult.startsWith('using ') || trimmedResult.startsWith('namespace ') || trimmedResult.startsWith('public class')) language = 'csharp';
                    else if (trimmedResult.startsWith('package ') || trimmedResult.startsWith('import java.') || trimmedResult.startsWith('public class')) language = 'java';


                    const resultDocument = await vscode.workspace.openTextDocument({
                        content: trimmedResult, // Show the code without fences
                        language: language
                    });
                    const activeEditor = vscode.window.activeTextEditor;
                    // Open beside the active editor if one exists, otherwise in the first column
                    const viewColumn = activeEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;
                    await vscode.window.showTextDocument(resultDocument, {
                         viewColumn: viewColumn,
                         preserveFocus: false, // Give focus to the new document
                         preview: false // Make it a persistent tab
                    });
                    vscode.window.setStatusBarMessage('LOLLMS context generation complete! Result opened.', 5000);
                    console.log("Successfully generated and displayed context-based result.");
                } catch (error: any) {
                    console.error("Error opening result document:", error);
                    vscode.window.showErrorMessage(`Failed to display result in new tab: ${error.message}`);
                    // Fallback: Show a snippet in an info message
                    vscode.window.showInformationMessage("LOLLMS Result (Preview):\n" + generatedResult.substring(0, 500) + "...", { modal: true });
                }
            } else {
                 console.error("Failed to get context generation result from LOLLMS client (returned null).");
                 // Error likely shown by client
            }
        });
    });

    const showWizardDisposable = vscode.commands.registerCommand('lollms.showSetupWizard', async () => {
        console.log("Manually triggering LOLLMS Copilot setup wizard...");
        await showSetupWizard(context);
    });

    // --- Context Management Commands ---

    const addCurrentFileDisposable = vscode.commands.registerCommand('lollms.context.addCurrentFile', async (uri?: vscode.Uri) => {
        if (!contextManagerInstance) { vscode.window.showErrorMessage("Context Manager not initialized."); return; }
        let fileUriToAdd: vscode.Uri | undefined = uri;

        // If called from command palette without explicit URI, use active editor
        if (!fileUriToAdd) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.scheme === 'file') {
                fileUriToAdd = editor.document.uri;
            } else if (editor) {
                 vscode.window.showWarningMessage("Cannot add non-file editor content to LOLLMS context.");
                 return;
            }
        }

        // Check if we have a file URI
        if (fileUriToAdd && fileUriToAdd.scheme === 'file') {
            const added = await contextManagerInstance.addUri(fileUriToAdd);
            if (added) {
                vscode.window.setStatusBarMessage(`Added to LOLLMS Context: ${vscode.workspace.asRelativePath(fileUriToAdd)}`, 3000);
            } else {
                vscode.window.showInformationMessage(`File already in LOLLMS Context: ${vscode.workspace.asRelativePath(fileUriToAdd)}`);
            }
        } else if (uri && uri.scheme !== 'file') { // If explicitly passed a non-file URI
            vscode.window.showWarningMessage(`Cannot add non-file resource '${uri.scheme}' to LOLLMS context.`);
        } else { // No active editor and no valid URI passed
            vscode.window.showWarningMessage("No active file editor or valid file selected to add to LOLLMS context.");
        }
    });

    const addAllDisposable = vscode.commands.registerCommand('lollms.context.addAllProjectFiles', async () => {
        if (!contextManagerInstance) { vscode.window.showErrorMessage("Context Manager not initialized."); return; }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showInformationMessage("No workspace folder open to add files from.");
            return;
        }
        const rootFolder = workspaceFolders[0].uri; // Use first workspace folder

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "LOLLMS: Adding project files...",
            cancellable: true
        }, async (progress, token) => {
            try {
                if (!contextManagerInstance) { throw new Error("Context Manager became unavailable during operation."); }

                const ignorePatterns = config.getContextIgnorePatterns();
                // Combine VSCode ignore patterns with .gitignore rules
                // Note: workspace.findFiles automatically respects files.exclude and search.exclude settings
                // We explicitly add the configured lollms patterns. .gitignore is respected by default findFiles.
                const excludePatternString = ignorePatterns.length > 0 ? `{${ignorePatterns.join(',')}}` : undefined;

                console.log(`Finding project files in ${rootFolder.fsPath}, excluding configured patterns and respecting .gitignore/settings.`);
                progress.report({ message: "Searching files...", increment: 10 });

                const maxResults = 2000; // Limit to avoid excessive processing
                const allFiles = await vscode.workspace.findFiles('**/*', excludePatternString, maxResults, token);

                if (token.isCancellationRequested) { console.log("File search cancelled."); return; }

                if (allFiles.length === 0) {
                     vscode.window.showInformationMessage("No project files found matching the criteria (respecting ignores).");
                     return;
                }
                 if (allFiles.length === maxResults) {
                     vscode.window.showWarningMessage(`Reached file search limit (${maxResults}). Some files might not have been included.`);
                 }

                let estimatedChars = 0;
                progress.report({ message: `Estimating size of ${allFiles.length} files...`, increment: 20 });

                // Estimate size quickly first
                for (const file of allFiles) {
                    if (token.isCancellationRequested) return;
                    try {
                        const stats = await vscode.workspace.fs.stat(file);
                        if(stats.type === vscode.FileType.File) { estimatedChars += stats.size; }
                    } catch { /* ignore stat errors */ }
                }

                 progress.report({ message: `Checking size estimate...`, increment: 10 });
                if (!await confirmLargeContext(estimatedChars)) { // Check size before adding
                    vscode.window.showInformationMessage("Operation cancelled by user due to large size estimate.");
                    return;
                 }
                if (token.isCancellationRequested) return;

                progress.report({ message: `Adding ${allFiles.length} files to context...`, increment: 40 });
                let addedCount = 0;
                for (const fileUri of allFiles) {
                     if (token.isCancellationRequested) break;
                     // Use the manager's internal method to add efficiently without saving state each time
                     const uriString = fileUri.toString();
                     if (!contextManagerInstance['_contextUris'].has(uriString)) { // Access private member for bulk add
                          contextManagerInstance['_contextUris'].add(uriString);
                          addedCount++;
                     }
                }
                if (token.isCancellationRequested) { console.log("Adding files cancelled."); return; }

                // Save state and notify UI *once* after adding all
                if (addedCount > 0) {
                    await contextManagerInstance['saveToState'](); // Access private save
                    contextManagerInstance['_onContextDidChange'].fire(); // Fire event
                     vscode.window.setStatusBarMessage(`Added ${addedCount} project files to LOLLMS Context.`, 4000);
                     console.log(`ContextManager: Added ${addedCount} project files in bulk.`);
                } else {
                     vscode.window.showInformationMessage("No new project files were added (already in context or none found).");
                }
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

        if (itemOrUri instanceof ContextItem) { uriToRemove = itemOrUri.resourceUri; }
        else if (itemOrUri instanceof vscode.Uri && itemOrUri.scheme === 'file') { uriToRemove = itemOrUri; }
        else { console.warn("lollms.context.removeFile called without valid file URI or ContextItem argument."); return; }

        if (uriToRemove) {
            const removed = await contextManagerInstance.removeUri(uriToRemove);
            if (removed) { vscode.window.setStatusBarMessage(`Removed from LOLLMS Context: ${vscode.workspace.asRelativePath(uriToRemove)}`, 3000); }
            else { console.warn(`Attempted to remove URI not found in context: ${uriToRemove.fsPath}`); }
        }
    });

    const clearAllDisposable = vscode.commands.registerCommand('lollms.context.clearAll', async () => {
        if (!contextManagerInstance) { vscode.window.showErrorMessage("Context Manager not initialized."); return; }
        if (contextManagerInstance.getContextUris().length === 0) { vscode.window.showInformationMessage("LOLLMS Context is already empty."); return; }

        const choice = await vscode.window.showWarningMessage(
            "Are you sure you want to clear all files from the LOLLMS context?",
            { modal: true }, // Make it a modal dialog
            "Clear All Context"
        );
        if (choice === "Clear All Context") {
             await contextManagerInstance.clearAll();
             vscode.window.setStatusBarMessage("LOLLMS Context Cleared.", 3000);
        }
    });

    const refreshDisposable = vscode.commands.registerCommand('lollms.context.refreshView', () => {
        if (contextTreeViewProvider) {
            contextTreeViewProvider.refresh();
            console.log("LOLLMS Context View refreshed manually.");
            vscode.window.setStatusBarMessage("Refreshed LOLLMS Context View.", 2000);
        } else {
            console.warn("Cannot refresh: Context Tree View Provider not initialized.");
        }
    });

	const viewCopyContextDisposable = vscode.commands.registerCommand('lollms.context.viewAndCopy', async () => {
		if (!contextManagerInstance) {
			vscode.window.showErrorMessage("Context Manager not initialized."); return;
		}

		const currentContextUris = contextManagerInstance.getContextUris();
		if (currentContextUris.length === 0) {
			vscode.window.showInformationMessage("LOLLMS Context is empty. Add files to view the context prompt."); return;
		}

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "LOLLMS: Building context prompt...",
			cancellable: false // Building is usually fast
		}, async (progress) => {
            if (!contextManagerInstance) { throw new Error("Context Manager became unavailable during operation."); } // Recheck

			progress.report({ increment: 20, message: `Reading ${currentContextUris.length} file(s)...` });

			// Get the fully formatted context string (files with headers/fences)
			const { context: formattedFileContext, fileCount, charCount, skippedFiles, estimatedTokens } = await contextManagerInstance.buildContextStringFromManagedFiles();

			if (skippedFiles.length > 0) {
				vscode.window.showWarningMessage(`Skipped ${skippedFiles.length} context file(s) while building prompt. Check Output > LOLLMS Copilot.`);
				console.warn("Skipped context files during view/copy:", skippedFiles);
			}

			progress.report({ increment: 70, message: "Formatting..." });

            // Construct the full prompt string for viewing, including prefixes/suffixes and a placeholder
            const fullPromptHeader = `--- LOLLMS Context Prompt (${fileCount} file(s), ~${estimatedTokens} tokens / ${charCount} chars) ---\n\n`;
			const fullPromptView = `${fullPromptHeader}${config.getContextPromptPrefix()}${formattedFileContext}${config.getContextPromptSuffix()}[YOUR_SPECIFIC_REQUEST_OR_INSTRUCTION_HERE]`;

			// Display in a new document
			try {
				const doc = await vscode.workspace.openTextDocument({
					content: fullPromptView,
					language: 'markdown' // Display as markdown for readability
				});

				await vscode.window.showTextDocument(doc, {
					 viewColumn: vscode.ViewColumn.Beside,
					 preserveFocus: false,
					 preview: false
				});

				// Copy the same content to clipboard
				await vscode.env.clipboard.writeText(fullPromptView);

				progress.report({ increment: 10, message: "Done!" });
				vscode.window.setStatusBarMessage('LOLLMS Context Prompt displayed and copied to clipboard!', 4000);
				console.log(`Displayed and copied context prompt (${charCount} chars, ~${estimatedTokens} tokens from ${fileCount} files).`);

			} catch (error: any) {
				 console.error("Error displaying or copying context prompt:", error);
				 vscode.window.showErrorMessage(`Failed to show/copy context prompt: ${error.message}`);
			}
		});
	});

    // --- Subscription Activation ---
    context.subscriptions.push(
        generateCommitDisposable,
        generateCodeDisposable,
        generateWithContextDisposable,
        showWizardDisposable,
        addCurrentFileDisposable,
        addAllDisposable,
        removeFileDisposable,
        clearAllDisposable,
        refreshDisposable,
        viewCopyContextDisposable
        // Add other disposables if any
    );

    console.log('LOLLMS Copilot extension activation sequence complete.');
}

/**
 * Shows a warning if the estimated context character count is large and asks for confirmation.
 * Uses settings to determine the threshold.
 * @param charCount The estimated character count of the context + prompt.
 * @returns True if the user confirms or if the count is below the threshold, false otherwise.
 */
async function confirmLargeContext(charCount: number): Promise<boolean> {
    const threshold = config.getContextCharWarningThreshold(); // Use the renamed config
    if (charCount > threshold) {
        const estimatedTokens = Math.ceil(charCount / config.APPROX_CHARS_PER_TOKEN); // Use constant
        const thresholdTokens = Math.ceil(threshold / config.APPROX_CHARS_PER_TOKEN);
        const userChoice = await vscode.window.showWarningMessage(
            `The estimated prompt size (~${charCount} chars / ~${estimatedTokens} tokens) exceeds the warning threshold of ${threshold} chars (~${thresholdTokens} tokens). This may consume many tokens or exceed model limits. Proceed anyway?`,
            { modal: true }, // Make it modal
            'Proceed',
            'Cancel'
        );
        return userChoice === 'Proceed';
    }
    return true; // Below threshold, proceed automatically
}

/**
 * Helper function to check if the setup wizard needs to be run automatically
 * on activation (e.g., first run or missing essential configuration).
 * Runs the wizard asynchronously if needed, without blocking activation flow.
 * @param context The extension context.
 */
async function checkAndRunWizard(context: vscode.ExtensionContext): Promise<void> {
    try {
        // Check if the global state flag indicates the wizard has *ever* completed successfully.
        const firstRunComplete = await context.globalState.get<boolean>('lollmsCopilotFirstRunComplete');
        // Also check if the current configuration is valid *now*.
        const currentConfigValid = config.isConfigValid();

        if (!firstRunComplete || !currentConfigValid) {
            console.log(`LOLLMS Copilot setup check: Needs setup (First Run: ${!firstRunComplete}, Current Config Valid: ${currentConfigValid}). Triggering wizard automatically...`);
            // Use setImmediate to avoid blocking activation further, though showSetupWizard is async anyway
            setImmediate(() => {
                showSetupWizard(context).catch(error => {
                     console.error("Error running automatic setup wizard:", error);
                });
            });
        } else {
            console.log("LOLLMS Copilot setup check: Wizard not needed automatically (completed previously and config is currently valid).");
        }
    } catch (error) {
         console.error("Error during automatic wizard check/launch logic:", error);
    }
}

/**
 * Displays the setup wizard UI to configure the lollms-server connection.
 * Guides the user through entering the server URL, performs a health check,
 * and conditionally prompts for an API key if the server indicates it's required.
 * Prompts for the default binding instance name after successful connection.
 * Allows the user to retry entering the URL if the health check fails.
 * Saves valid configuration to global VS Code settings and marks setup as complete.
 * @param context The extension context for saving global state.
 */
async function showSetupWizard(context: vscode.ExtensionContext): Promise<void> {
    console.log("Starting LOLLMS Copilot setup wizard (manual or auto)...");
    const configureButton = "Configure Server URL Now";
    const choice = await vscode.window.showInformationMessage(
        'Configure LOLLMS Copilot Server Connection',
        { modal: true },
        configureButton,
        "Cancel Setup"
    );

    if (choice !== configureButton) {
        vscode.window.showInformationMessage("Configuration process cancelled.");
        return;
    }

    let currentUrl = config.getServerUrl() || "http://localhost:9601"; // Start with current or default
    let healthCheckOk = false;
    let apiKeyRequired = false;
    let serverVersion: string | null = null;
    let userCancelled = false;
    const configTarget = vscode.ConfigurationTarget.Global; // Save globally

    // Loop for URL entry and validation
    while (!healthCheckOk && !userCancelled) {
        const urlInput = await vscode.window.showInputBox({
            prompt: "Enter the base URL of your running lollms-server",
            placeHolder: "e.g., http://localhost:9601",
            value: currentUrl,
            ignoreFocusOut: true,
            validateInput: (value: string) => {
                if (!value) { return 'URL cannot be empty.'; }
                try {
                    const parsedUrl = new URL(value);
                    if (!parsedUrl.protocol.startsWith('http')) {
                        return 'URL must start with http:// or https://';
                    }
                    return null; // Input is valid URL structure
                } catch (_) {
                    return 'Please enter a valid URL (e.g., http://host:port)';
                }
            }
        });

        if (urlInput === undefined) { // User cancelled URL input
            userCancelled = true;
            break;
        }

        currentUrl = urlInput.trim().replace(/\/$/, ''); // Trim and remove trailing slash
        const healthUrl = `${currentUrl}/health`; // Use the dedicated health endpoint

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Connecting to LOLLMS server...`,
            cancellable: false // Health check should be fast
        }, async (progress) => {
            try {
                progress.report({ message: `Checking ${healthUrl}...` });
                console.log(`Performing health check request to: ${healthUrl}`);
                // Use fetch directly for health check, timeout
                const response = await fetch(healthUrl, { method: 'GET', timeout: 10000 }); // 10 second timeout

                if (!response.ok) {
                    let errorText = `Server responded with status ${response.status}`;
                    try {
                        const errorJson = await response.json();
                        errorText = errorJson.detail || JSON.stringify(errorJson); // Try to get detail message
                    } catch (e) { errorText = await response.text(); } // Fallback to text
                    throw new Error(errorText);
                }

                const healthData = await response.json() as { status: string; api_key_required?: boolean; version?: string };

                if (healthData.status !== 'ok') { // Check the status field in the response
                    throw new Error(`Server status reported: ${healthData.status || 'Unknown'}`);
                }

                // --- Health Check Successful ---
                healthCheckOk = true;
                apiKeyRequired = healthData.api_key_required === true; // Explicit check for true
                serverVersion = healthData.version || null;
                progress.report({ message: "Connection successful!" });
                vscode.window.showInformationMessage(`Connected to LOLLMS Server v${serverVersion || 'unknown'}! API Key Required: ${apiKeyRequired ? 'Yes' : 'No'}`);

            } catch (error: any) {
                healthCheckOk = false;
                console.error(`Health check failed for ${currentUrl}:`, error);
                const retryChoice = await vscode.window.showWarningMessage(
                    `Failed to connect or verify server at '${currentUrl}'. Check URL, server status, and CORS settings.\n\nError: ${error.message || 'Unknown connection error'}`,
                    { modal: true },
                    "Retry URL", // Offer retry
                    "Cancel Setup"
                );
                if (retryChoice !== "Retry URL") {
                    userCancelled = true; // User chose to cancel
                }
                // If they chose Retry, the loop continues
            }
        });
    } // End URL loop

    if (userCancelled) {
        vscode.window.showWarningMessage("LOLLMS Copilot setup cancelled.");
        return;
    }

    // Proceed only if health check was successful and URL is confirmed
    if (healthCheckOk && currentUrl) {
        // Save the validated URL
        await vscode.workspace.getConfiguration('lollms').update('serverUrl', currentUrl, configTarget);
        console.log(`LOLLMS Server URL saved globally: ${currentUrl}`);

        let apiKeyFlowCompleted = !apiKeyRequired; // Assume completed if no key needed

        // Prompt for API Key only if required
        if (apiKeyRequired) {
            console.log("Server requires API Key, prompting user...");
            const apiKeyInput = await vscode.window.showInputBox({
                prompt: `Enter the API Key for the LOLLMS server at ${currentUrl}`,
                placeHolder: "Your LOLLMS Server API Key (leave blank if none)",
                password: true, // Mask input
                ignoreFocusOut: true,
                value: config.getApiKey() || "" // Pre-fill if already set
            });

            if (apiKeyInput !== undefined) { // User entered something or confirmed blank
                await vscode.workspace.getConfiguration('lollms').update('apiKey', apiKeyInput.trim(), configTarget);
                console.log(`LOLLMS API Key saved globally (length: ${apiKeyInput?.trim().length || 0}).`);
                apiKeyFlowCompleted = true;
            } else { // User cancelled API key prompt
                vscode.window.showWarningMessage("API Key prompt cancelled. Set 'lollms.apiKey' in settings manually if required.");
                apiKeyFlowCompleted = false; // Mark flow as incomplete
            }
        }

        // --- Prompt for Default Binding Instance ---
        let bindingFlowCompleted = false;
        if (apiKeyFlowCompleted) { // Only ask for binding if previous steps ok
             console.log("Prompting for default binding instance name...");
             const bindingInput = await vscode.window.showInputBox({
                  prompt: "(Required) Enter the Default Binding Instance Name",
                  placeHolder: "e.g., my_ollama_gpu, openai_gpt4o",
                  value: config.getDefaultBindingInstance() || "", // Pre-fill if exists
                  ignoreFocusOut: true,
                  validateInput: (value: string) => value ? null : "Binding instance name cannot be empty."
             });

             if (bindingInput !== undefined) {
                  const bindingName = bindingInput.trim();
                  await vscode.workspace.getConfiguration('lollms').update('defaultBindingInstance', bindingName, configTarget);
                  console.log(`Default Binding Instance saved globally: ${bindingName}`);
                  bindingFlowCompleted = true;
             } else {
                  vscode.window.showWarningMessage("Default Binding Instance prompt cancelled. Set 'lollms.defaultBindingInstance' in settings.");
                  bindingFlowCompleted = false;
             }
        }

        // --- Finalize Setup ---
        if (apiKeyFlowCompleted && bindingFlowCompleted) {
            // Mark setup as complete only if all required steps finished
            await context.globalState.update('lollmsCopilotFirstRunComplete', true);
            console.log("Marked LOLLMS Copilot first run wizard as complete.");
            vscode.window.showInformationMessage("LOLLMS Copilot configuration updated successfully!");
            // Re-initialize client with potentially new settings
            ensureClient();
        } else {
            console.log("Setup wizard finished, but API key or binding step was skipped/cancelled. First run flag not set.");
            vscode.window.showWarningMessage("Server URL saved, but API key or binding setup was skipped/cancelled. Configure manually if needed.");
        }

    } else if (!userCancelled) {
        // Should not happen if loop logic is correct, but handle defensively
        console.error("Wizard finished unexpectedly after health check loop without success or cancellation.");
        vscode.window.showErrorMessage("An unexpected error occurred during setup after URL entry. Please configure manually via VS Code Settings.");
    }
}

/**
 * Deactivation function called by VS Code when the extension is unloaded.
 * Performs cleanup tasks like nullifying global instances.
 */
export function deactivate(): void {
    console.log('LOLLMS Copilot extension is deactivated.');
    lollmsClient = null;
    contextManagerInstance = null;
    contextTreeViewProvider = null;
    // Dispose subscriptions if needed (VS Code might handle this automatically)
}

// Export constants used elsewhere if needed (like APPROX_CHARS_PER_TOKEN)
export const APPROX_CHARS_PER_TOKEN = 4;
