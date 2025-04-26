import * as vscode from 'vscode';
import * as path from 'path';
import * as config from './config'; // Import config helper

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // Example: Limit individual files to 5MB
const MAX_TOTAL_CONTEXT_CHARS = 150000;    // Example: Limit total context characters (adjust!)

/**
 * Builds the context string from selected file URIs.
 * Reads file content, formats it, and handles limits.
 */
export async function buildContextStringFromFiles(files: vscode.Uri[]): Promise<{ context: string, fileCount: number, charCount: number, skippedFiles: string[] }> {
    let context = "";
    let charCount = 0;
    let fileCount = 0;
    const skippedFiles: string[] = [];
    const includeFilePaths = config.shouldIncludeFilePathsInContext();

    for (const uri of files) {
        const relativePath = vscode.workspace.asRelativePath(uri, false); // Get workspace relative path
        try {
            const stats = await vscode.workspace.fs.stat(uri);
            if (stats.size > MAX_FILE_SIZE_BYTES) {
                console.warn(`Skipping large file (${(stats.size / 1024 / 1024).toFixed(1)}MB): ${relativePath}`);
                skippedFiles.push(`${relativePath} (Too large)`);
                continue;
            }

            const fileContentBytes = await vscode.workspace.fs.readFile(uri);
            const fileContent = Buffer.from(fileContentBytes).toString('utf-8');

            const estimatedChars = (includeFilePaths ? relativePath.length + 20 : 0) + fileContent.length; // Rough estimate including header/footer

            if (charCount + estimatedChars > MAX_TOTAL_CONTEXT_CHARS) {
                 console.warn(`Context limit reached (${MAX_TOTAL_CONTEXT_CHARS} chars). Skipping remaining files starting with: ${relativePath}`);
                 skippedFiles.push(`${relativePath} (Context limit reached)`);
                 // Stop adding more files once limit is hit
                 break;
            }

            if (includeFilePaths) {
                 context += `--- FILE: ${relativePath} ---\n`;
            } else {
                 context += `--- FILE START ---\n`;
            }
            context += fileContent + "\n";
            context += `--- END FILE ---\n\n`;

            charCount += estimatedChars;
            fileCount++;

        } catch (error: any) {
            console.error(`Error reading file ${relativePath}:`, error);
            skippedFiles.push(`${relativePath} (Read error)`);
        }
    }

    return { context, fileCount, charCount, skippedFiles };
}

/**
 * Shows a warning if the estimated context size is large and asks for confirmation.
 */
export async function confirmLargeContext(charCount: number): Promise<boolean> {
    const threshold = config.getContextTokenWarningThreshold();
    if (charCount > threshold) {
        const userChoice = await vscode.window.showWarningMessage(
            `The selected context is large (~${Math.round(charCount / 3.5)} tokens / ${charCount} chars) and may consume many tokens or exceed model limits. Do you want to proceed?`,
            { modal: true }, // Make it blocking
            'Proceed', // Confirmation button
            'Cancel'   // Cancel button
        );
        return userChoice === 'Proceed';
    }
    return true; // Below threshold, proceed automatically
}