// src/config.ts
import * as vscode from 'vscode';

// This should match the prefix used in package.json configuration properties
const CONFIG_SECTION = 'lollms';

/**
 * Helper function to retrieve a configuration value with a default.
 * @param key The configuration key (e.g., 'serverUrl')
 * @param defaultValue The default value if the setting is not found.
 * @returns The configuration value or the default.
 */
function getConfig<T>(key: string, defaultValue: T): T {
    // The '??' operator provides the default value if get() returns undefined
    return vscode.workspace.getConfiguration(CONFIG_SECTION).get<T>(key) ?? defaultValue;
}

/**
 * Gets the configured LOLLMS Server base URL.
 * @returns The server URL string, or undefined if not set or empty.
 */
export function getServerUrl(): string | undefined {
    const url = getConfig<string | undefined>('serverUrl', undefined)?.trim();
    return url ? url : undefined; // Return undefined if empty string after trim
}

/**
 * Gets the configured LOLLMS API Key.
 * @returns The API Key string, or undefined if not set or empty.
 */
export function getApiKey(): string | undefined {
    const key = getConfig<string | undefined>('apiKey', undefined)?.trim();
    return key ? key : undefined; // Return undefined if empty string after trim
}

/**
 * Gets the configured prompt prefix for code generation from comments.
 * @returns The prompt prefix string.
 */
export function getCodeGenPromptPrefix(): string {
    // Provide the same default as in package.json
    return getConfig<string>('codeGenPromptPrefix', 'Implement the following functionality described in the comment/docstring:\n\n');
}

/**
 * Gets the configured prompt suffix for code generation from comments.
 * @returns The prompt suffix string.
 */
export function getCodeGenPromptSuffix(): string {
     // Provide the same default as in package.json
    return getConfig<string>('codeGenPromptSuffix', '\n\n```python\n');
}

/**
 * Gets the configured prompt prefix for context-aware generation.
 * @returns The prompt prefix string.
 */
export function getContextPromptPrefix(): string {
     // Provide the same default as in package.json
    return getConfig<string>('contextPromptPrefix', "Based on the provided file context and the user's request, generate or modify the code as described.\n\n--- CONTEXT FILES ---\n");
}

/**
 * Gets the configured prompt suffix for context-aware generation.
 * @returns The prompt suffix string.
 */
export function getContextPromptSuffix(): string {
    // Provide the same default as in package.json
    return getConfig<string>('contextPromptSuffix', "\n--- END CONTEXT FILES ---\n\nUser Request:\n");
}

/**
 * Gets the configured prompt prefix for commit message generation.
 * @returns The prompt prefix string.
 */
export function getCommitMsgPromptPrefix(): string {
    // Provide the same default as in package.json
    return getConfig<string>('commitMsgPromptPrefix', "Generate a concise Git commit message in the conventional commit format (e.g., feat: ...) that summarizes the following staged changes:\n\n```diff\n");
}

/**
 * Gets the configured prompt suffix for commit message generation.
 * @returns The prompt suffix string.
 */
export function getCommitMsgPromptSuffix(): string {
    // Provide the same default as in package.json
    return getConfig<string>('commitMsgPromptSuffix', "\n```\n\nCommit Message:");
}

/**
 * Gets the configured default model parameters for LOLLMS API calls.
 * @returns An object containing the default parameters.
 */
export function getDefaultModelParameters(): Record<string, any> {
     // Provide the same default object as in package.json
     return getConfig<Record<string, any>>('defaultModelParameters', { temperature: 0.3, max_tokens: 1024 });
}

/**
 * Gets the configured threshold for warning about large context sizes.
 * @returns The character count threshold number.
 */
export function getContextTokenWarningThreshold(): number {
    // Provide the same default as in package.json
    return getConfig<number>('contextTokenWarningThreshold', 100000);
}

/**
 * Gets whether to include file paths in the context prompt.
 * @returns True if file paths should be included, false otherwise.
 */
export function shouldIncludeFilePathsInContext(): boolean {
    // Provide the same default as in package.json
    return getConfig<boolean>('includeFilePathsInContext', true);
}


/**
 * Checks if the essential configuration (server URL) is validly set.
 * @returns True if the configuration is valid, false otherwise.
 */
export function isConfigValid(): boolean {
    const url = getServerUrl();
    // API key is optional, only URL is mandatory for the extension to attempt connection
    return !!url; // Returns true if url is a non-empty string
}

/**
 * Shows a standard error message to the user indicating configuration is needed.
 */
export function showConfigurationError(): void {
     // Use the specific setting name
     vscode.window.showErrorMessage('LOLLMS Server URL is not configured. Please set it in VS Code settings (lollms.serverUrl).');
}