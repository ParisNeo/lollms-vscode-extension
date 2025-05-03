import * as vscode from 'vscode';
import * as fs from 'fs/promises'; // Use promises version of fs

const MAX_COMMENT_SCAN_LINES = 50; // Limit how far back we look for comments

/**
 * Finds the nearest preceding comment or docstring block before the given position.
 * Handles common single-line (#, //) and multi-line (/* *, """ """) comments.
 */
export function findPrecedingCommentBlock(document: vscode.TextDocument, position: vscode.Position): string | null {
    let currentLine = position.line;
    let linesScanned = 0;
    let commentLines: string[] = [];
    let inBlockComment = false;
    let blockCommentType: '/*' | '"""' | "'''" | null = null;

    // Adjust starting line if cursor is not at the beginning of the line
    // If the cursor is within a line, start scan from the line above it.
    // If the cursor is at the very start of a line (char 0), consider that line itself.
    const startingLine = position.character > 0 ? position.line - 1 : position.line -1; // Always start scan from line above cursor pos for simplicity now

    currentLine = startingLine;

    while (currentLine >= 0 && linesScanned < MAX_COMMENT_SCAN_LINES) {
        const line = document.lineAt(currentLine);
        const lineText = line.text.trim();

        if (inBlockComment) {
            commentLines.unshift(line.text); // Add full line including indentation
            if (blockCommentType === '/*' && lineText.includes('/*')) {
                // Found start of /* block
                const blockStartIndex = line.text.indexOf('/*');
                commentLines[0] = line.text.substring(blockStartIndex);
                break; // Block found
            } else if ((blockCommentType === '"""' && lineText.startsWith('"""')) || (blockCommentType === "'''" && lineText.startsWith("'''"))) {
                 break; // Block found
            }
        } else {
            // Not currently in a block comment, check for start of comments
            if (lineText.endsWith('*/')) {
                inBlockComment = true;
                blockCommentType = '/*';
                commentLines.unshift(line.text);
                if (lineText.includes('/*') && lineText.indexOf('/*') < lineText.indexOf('*/')) {
                    const blockStartIndex = line.text.indexOf('/*');
                    commentLines[0] = line.text.substring(blockStartIndex);
                    break;
                }
            } else if (lineText.endsWith('"""') && lineText.length > 3 && !lineText.startsWith('"""')) {
                inBlockComment = true;
                blockCommentType = '"""';
                commentLines.unshift(line.text);
            } else if (lineText.endsWith("'''") && lineText.length > 3 && !lineText.startsWith("'''")) {
                inBlockComment = true;
                blockCommentType = "'''";
                commentLines.unshift(line.text);
            } else if (lineText.startsWith('#')) {
                commentLines.unshift(line.text);
                if (currentLine > 0) {
                    const prevLineText = document.lineAt(currentLine - 1).text.trim();
                    if (!prevLineText.startsWith('#') && prevLineText !== "") { // Stop if previous line is not '#' or empty
                        break;
                    }
                } else {
                     break;
                }
            } else if (lineText.startsWith('//')) {
                 commentLines.unshift(line.text);
                 if (currentLine > 0) {
                     const prevLineText = document.lineAt(currentLine - 1).text.trim();
                     if (!prevLineText.startsWith('//') && prevLineText !== "") { // Stop if previous line is not '//' or empty
                         break;
                     }
                 } else {
                      break;
                 }
            } else if (lineText.startsWith('"""') && lineText.endsWith('"""') && lineText.length >= 6) {
                 commentLines.unshift(line.text);
                 break;
            } else if (lineText.startsWith("'''") && lineText.endsWith("'''") && lineText.length >= 6) {
                 commentLines.unshift(line.text);
                 break;
            } else if (lineText) { // Found a non-empty, non-comment line
                 break;
            } else {
                // Empty line encountered - potentially break comment block
                 if (commentLines.length > 0 && !inBlockComment) {
                     break; // If we already found single-line comments, an empty line breaks the block
                 }
            }
        }

        currentLine--;
        linesScanned++;
    }

    if (commentLines.length > 0) {
        let fullComment = commentLines.join('\n');
        // Basic cleaning of comment markers for the LLM
        if (blockCommentType === '/*') {
            fullComment = fullComment.replace(/^\s*\/\*+?/, '').replace(/\*+?\/\s*$/, '');
             // Also remove leading * on intermediate lines
            fullComment = fullComment.split('\n').map(l => l.replace(/^\s*\*\s?/, '')).join('\n');
        } else if (blockCommentType === '"""') {
            fullComment = fullComment.replace(/^\s*"""/, '').replace(/"""\s*$/, '');
        } else if (blockCommentType === "'''") {
            fullComment = fullComment.replace(/^\s*'''/, '').replace(/'''\s*$/, '');
        } else { // Handle single line comments (#, //)
             fullComment = commentLines.map(line => line.replace(/^\s*(#|\/\/)\s?/, '')).join('\n');
        }
        return fullComment.trim();
    }

    console.log(`No preceding comment found within ${MAX_COMMENT_SCAN_LINES} lines of line ${position.line + 1}.`);
    return null; // No preceding comment found within scan limit
}


/**
 * Inserts the generated code at the position immediately following the comment block.
 * Tries to maintain indentation based on the line where the comment block started.
 * @param editor The active TextEditor.
 * @param commentStartPosition The starting position of the found comment block (used for indentation).
 * @param insertLineNum The line number where insertion should begin (usually line after comment end).
 * @param generatedCode The code string to insert.
 */
export async function insertGeneratedCode(
    editor: vscode.TextEditor,
    commentStartPositionLine: number, // Line where the comment block started
    insertLineNum: number, // Line number *after* the comment block where insertion should happen
    generatedCode: string
): Promise<void> {
    const document = editor.document;
    let leadingWhitespace = "";

    // Get indentation from the first line of the comment block
    if (commentStartPositionLine >= 0 && commentStartPositionLine < document.lineCount) {
        const commentFirstLineText = document.lineAt(commentStartPositionLine).text;
        const match = commentFirstLineText.match(/^(\s*)/);
        if (match) {
            leadingWhitespace = match[1];
        }
    } else {
        // Fallback: if comment start is unknown or invalid, use indentation of insertion line
        if (insertLineNum >= 0 && insertLineNum < document.lineCount) {
            const insertLineText = document.lineAt(insertLineNum).text;
            const match = insertLineText.match(/^(\s*)/);
            if (match) {
                leadingWhitespace = match[1];
            }
        }
    }

    let insertPosition = new vscode.Position(insertLineNum, 0); // Start insertion at beginning of the line

    // Indent the generated code block, applying the determined whitespace to each line
    const indentedCode = generatedCode
        .split('\n')
        .map(line => leadingWhitespace + line) // Add indent to *every* line
        .join('\n');

    // Perform the edit
    await editor.edit(editBuilder => {
        // Add a newline *before* the indented code block to ensure separation
        editBuilder.insert(insertPosition, '\n' + indentedCode);
    });

     // Optional: Format the selection or document
     // Consider formatting just the inserted range if possible for performance
     // await vscode.commands.executeCommand('editor.action.formatSelection');
     // or
     // await vscode.commands.executeCommand('editor.action.formatDocument');
}

/**
 * Reads the content of a file specified by URI.
 */
export async function readFileContent(uri: vscode.Uri): Promise<string | null> {
    try {
        // Use vscode's workspace filesystem API - more robust in virtual workspaces etc.
        const contentBytes = await vscode.workspace.fs.readFile(uri);
        const content = Buffer.from(contentBytes).toString('utf-8');
        return content;
    } catch (error: any) {
        console.error(`Error reading file ${uri.fsPath}:`, error);
        vscode.window.showErrorMessage(`Failed to read file: ${uri.fsPath}. ${error.message}`);
        return null;
    }
}

/**
 * Extracts the content of the first code block potentially matching a language tag.
 * Handles ```lang ... ``` and ``` ... ``` fences. Removes the fences and language tag.
 * @param text The text potentially containing code blocks.
 * @returns The content of the first found code block, or the original text if no block detected.
 */
export function extractFirstCodeBlock(text: string): string {
    // Regex to find the first block, capturing the language tag (optional) and content
    // Handles optional whitespace after ```lang\n
    // [\s\S]*? makes it non-greedy
    // Accounts for potentially missing newline after opening fence
    const regex = /^```(?:[\w-]+)?\s*?\n([\s\S]*?)\n?```$/m;

    const match = text.match(regex);

    if (match && match[1]) {
        // Return the captured group (the content), trimming whitespace
        console.log("Found and extracted code block content.");
        return match[1].trim();
    }

    // Fallback: If no fenced block is found, assume the whole response might be code,
    // but trim it to remove potential leading/trailing explanations.
    console.warn("No fenced code block found in response. Returning trimmed text.");
    return text.trim();
}
