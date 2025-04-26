// src/extension.ts
import * as vscode from 'vscode';
// Make sure to install node-fetch v2: npm install node-fetch@2 @types/node-fetch@2 --save-dev
import fetch from 'node-fetch';

// Import helper modules
import * as config from './config';
import * as gitUtils from './gitUtils';
import * as editorUtils from './editorUtils';
import * as contextManager from './contextManager';
import { LollmsClient } from './lollmsClient';

// --- Global Client Instance ---
// This variable will hold the initialized LOLLMS client.
// It's kept global to avoid reinitializing on every command if settings haven't changed.
let lollmsClient: LollmsClient | null = null;

/**
 * Ensures the LOLLMS client is initialized with current settings from VS Code preferences.
 * Checks if the essential configuration (server URL) is present.
 * If configuration is invalid, it shows an error message to the user.
 * If the client doesn't exist or settings have changed, it creates a new instance.
 * @returns The initialized LollmsClient instance, or null if configuration is invalid or initialization fails.
 */
function ensureClient(): LollmsClient | null {
    // 1. Validate Essential Configuration
    if (!config.isConfigValid()) {
        config.showConfigurationError(); // Inform user via VS Code notification
        return null; // Cannot proceed without valid config
    }

    // 2. Get Current Settings
    const serverUrl = config.getServerUrl() as string; // Assured non-null by isConfigValid
    const apiKey = config.getApiKey(); // API Key is optional

    // 3. Initialize or Update Client Instance
    // Re-initialize if client doesn't exist OR if URL/API Key has changed since last init.
    // Note: Simple comparison works for strings and undefined.
    if (!lollmsClient || lollmsClient['baseUrl'] !== serverUrl || lollmsClient['apiKey'] !== apiKey) {
        try {
            console.log(`Initializing/Updating LOLLMS Client. URL: ${serverUrl}, API Key Set: ${!!apiKey}`);
            lollmsClient = new LollmsClient(serverUrl, apiKey);
        } catch (error: any) {
             // Should not happen with current LollmsClient constructor, but good practice
             console.error("Unexpected error during LOLLMS Client initialization:", error);
             vscode.window.showErrorMessage(`Failed to create LOLLMS Client instance: ${error.message}`);
             lollmsClient = null; // Ensure client is null on error
             return null;
        }
    }
    return lollmsClient;
}

// --- Extension Activation Function (Entry Point) ---
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('LOLLMS Copilot extension is activating...');

    // --- Check Configuration Status on Activation ---
    // Run setup wizard asynchronously if essential config (URL) is missing
    // or if the 'first run' flag hasn't been set yet.
    // This runs without 'await' initially to avoid blocking VS Code activation
    // if the user takes time interacting with the wizard.
    checkAndRunWizard(context).catch(err => {
         // Log any errors from the wizard check itself
         console.error("Error during initial check/wizard launch:", err);
    });

    // --- Register Extension Commands ---

    // 1. Command: Generate Commit Message
    const generateCommitDisposable = vscode.commands.registerCommand('lollms.generateCommitMessage', async () => {
        // Show progress in the Source Control view's status bar
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.SourceControl,
            title: "LOLLMS: Generating commit message...",
            cancellable: false // Generation itself is async, true cancellation needs more work
        }, async (progress) => {
            // Ensure client is ready and config is valid
            const client = ensureClient();
            if (!client) { return; } // Config error shown by ensureClient

            progress.report({ increment: 10, message: "Accessing Git..." });
            const git = await gitUtils.getGitAPI();
            if (!git) { return; } // Error message shown in gitUtils

            const repositories = await git.getRepositories();
            if (!repositories || repositories.length === 0) {
                vscode.window.showInformationMessage('No Git repository found in the current workspace.');
                return;
            }
            const repo = repositories[0]; // Assume the first repository

            progress.report({ increment: 20, message: "Getting staged changes..." });
            const diff = await gitUtils.getStagedChangesDiff(repo);

            if (diff === undefined) {
                // Error likely shown by getStagedChangesDiff
                console.error("Failed to get staged changes diff (returned undefined).");
                return;
            }
            if (!diff.trim()) {
                vscode.window.showInformationMessage('No staged changes found to generate commit message from.');
                return;
            }

            progress.report({ increment: 50, message: "Requesting generation..." });
            // Construct the prompt using configured prefix and suffix
            const fullPrompt = `${config.getCommitMsgPromptPrefix()}${diff}${config.getCommitMsgPromptSuffix()}`;
            const parameters = config.getDefaultModelParameters(); // Use defaults for consistency

            const commitMessage = await client.generate(fullPrompt, parameters);

            if (commitMessage !== null) { // Check if generation succeeded
                progress.report({ increment: 20, message: "Applying message..." });
                gitUtils.updateCommitInputBox(repo, commitMessage); // Update the SCM input box
                vscode.window.setStatusBarMessage('LOLLMS commit message generated!', 3000); // Brief confirmation
                console.log("Successfully generated and set commit message.");
            } else {
                // Error message is usually shown by the client.generate() method on failure
                console.error("Failed to get commit message from LOLLMS client (returned null).");
            }
        });
    });

    // 2. Command: Generate Code from Comment/Docstring
    const generateCodeDisposable = vscode.commands.registerCommand('lollms.generateCodeFromComment', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active text editor found.');
            return;
        }

        const document = editor.document;
        const position = editor.selection.active;
        const comment = editorUtils.findPrecedingCommentBlock(document, position);

        if (!comment) {
            vscode.window.showInformationMessage('No preceding comment or docstring block found near the cursor.');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "LOLLMS: Generating code from comment...",
            cancellable: true
        }, async (progress, token) => {
            const client = ensureClient();
            if (!client) { return; }

            progress.report({ increment: 10, message: "Preparing prompt..." });
            // --- Determine target language (optional, default to python for suffix) ---
            // You could try to infer this from the editor's language ID if needed
            const targetLanguage = "python"; // Assuming python for now based on suffix
            const suffix = config.getCodeGenPromptSuffix().replace('python', targetLanguage); // Adjust suffix if needed
            const fullPrompt = `${config.getCodeGenPromptPrefix()}${comment}${suffix}`;
            const parameters = config.getDefaultModelParameters();

            if (token.isCancellationRequested) return;

            progress.report({ increment: 30, message: "Requesting generation..." });
            // Get the FULL response from the LLM
            const fullGeneratedResponse = await client.generate(fullPrompt, parameters);

            if (token.isCancellationRequested) {
                 console.log("Code generation cancelled by user.");
                 vscode.window.setStatusBarMessage('LOLLMS code generation cancelled.', 3000);
                 return;
            }

            if (fullGeneratedResponse !== null) {
                progress.report({ increment: 50, message: "Extracting code block..." });

                // --- EXTRACT THE CODE BLOCK ---
                const extractedCode = editorUtils.extractFirstCodeBlock(fullGeneratedResponse, targetLanguage);
                // --- END EXTRACTION ---

                if (extractedCode !== null) {
                     progress.report({ increment: 10, message: "Inserting code..." });
                    try {
                        // Insert ONLY the extracted code content
                        await editorUtils.insertGeneratedCode(editor, position, extractedCode);
                        vscode.window.setStatusBarMessage('LOLLMS code generated and inserted!', 3000);
                        console.log("Successfully generated, extracted, and inserted code from comment.");
                    } catch (error: any) {
                         console.error("Error inserting extracted code:", error);
                         vscode.window.showErrorMessage(`Failed to insert extracted code: ${error.message}`);
                    }
                } else {
                     // Handle case where LLM response was received but no valid block found
                     console.error("Failed to extract Python code block from LLM response.");
                     vscode.window.showWarningMessage(`LOLLMS response received, but failed to find a '${targetLanguage}' code block. Check the Output > LOLLMS Copilot channel.`);
                     // Optionally show the raw response in an output channel or new document for debugging
                     console.warn("Full LLM response:\n", fullGeneratedResponse);
                }
            } else {
                // Error message handled by client.generate()
                 console.error("Failed to get generated code from LOLLMS client (returned null).");
            }
        });
    });

    // 3. Command: Generate/Modify Code with Context
    const generateWithContextDisposable = vscode.commands.registerCommand('lollms.generateWithContext', async () => {
        const editor = vscode.window.activeTextEditor;
        const currentFileUri = editor?.document.uri;

        // --- Step 1: Ask user for context source ---
        const contextOptions: vscode.QuickPickItem[] = [
            { label: "$(file-code) Current File", description: "Use the content of the currently active file." },
            { label: "$(files) Selected Files...", description: "Choose specific files from the workspace." },
            { label: "$(selection) Selected Text (+ Files...)", description: "Use selected text and choose additional files." },
            // { label: "$(project) Entire Project (Experimental!)", description: "Attempt to use relevant files from the project (High token usage!)." } // Defer
        ];
        const selectedOption = await vscode.window.showQuickPick(contextOptions, {
            placeHolder: "Select context source for LOLLMS Generation",
            title: "LOLLMS Context Selection",
            ignoreFocusOut: true
        });
        if (!selectedOption) {
            console.log("Context selection cancelled by user.");
            return;
        }

        let contextFiles: vscode.Uri[] = [];
        let selectedText = "";

        // --- Step 2: Gather Context based on user choice ---
        try {
            if (selectedOption.label.includes("Current File")) {
                if (currentFileUri) {
                    contextFiles = [currentFileUri];
                } else {
                    vscode.window.showErrorMessage("No active file editor to use as context.");
                    return;
                }
            } else if (selectedOption.label.includes("Selected Files...")) {
                const pickedFiles = await vscode.window.showOpenDialog({
                    canSelectMany: true,
                    openLabel: 'Add File(s) to Context',
                    title: 'Select Files for LOLLMS Context'
                    // Consider adding filters based on common code file types
                });
                if (pickedFiles && pickedFiles.length > 0) {
                    contextFiles = pickedFiles;
                } else {
                     vscode.window.showInformationMessage("No files selected for context.");
                     return;
                }
            } else if (selectedOption.label.includes("Selected Text")) {
                if (editor && !editor.selection.isEmpty) {
                     selectedText = editor.document.getText(editor.selection);
                } else {
                     // Handle case where user selects option but has no text selected
                     const reselectChoice = await vscode.window.showWarningMessage(
                          "No text is currently selected in the editor.",
                          { modal: true },
                          "Select Text and Retry", "Cancel"
                     );
                     if (reselectChoice !== "Select Text and Retry") return;
                     // Instruct user to select text - they'll need to re-run command
                     vscode.window.showInformationMessage("Please select the text you want to include, then run the command again.");
                     return;
                }
                // Allow picking additional files *after* confirming text selection
                const pickedFiles = await vscode.window.showOpenDialog({
                    canSelectMany: true,
                    openLabel: 'Add Additional File(s) to Context',
                    title: 'Select Additional Files for LOLLMS Context'
                });
                // Allow proceeding even if no *additional* files picked
                if (pickedFiles) {
                     contextFiles = pickedFiles;
                }
            }
            // Handle 'Entire Project' case here if implemented later
            else { return; } // Should not happen with defined options

        } catch (error: any) {
             console.error("Error during context gathering step:", error);
             vscode.window.showErrorMessage(`Error gathering context: ${error.message}`);
             return;
        }

        if (contextFiles.length === 0 && !selectedText) {
            // This case should be less likely now due to checks above, but keep as safeguard
            vscode.window.showInformationMessage("No context provided (no files chosen or text selected).");
            return;
        }

        // --- Step 3: Get User Instruction ---
        const userInstruction = await vscode.window.showInputBox({
            prompt: "Enter your generation or modification request based on the provided context",
            placeHolder: "e.g., Refactor the selected function..., Add docs to these files..., Implement a feature using this context...",
            title: "LOLLMS Context Request",
            ignoreFocusOut: true
        });
        if (!userInstruction) {
            console.log("User cancelled instruction input.");
            return;
        }

        // --- Step 4: Execute Generation with Progress ---
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "LOLLMS: Processing context and generating...",
            cancellable: true
        }, async (progress, token) => {
            // Ensure client is ready
            const client = ensureClient();
            if (!client) { return; }

            progress.report({ increment: 10, message: "Building context string..." });

            // Build the combined context string from files
            const { context: fileContext, fileCount, charCount, skippedFiles } = await contextManager.buildContextStringFromFiles(contextFiles);

            if (skippedFiles.length > 0) {
                vscode.window.showWarningMessage(`Skipped ${skippedFiles.length} context file(s) due to size or errors. Check Output > LOLLMS Copilot for details.`);
                console.warn("Skipped context files:", skippedFiles);
            }
            if (token.isCancellationRequested) return;

            // Estimate total size and warn user if large
            progress.report({ increment: 5, message: "Checking context size..." });
            const prefixLength = config.getContextPromptPrefix().length;
            const suffixLength = config.getContextPromptSuffix().length;
            const totalChars = charCount + selectedText.length + userInstruction.length + prefixLength + suffixLength;
            if (!await contextManager.confirmLargeContext(totalChars)) {
                vscode.window.showInformationMessage("Context generation cancelled by user due to large size.");
                return;
            }
            if (token.isCancellationRequested) return;

            // Construct the final prompt for the LLM
            let fullPrompt = config.getContextPromptPrefix();
            fullPrompt += fileContext; // Add formatted file contents
            if (selectedText) {
                 // Clearly delineate selected text within the prompt
                 fullPrompt += `\n--- SELECTED TEXT FROM ACTIVE EDITOR ---\n${selectedText}\n--- END SELECTED TEXT ---\n\n`;
            }
            fullPrompt += config.getContextPromptSuffix();
            fullPrompt += userInstruction; // Append the user's specific request

            progress.report({ increment: 25, message: "Requesting generation from LOLLMS..." });
            const parameters = config.getDefaultModelParameters();
            const generatedResult = await client.generate(fullPrompt, parameters);

            if (token.isCancellationRequested) {
                 console.log("Context generation cancelled by user.");
                 vscode.window.setStatusBarMessage('LOLLMS context generation cancelled.', 3000);
                 return;
            }

            if (generatedResult !== null) {
                progress.report({ increment: 60, message: "Displaying result..." });

                // Display Result in a new Untitled Document for review
                try {
                    // Attempt basic language detection for syntax highlighting
                    let language = 'markdown';
                    const trimmedResult = generatedResult.trim();
                    if (trimmedResult.startsWith('def ') || trimmedResult.startsWith('import ') || trimmedResult.startsWith('class ')) language = 'python';
                    else if (trimmedResult.startsWith('function') || trimmedResult.startsWith('const ') || trimmedResult.startsWith('let ')) language = 'javascript'; // or typescript
                    else if (trimmedResult.startsWith('<')) language = 'html';

                    const resultDocument = await vscode.workspace.openTextDocument({
                        content: generatedResult,
                        language: language
                    });
                    // Open beside the current editor, or in the first column if none active
                    const viewColumn = editor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;
                    await vscode.window.showTextDocument(resultDocument, {
                         viewColumn: viewColumn,
                         preserveFocus: false, // Give focus to the new document
                         preview: false // Make it a permanent tab
                    });
                    vscode.window.setStatusBarMessage('LOLLMS context generation complete! Result opened.', 5000);
                    console.log("Successfully generated and displayed context-based result.");
                } catch (error: any) {
                    console.error("Error opening result document:", error);
                    vscode.window.showErrorMessage(`Failed to display result in new tab: ${error.message}`);
                    // Fallback: Show a snippet in an information message if document display fails
                    vscode.window.showInformationMessage("LOLLMS Result (Preview):\n" + generatedResult.substring(0, 500) + "...", { modal: true });
                }
            } else {
                // Error message handled by client.generate()
                console.error("Failed to get context generation result from LOLLMS client (returned null).");
            }
        });
    });
	const showWizardDisposable = vscode.commands.registerCommand('lollms.showSetupWizard', async () => {
		console.log("Manually triggering setup wizard...");
		// Directly call the wizard logic, regardless of current config state
		await showSetupWizard(context);
	});
    // --- Add all command disposables to the context subscriptions ---
    context.subscriptions.push(
        generateCommitDisposable,
        generateCodeDisposable,
        generateWithContextDisposable,
		showWizardDisposable
    );

    console.log('LOLLMS Copilot extension activation complete.');
} // End activate

// --- Setup Wizard Function ---
async function checkAndRunWizard(context: vscode.ExtensionContext): Promise<void> {
    try {
        const firstRunComplete = context.globalState.get<boolean>('lollmsCopilotFirstRunComplete');
        const serverUrlSet = !!config.getServerUrl(); // Check initial config state

        if (!firstRunComplete || !serverUrlSet) {
            console.log("LOLLMS Copilot setup needed (first run or missing URL). Triggering wizard...");
            // Run the wizard asynchronously, logging any potential errors from it
            await showSetupWizard(context);
        } else {
            console.log("LOLLMS Copilot setup wizard not needed (already run or URL configured).");
        }
    } catch (error) {
         // Catch errors during the check/run decision itself
         console.error("Error during wizard check/launch:", error);
    }
}

async function showSetupWizard(context: vscode.ExtensionContext): Promise<void> {
    console.log("Starting LOLLMS Copilot setup wizard...");
    const configureButton = "Configure Server URL Now";
    const choice = await vscode.window.showInformationMessage(
        'Welcome to LOLLMS Copilot! Please configure your lollms-server URL to get started.',
        { modal: true }, // Make initial prompt modal
        configureButton,
        "Configure Later"
    );

    if (choice !== configureButton) {
        vscode.window.showInformationMessage("Configuration postponed. Set the URL in VS Code Settings ('lollms.serverUrl') when ready.");
        return; // Exit wizard early
    }

    let currentUrl = config.getServerUrl() || "http://localhost:9600"; // Start with existing or default
    let healthCheckOk = false;
    let apiKeyRequired = false;
    let serverVersion: string | null = null;
    let userCancelled = false;
    const configTarget = vscode.ConfigurationTarget.Global; // Save settings globally

    // Loop for URL entry and health check retry
    while (!healthCheckOk && !userCancelled) {
        const urlInput = await vscode.window.showInputBox({
            prompt: "Enter the base URL of your running lollms-server",
            placeHolder: "e.g., http://localhost:9600",
            value: currentUrl, // Show current value for editing/retry
            ignoreFocusOut: true, // Keep input box open
            validateInput: (value: string) => {
                if (!value) { return 'URL cannot be empty.'; }
                try {
                    const parsedUrl = new URL(value);
                    if (!parsedUrl.protocol.startsWith('http')) {
                        return 'URL must start with http:// or https://';
                    }
                    return null; // Input is valid
                } catch (_) {
                    return 'Please enter a valid URL (e.g., http://host:port)';
                }
            }
        });

        if (urlInput === undefined) { // User pressed Esc or closed the box
            userCancelled = true;
            vscode.window.showWarningMessage("Configuration cancelled.");
            break; // Exit the loop
        }

        currentUrl = urlInput.trim().replace(/\/$/, ''); // Update URL for health check
        const healthUrl = `${currentUrl}/api/v1/health`;

        // Perform Health Check with Progress indicator
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Checking LOLLMS server at ${currentUrl}...`,
            cancellable: false // Prevent cancelling the check itself
        }, async (progress) => {
            try {
                progress.report({ message: "Sending request...", increment: 30 });
                console.log(`Performing health check at: ${healthUrl}`);
                const response = await fetch(healthUrl, { method: 'GET', timeout: 10000 }); // 10 sec timeout
                progress.report({ message: "Processing response...", increment: 40 });

                if (!response.ok) {
                    let errorText = `Server responded with status ${response.status}`;
                    try { errorText = await response.text(); } catch (_) { /* ignore */ } // Try to get body text
                    throw new Error(errorText);
                }

                const healthData = await response.json() as { status: string; api_key_required?: boolean; version?: string };

                if (healthData.status !== 'ok') {
                    throw new Error(`Server status reported: ${healthData.status}`);
                }

                // --- Health Check Successful ---
                healthCheckOk = true; // Set flag to exit the while loop
                apiKeyRequired = healthData.api_key_required === true;
                serverVersion = healthData.version || null;
                progress.report({ message: "Server OK!", increment: 30 });
                vscode.window.showInformationMessage(`Successfully connected to LOLLMS Server v${serverVersion || 'unknown'}! API Key Required: ${apiKeyRequired ? 'Yes' : 'No'}`);

            } catch (error: any) {
                // --- Health Check Failed ---
                healthCheckOk = false; // Stay in the loop
                console.error(`Health check failed for ${currentUrl}:`, error);
                // Ask user to retry the URL or cancel the entire setup
                const retryChoice = await vscode.window.showWarningMessage(
                    `Failed to connect or verify server at '${currentUrl}'. Please check the URL and ensure the server is running and accessible.\n\nError: ${error.message || 'Unknown connection error'}`,
                    { modal: true }, // Important: Block until user chooses
                    "Retry URL",
                    "Cancel Setup"
                );

                if (retryChoice !== "Retry URL") {
                    userCancelled = true; // User chose to cancel
                }
                // If "Retry URL", the loop continues, prompting for URL again
            }
        }); // End withProgress
    } // End while loop

    // --- Post-Loop Actions ---

    if (userCancelled) {
        vscode.window.showWarningMessage("LOLLMS Copilot setup cancelled.");
        return; // Exit function if user cancelled
    }

    // If we exit the loop because healthCheckOk is true
    if (healthCheckOk && currentUrl) {
        // Save the verified URL
        await vscode.workspace.getConfiguration('lollms').update('serverUrl', currentUrl, configTarget);
        console.log(`LOLLMS Server URL saved globally: ${currentUrl}`);

        // --- Conditionally Prompt for API Key ---
        let apiKeyFlowComplete = !apiKeyRequired; // Considered complete if not needed
        if (apiKeyRequired) {
            console.log("Server requires API Key, prompting user...");
            const apiKey = await vscode.window.showInputBox({
                prompt: `Enter the API Key for the LOLLMS server at ${currentUrl}`,
                placeHolder: "Your LOLLMS Server API Key (leave blank if none)",
                password: true, // Mask input
                ignoreFocusOut: true,
                value: config.getApiKey() || "" // Pre-fill from existing settings
            });

            if (apiKey !== undefined) { // User submitted (even empty), didn't cancel
                await vscode.workspace.getConfiguration('lollms').update('apiKey', apiKey.trim(), configTarget);
                console.log(`LOLLMS API Key saved globally (length: ${apiKey?.trim().length || 0}).`);
                apiKeyFlowComplete = true; // Mark this step complete
            } else {
                vscode.window.showWarningMessage("API Key prompt cancelled. Features requiring the key may not work. Set 'lollms.apiKey' in settings if needed.");
                apiKeyFlowComplete = false; // User explicitly cancelled the key step
            }
        }

        // Mark setup as logically complete *if* URL was saved *and* the API key flow was handled
        if (apiKeyFlowComplete) {
            await context.globalState.update('lollmsCopilotFirstRunComplete', true);
            console.log("Marked LOLLMS Copilot first run wizard as complete.");
        } else {
             console.log("First run wizard not marked complete (API key prompt likely skipped).");
        }

    } else if (!userCancelled) {
         // This case should ideally not be reached if the loop logic is correct,
         // but handles exiting the loop without success or cancellation.
         console.error("Wizard finished unexpectedly without success or cancellation.");
         vscode.window.showErrorMessage("An unexpected error occurred during setup.");
    }
}

// --- Extension Deactivation Function ---
export function deactivate(): void {
    console.log('LOLLMS Copilot extension is deactivated.');
    // Perform any cleanup if necessary (e.g., close network connections if any were kept open)
    lollmsClient = null; // Clear client instance
}