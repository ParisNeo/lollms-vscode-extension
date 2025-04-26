import * as vscode from 'vscode';

// Interfaces for Git API (copied from previous example)
interface GitExtension {
    getAPI(version: number): Promise<API>;
}
interface API {
    repositories: Repository[];
    getRepositories(): Promise<Repository[]>;
}
interface Repository {
    inputBox: { value: string };
    state: { indexChanges: Change[] };
    diff(cached?: boolean): Promise<string>;
    exec?(command: string, args?: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}
interface Change {
    uri: vscode.Uri;
}


export async function getGitAPI(): Promise<API | undefined> {
    try {
        const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
        if (!extension) {
            vscode.window.showErrorMessage('Git extension is not available. Please install or enable it.');
            return undefined;
        }
        if (!extension.isActive) {
            console.log("Activating Git extension...");
            await extension.activate();
            console.log("Git extension activated.");
        }
        return await extension.exports.getAPI(1);
    } catch (error) {
        console.error("Error getting Git API:", error);
        vscode.window.showErrorMessage('Failed to get Git API. See console for details.');
        return undefined;
    }
}

export async function getStagedChangesDiff(repo: Repository): Promise<string | undefined> {
    try {
        const diffOutput = await repo.diff(true); // true for staged changes
        return diffOutput;
    } catch (error: any) {
        console.error("Error getting staged diff via repo.diff:", error);
         // Fallback attempt using exec
         if (repo.exec) {
             try {
                 console.log("repo.diff(true) failed, trying repo.exec('diff', ['--staged'])...");
                 const result = await repo.exec('diff', ['--staged']);
                 if (result.exitCode === 0) {
                     return result.stdout;
                 } else {
                     vscode.window.showErrorMessage(`Failed to get staged diff via exec: ${result.stderr || 'Unknown error'}`);
                     return undefined;
                 }
             } catch (execError: any) {
                 console.error("Error getting staged diff via repo.exec:", execError);
                 vscode.window.showErrorMessage(`Failed to get staged diff: ${execError.message || 'Unknown error'}`);
                 return undefined;
             }
         } else {
            vscode.window.showErrorMessage(`Failed to get staged diff and repo.exec not available: ${error.message || 'Unknown error'}`);
            return undefined;
         }
    }
}

export function updateCommitInputBox(repo: Repository, message: string): void {
    // Prepend if there's existing content? Overwrite for simplicity now.
    repo.inputBox.value = message;
    // Optionally focus the SCM view:
    // vscode.commands.executeCommand('workbench.view.scm');
}