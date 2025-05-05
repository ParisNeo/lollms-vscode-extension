// src/config.ts
import * as vscode from 'vscode';
import * as path from 'path'; // Import path if needed for normalization later

const CONFIG_SECTION = 'lollms';
const APPROX_CHARS_PER_TOKEN = 4;

function getConfig<T>(key: string, defaultValue: T): T {
    // Ensure we are reading from the correct configuration section
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const value = config.get<T>(key);

    // Check if the value retrieved is undefined or null, if so, return default.
    // Handle cases where the setting might exist but be explicitly null.
    if (value === undefined || value === null) {
        // console.log(`Config key '${key}' not found or null, using default: ${defaultValue}`);
        return defaultValue;
    }
    // console.log(`Config key '${key}' found, value: ${value}`);
    return value;
}


// --- Existing Functions ---

export function getServerUrl(): string | undefined {
    let url = getConfig<string | undefined>('serverUrl', "http://localhost:9601")?.trim();
    if (url && url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    return url ? url : undefined;
}

export function getApiKey(): string | undefined {
    const key = getConfig<string | undefined>('apiKey', "")?.trim();
    return key ? key : undefined;
}

export function getOverrideBindingInstance(): string | undefined {
    const name = getConfig<string | undefined>('overrideBindingInstance', "")?.trim();
    return name ? name : undefined;
}

export function getOverrideModelName(): string | undefined {
    const name = getConfig<string | undefined>('overrideModelName', "")?.trim();
    return name ? name : undefined;
}

export function getCodeGenPromptPrefix(): string {
    return getConfig<string>('codeGenPromptPrefix', 'Implement the following functionality described in the comment/docstring:\n\n');
}

export function getCodeGenPromptSuffix(): string {
    return getConfig<string>('codeGenPromptSuffix', '\n\n```python\n');
}

export function getContextPromptPrefix(): string {
    // Use the updated default from package.json
    return getConfig<string>('contextPromptPrefix', "Based on the provided file context and the user's request/conversation history, respond appropriately. CONTEXT:\n");
}

export function getContextPromptSuffix(): string {
     // Use the updated default from package.json
    return getConfig<string>('contextPromptSuffix', "\nEND CONTEXT.\n\nCONVERSATION HISTORY (if any):\n");
}

export function getCommitMsgPromptPrefix(): string {
    return getConfig<string>('commitMsgPromptPrefix', "Generate a concise Git commit message in the conventional commit format (e.g., feat: ...) that summarizes the following staged changes:\n\n```diff\n");
}

export function getCommitMsgPromptSuffix(): string {
    return getConfig<string>('commitMsgPromptSuffix', "\n```\n\nCommit Message:");
}

export function getDefaultModelParameters(): Record<string, any> {
     // Use the updated default from package.json
     return getConfig<Record<string, any>>('defaultModelParameters', { temperature: 0.3, max_tokens: 4096 });
}

export function getContextCharWarningThreshold(): number {
    return getConfig<number>('contextCharWarningThreshold', 100000);
}

export function shouldIncludeFilePathsInContext(): boolean {
    return getConfig<boolean>('includeFilePathsInContext', true);
}

export function getSvgAssetPromptPrefix(): string {
    return getConfig<string>('svgAssetPromptPrefix', 'Generate SVG code based on the following description. Only output the raw SVG code within ```svg ... ``` tags:\n\nDescription: ');
}

export function getSvgAssetPromptSuffix(): string {
    return getConfig<string>('svgAssetPromptSuffix', '\n\nSVG Code:\n');
}

export function getContextIgnorePatterns(): string[] {
    // Use the updated default from package.json
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

// --- **NEW** Function ---
/**
 * Gets the configured relative path for saving chat discussions.
 * Returns a default value if not set. Normalizes the path slightly.
 * @returns The relative path string (e.g., '.lollms/chats').
 */
export function getChatSaveFolder(): string {
    let folderPath = getConfig<string>('chatSaveFolder', '.lollms/chats').trim(); // Get value or default
    // Basic normalization: remove leading/trailing slashes for consistency
    folderPath = folderPath.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');
    // Ensure it's not empty, fallback to default if user entered only slashes
    return folderPath || '.lollms/chats';
}


// --- Update/Validation Functions ---

export async function updateGlobalSettings(settingsToUpdate: { [key: string]: any }): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const promises: Thenable<void>[] = [];
    console.log("Updating LOLLMS global settings:", settingsToUpdate);

    for (const key in settingsToUpdate) {
        if (Object.prototype.hasOwnProperty.call(settingsToUpdate, key)) {
            const value = settingsToUpdate[key];
            console.debug(`Updating '${CONFIG_SECTION}.${key}' to:`, value);
            promises.push(config.update(key, value, vscode.ConfigurationTarget.Global));
        }
    }

    try {
        await Promise.all(promises);
        console.log("LOLLMS global settings updated successfully.");
    } catch (error: any) {
        console.error("Error updating LOLLMS global settings:", error);
        vscode.window.showErrorMessage(`Failed to update LOLLMS settings: ${error.message || error}`);
        throw error;
    }
}


export function isConfigValid(): boolean {
    const url = getServerUrl();
    // Add other essential checks if needed in the future
    return !!url;
}

export function showConfigurationError(): void {
    const url = getServerUrl();
    let message = 'LOLLMS Copilot configuration is incomplete:';
    if (!url) message += '\n- `lollms.serverUrl` is missing.';
    // Add checks for other critical missing settings if applicable

     vscode.window.showErrorMessage(message, { modal: true }, 'Open Settings').then(selection => {
        if (selection === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'lollms.serverUrl');
        }
     });
}

export { APPROX_CHARS_PER_TOKEN };