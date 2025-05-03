// src/config.ts
import * as vscode from 'vscode';

// This constant MUST match the prefix used for configuration properties in package.json
const CONFIG_SECTION = 'lollms';
export const APPROX_CHARS_PER_TOKEN = 4;
/**
 * Generic helper function to retrieve a configuration value from VS Code settings.
 * It accesses the configuration section defined by CONFIG_SECTION.
 *
 * @param key The specific configuration key (e.g., 'serverUrl', 'apiKey').
 * @param defaultValue The value to return if the setting is not found or undefined.
 * @returns The retrieved configuration value or the provided default value.
 */
function getConfig<T>(key: string, defaultValue: T): T {
    // Use the '??' nullish coalescing operator to provide the default
    // only if the retrieved value is null or undefined.
    return vscode.workspace.getConfiguration(CONFIG_SECTION).get<T>(key) ?? defaultValue;
}

/**
 * Gets the configured LOLLMS Server base URL from settings.
 * Trims whitespace and removes trailing slashes. Returns undefined if empty.
 * @returns The server URL string, or undefined if not set or empty.
 */
export function getServerUrl(): string | undefined {
    // Default value from package.json is "http://localhost:9601"
    let url = getConfig<string | undefined>('serverUrl', "http://localhost:9601")?.trim();
    if (url && url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    return url ? url : undefined; // Return undefined if empty string after trim
}

/**
 * Gets the configured LOLLMS API Key from settings.
 * Trims whitespace and returns undefined if empty.
 * @returns The API Key string, or undefined if not set or empty.
 */
export function getApiKey(): string | undefined {
    // Default value from package.json is ""
    const key = getConfig<string | undefined>('apiKey', "")?.trim();
    return key ? key : undefined; // Return undefined if empty string after trim
}

/**
 * Gets the configured default binding instance name from settings.
 * This is used for context size checks via the get_model_info endpoint.
 * Trims whitespace and returns undefined if empty.
 * @returns The binding instance name string, or undefined if not set or empty.
 */
export function getDefaultBindingInstance(): string | undefined {
    // Default value from package.json is ""
    const name = getConfig<string | undefined>('defaultBindingInstance', "")?.trim();
    return name ? name : undefined;
}


/**
 * Gets the configured prompt prefix for code generation from comments/docstrings.
 * @returns The prompt prefix string.
 */
export function getCodeGenPromptPrefix(): string {
    // Default value from package.json
    return getConfig<string>('codeGenPromptPrefix', 'Implement the following functionality described in the comment/docstring:\n\n');
}

/**
 * Gets the configured prompt suffix for code generation from comments/docstrings.
 * Often used to hint the desired output language block.
 * @returns The prompt suffix string.
 */
export function getCodeGenPromptSuffix(): string {
     // Default value from package.json
    return getConfig<string>('codeGenPromptSuffix', '\n\n```python\n');
}

/**
 * Gets the configured prompt prefix used before context file content.
 * @returns The prompt prefix string.
 */
export function getContextPromptPrefix(): string {
    // Default value from package.json
    return getConfig<string>('contextPromptPrefix', "Based on the provided file context and the user's request, generate or modify the code as described.\n\n--- CONTEXT FILES ---\n");
}

/**
 * Gets the configured prompt suffix used after context file content but before the user's request.
 * @returns The prompt suffix string.
 */
export function getContextPromptSuffix(): string {
    // Default value from package.json
    return getConfig<string>('contextPromptSuffix', "\n--- END CONTEXT FILES ---\n\nUser Request:\n");
}

/**
 * Gets the configured prompt prefix for commit message generation.
 * @returns The prompt prefix string.
 */
export function getCommitMsgPromptPrefix(): string {
    // Default value from package.json
    return getConfig<string>('commitMsgPromptPrefix', "Generate a concise Git commit message in the conventional commit format (e.g., feat: ...) that summarizes the following staged changes:\n\n```diff\n");
}

/**
 * Gets the configured prompt suffix for commit message generation.
 * @returns The prompt suffix string.
 */
export function getCommitMsgPromptSuffix(): string {
    // Default value from package.json
    return getConfig<string>('commitMsgPromptSuffix', "\n```\n\nCommit Message:");
}

/**
 * Gets the configured default model parameters for LOLLMS API generate calls.
 * @returns An object containing the default parameters (e.g., temperature, max_tokens).
 */
export function getDefaultModelParameters(): Record<string, any> {
     // Default value from package.json (ensure this object structure is valid JSON)
     // Increased default max_tokens based on server docs examples
     return getConfig<Record<string, any>>('defaultModelParameters', { temperature: 0.3, max_tokens: 2048 });
}

/**
 * Gets the configured character count threshold for warning about large context sizes.
 * Renamed from Token to Char for clarity.
 * @returns The character count threshold number.
 */
export function getContextCharWarningThreshold(): number {
    // Default value from package.json
    return getConfig<number>('contextCharWarningThreshold', 100000);
}

/**
 * Gets whether to include relative file paths as headers in the context prompt.
 * @returns True if file paths should be included, false otherwise.
 */
export function shouldIncludeFilePathsInContext(): boolean {
    // Default value from package.json
    return getConfig<boolean>('includeFilePathsInContext', true);
}

/**
 * Gets the configured glob patterns for ignoring files when adding all project files to context.
 * @returns An array of glob pattern strings.
 */
export function getContextIgnorePatterns(): string[] {
    // Default value from package.json (ensure this array is valid)
    return getConfig<string[]>('contextIgnorePatterns', [
        "**/node_modules/**", "**/.git/**", "**/.vscode/**", "**/.svn/**", "**/.hg/**",
        "**/CVS/**", "**/.DS_Store/**", "**/Thumbs.db/**", "**/*.lock", "**/*.log",
        "**/*.exe", "**/*.dll", "**/*.so", "**/*.dylib", "**/*.obj", "**/*.o", "**/*.a",
        "**/*.lib", "**/*.pyc", "**/*.pyo", "**/*.class", "**/*.jar", "**/*.bin",
        "**/*.pdf", "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.gif", "**/*.bmp", "**/*.tiff", "**/*.webp",
        "**/*.mp3", "**/*.wav", "**/*.ogg", "**/*.mp4", "**/*.avi", "**/*.mov", "**/*.wmv",
        "**/dist/**", "**/build/**", "**/out/**", "**/*.zip", "**/*.tar.gz", "**/*.rar"
    ]);
}

/**
 * Checks if the essential configuration required for the extension to function (server URL and default binding) is validly set.
 * @returns True if the server URL and default binding instance are configured, false otherwise.
 */
export function isConfigValid(): boolean {
    const url = getServerUrl();
    const binding = getDefaultBindingInstance();
    // Both server URL and default binding are needed for core functionality (especially context size checks)
    return !!url && !!binding;
}

/**
 * Shows a standardized error message to the user via VS Code notification,
 * indicating that essential configuration is missing or invalid.
 */
export function showConfigurationError(): void {
    const url = getServerUrl();
    const binding = getDefaultBindingInstance();
    let message = 'LOLLMS Copilot configuration is incomplete. Please check settings:';
    if (!url) message += '\n- `lollms.serverUrl` is missing.';
    if (!binding) message += '\n- `lollms.defaultBindingInstance` is missing (required for context features).';

     vscode.window.showErrorMessage(message, { modal: true }, 'Open Settings').then(selection => {
        if (selection === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'lollms.');
        }
     });
}