import * as vscode from 'vscode';

// Interfaces for Git API (more complete structure might be needed depending on usage)
interface GitExtension {
    getAPI(version: number): Promise<API>;
}
interface API {
    repositories: Repository[];
    getRepositories(): Promise<Repository[]>;
    state: 'uninitialized' | 'idle' | 'initialized';
    // Add other potential API methods if needed
}
interface Repository {
    inputBox: { value: string };
    state: { indexChanges: Change[] };
    diff(cached?: boolean): Promise<string>;
    // Using exec is often more reliable for specific commands if available
    exec?(command: string, args?: string[], options?: any): Promise<{ stdout: string; stderr: string; exitCode: number }>;
    // Add other potential Repository properties/methods if needed
}
interface Change {
    uri: vscode.Uri;
    // Add other potential change properties if needed (status, etc.)
}


/**
 * Gets the VS Code built-in Git extension API. Handles activation if necessary.
 * @returns The Git API instance, or undefined if the extension is not available or activation fails.
 */
export async function getGitAPI(): Promise<API | undefined> {
    try {
        const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
        if (!extension) {
            vscode.window.showErrorMessage('Git extension (`vscode.git`) is not available. Please install or enable it.');
            console.error("Git extension 'vscode.git' not found.");
            return undefined;
        }
        // Activate the extension if it's not already active.
        // It's generally better to let VS Code handle activation via activationEvents,
        // but explicit activation can be a fallback.
        if (!extension.isActive) {
            console.log("Activating Git extension...");
            await extension.activate();
            console.log("Git extension activated.");
        }
        // Request API version 1
        const api = await extension.exports.getAPI(1);
        // Add a small delay or check API state if activation was just forced
        if (api.state !== 'initialized') {
             console.warn(`Git API state is '${api.state}'. Waiting briefly...`);
             await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 sec
             if (api.state === 'uninitialized' || api.state === 'idle') {
                console.warn(`Git API state is '${api.state}'. Waiting briefly...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                if (api.state === 'uninitialized' || api.state === 'idle') { // Re-check
                     console.error(`Git API did not initialize quickly after activation. State: ${api.state}`);
                     vscode.window.showWarningMessage('Git extension took too long to initialize. Please try the command again.');
                     return undefined;
                }
            }
        }
        return api;
    } catch (error) {
        console.error("Error getting Git API:", error);
        vscode.window.showErrorMessage('Failed to get Git API. See console for details.');
        return undefined;
    }
}

/**
 * Gets the diff of staged changes for a given repository.
 * Prefers using `repo.diff(true)` but falls back to `repo.exec('diff', ['--staged'])` if available.
 * @param repo The Git repository object from the API.
 * @returns The diff string, or undefined if an error occurs or no diff is found.
 */
export async function getStagedChangesDiff(repo: Repository): Promise<string | undefined> {
    try {
        console.log("Attempting to get staged diff using repo.diff(true)...");
        const diffOutput = await repo.diff(true); // true for staged changes
        console.log(`repo.diff(true) successful. Diff length: ${diffOutput?.length ?? 'undefined'}`);
        return diffOutput;
    } catch (error: any) {
        console.warn("Error getting staged diff via repo.diff(true):", error.message);
         // Fallback attempt using exec
         if (repo.exec) {
             try {
                 console.log("repo.diff(true) failed, trying repo.exec('diff', ['--staged'])...");
                 // Ensure correct working directory if needed, though usually runs in repo root
                 const result = await repo.exec('diff', ['--staged']);
                 if (result.exitCode === 0) {
                     console.log(`repo.exec('diff', ['--staged']) successful. Diff length: ${result.stdout.length}`);
                     return result.stdout;
                 } else {
                     console.error(`Git exec diff --staged failed with exit code ${result.exitCode}: ${result.stderr}`);
                     vscode.window.showErrorMessage(`Failed to get staged diff via git command: ${result.stderr || 'Unknown Git error'}`);
                     return undefined;
                 }
             } catch (execError: any) {
                 console.error("Error getting staged diff via repo.exec:", execError);
                 vscode.window.showErrorMessage(`Failed to execute git diff command: ${execError.message || 'Unknown execution error'}`);
                 return undefined;
             }
         } else {
            // No fallback possible
            console.error("repo.diff(true) failed and repo.exec is not available.");
            vscode.window.showErrorMessage(`Failed to get staged diff. Method repo.diff failed and repo.exec is unavailable: ${error.message || 'Unknown error'}`);
            return undefined;
         }
    }
}

/**
 * Updates the commit message input box in the Source Control view for the given repository.
 * @param repo The Git repository object from the API.
 * @param message The commit message string to set.
 */
export function updateCommitInputBox(repo: Repository, message: string): void {
    // Replace the entire content for simplicity. Could prepend/append if needed.
    repo.inputBox.value = message;
    console.log("Updated SCM commit input box.");
    // Optionally focus the SCM view after setting the message
    // vscode.commands.executeCommand('workbench.view.scm');
}
