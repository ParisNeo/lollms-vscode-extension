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

    while (currentLine >= 0 && linesScanned < MAX_COMMENT_SCAN_LINES) {
        const line = document.lineAt(currentLine);
        const lineText = line.text.trim();

        if (inBlockComment) {
            commentLines.unshift(line.text); // Add full line including indentation
            if (blockCommentType === '/*' && lineText.includes('/*')) {
                // Found start of /* block
                // Extract relevant part if start is not at beginning of line
                const blockStartIndex = line.text.indexOf('/*');
                commentLines[0] = line.text.substring(blockStartIndex);
                break; // Block found
            } else if ((blockCommentType === '"""' && lineText.startsWith('"""')) || (blockCommentType === "'''" && lineText.startsWith("'''"))) {
                 // Found start of """/''' block
                 break; // Block found
            }
        } else {
            // Not currently in a block comment, check for start of comments
            if (lineText.endsWith('*/')) {
                inBlockComment = true;
                blockCommentType = '/*';
                commentLines.unshift(line.text); // Add this line
                // If the start is also on this line
                if (lineText.includes('/*') && lineText.indexOf('/*') < lineText.indexOf('*/')) {
                    const blockStartIndex = line.text.indexOf('/*');
                    commentLines[0] = line.text.substring(blockStartIndex); // Adjust first line
                    break;
                }
            } else if (lineText.endsWith('"""') && lineText.length > 3 && !lineText.startsWith('"""')) { // Avoid single-line docstring as block end
                inBlockComment = true;
                blockCommentType = '"""';
                commentLines.unshift(line.text);
            } else if (lineText.endsWith("'''") && lineText.length > 3 && !lineText.startsWith("'''")) {
                inBlockComment = true;
                blockCommentType = "'''";
                commentLines.unshift(line.text);
            } else if (lineText.startsWith('#')) {
                commentLines.unshift(line.text);
                // Check if the previous line was also a comment
                if (currentLine > 0) {
                    const prevLineText = document.lineAt(currentLine - 1).text.trim();
                    if (!prevLineText.startsWith('#')) {
                        break; // End of contiguous # comment block
                    }
                } else {
                     break; // Reached top of file
                }
            } else if (lineText.startsWith('//')) {
                 commentLines.unshift(line.text);
                 // Check if the previous line was also a comment
                 if (currentLine > 0) {
                     const prevLineText = document.lineAt(currentLine - 1).text.trim();
                     if (!prevLineText.startsWith('//')) {
                         break; // End of contiguous // comment block
                     }
                 } else {
                      break; // Reached top of file
                 }
            } else if (lineText.startsWith('"""') && lineText.endsWith('"""') && lineText.length >= 6) {
                 // Single-line docstring """..."""
                 commentLines.unshift(line.text);
                 break;
            } else if (lineText.startsWith("'''") && lineText.endsWith("'''") && lineText.length >= 6) {
                 // Single-line docstring '''...'''
                 commentLines.unshift(line.text);
                 break;
            } else if (lineText) {
                 // Found a non-empty, non-comment line before finding a comment start
                 break;
            }
        }

        currentLine--;
        linesScanned++;
    }

    if (commentLines.length > 0) {
        let fullComment = commentLines.join('\n');
        // Basic cleaning of comment markers for the LLM
        if (blockCommentType === '/*') {
            fullComment = fullComment.replace(/^\s*\/\*+/, '').replace(/\*+\/\s*$/, '');
        } else if (blockCommentType === '"""') {
            fullComment = fullComment.replace(/^\s*"""/, '').replace(/"""\s*$/, '');
        } else if (blockCommentType === "'''") {
            fullComment = fullComment.replace(/^\s*'''/, '').replace(/'''\s*$/, '');
        } else { // Handle single line comments (#, //)
             fullComment = commentLines.map(line => line.replace(/^\s*(#|\/\/)\s?/, '')).join('\n');
        }
        return fullComment.trim();
    }

    return null; // No preceding comment found within scan limit
}


/**
 * Inserts the generated code at the position immediately following the comment block.
 * Tries to maintain indentation.
 */
export async function insertGeneratedCode(editor: vscode.TextEditor, commentEndPosition: vscode.Position, generatedCode: string): Promise<void> {
    const document = editor.document;
    // Position to insert: line after the comment block, maintaining indentation
    const insertLine = commentEndPosition.line + 1;
    let insertPosition: vscode.Position;
    let leadingWhitespace = "";

    // Try to get indentation from the comment's first line or the line after
     if (commentEndPosition.line >= 0) {
        const commentFirstLine = document.lineAt(commentEndPosition.line - (commentEndPosition.character === 0 ? 1 : 0)); // Get line where comment might start
        const match = commentFirstLine.text.match(/^(\s*)/);
        if (match) {
            leadingWhitespace = match[1];
        }
    }

    insertPosition = new vscode.Position(insertLine, leadingWhitespace.length);

    // Ensure the insert line exists, otherwise insert at the end
    if (insertLine >= document.lineCount) {
        // Need to add a newline first if inserting at the very end
        await editor.edit(editBuilder => {
            editBuilder.insert(new vscode.Position(document.lineCount, 0), '\n');
        });
        insertPosition = new vscode.Position(document.lineCount, 0); // Insert at start of new line
        leadingWhitespace = ""; // No indentation needed at EOF
    }


    // Indent the generated code
    const indentedCode = generatedCode
        .split('\n')
        .map((line, index) => (index === 0 ? '' : leadingWhitespace) + line) // Indent lines after the first
        .join('\n');

    // Perform the edit
    await editor.edit(editBuilder => {
        // Add a newline before the code if the target line isn't empty
        let prefix = "\n";
         if (insertLine < document.lineCount && !document.lineAt(insertLine).isEmptyOrWhitespace) {
             prefix = "\n"; // Add newline if inserting into existing content
         } else if (insertLine >= document.lineCount) {
              prefix = ""; // No extra newline needed if inserting at end
         } else {
              prefix = ""; // Inserting on an empty line, no prefix needed
         }

        editBuilder.insert(insertPosition, prefix + indentedCode);
    });

    // Optional: Format the inserted code
    // await vscode.commands.executeCommand('editor.action.formatDocument');
}

/**
 * Reads the content of a file specified by URI.
 */
export async function readFileContent(uri: vscode.Uri): Promise<string | null> {
    try {
        // Use fs module provided by Node.js environment in VS Code extensions
        const content = await fs.readFile(uri.fsPath, 'utf-8');
        return content;
    } catch (error: any) {
        console.error(`Error reading file ${uri.fsPath}:`, error);
        vscode.window.showErrorMessage(`Failed to read file: ${uri.fsPath}. ${error.message}`);
        return null;
    }
}

/**
 * Extracts the content of the first code block matching a specific language tag (e.g., 'python').
 * Handles optional language tags and basic markdown fences.
 * @param text The text potentially containing code blocks.
 * @param language The language identifier to look for (e.g., 'python'). Case-insensitive.
 * @returns The content of the first matching code block, or null if not found.
 */
export function extractFirstCodeBlock(text: string, language: string): string | null {
    // Regex to find the first block with the specified language tag (case-insensitive)
    // It captures the content between the fences.
    // Handles optional whitespace after ```lang
    // [\s\S]*? makes it non-greedy to capture only the first block's content.
    const regex = new RegExp(
        "```" + language + "\\s*\\n?([\\s\\S]*?)\\s*```",
        "i" // Case-insensitive flag for the language tag
    );

    const match = text.match(regex);

    if (match && match[1]) {
        // Return the captured group (the content), trimming potential extra whitespace
        return match[1].trim();
    }

    // Fallback: If no language tag matched, try finding the *first* block regardless of tag,
    // but only if the language requested was generic like 'code' or if we assume python
    // For now, let's only match the explicitly tagged block for reliability.
    // If needed later, add fallback logic here:
    // const genericRegex = /```.*\n?([\s\S]*?)\s*```/;
    // const genericMatch = text.match(genericRegex);
    // if (genericMatch && genericMatch[1]) { return genericMatch[1].trim(); }

    console.warn(`No code block found with language tag '${language}' in text.`);
    return null;
}