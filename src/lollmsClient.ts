// src/lollmsClient.ts

import * as vscode from 'vscode';
import fetch, { Response } from 'node-fetch';
import * as editorUtils from './editorUtils';

// --- Interfaces ---

/**
 * Represents the expected response structure for model info from the server.
 * Based on the lollms-server documentation for `/api/v1/get_model_info/{binding_name}`.
 */
export interface LollmsModelInfo {
    binding_instance_name: string;
    model_name: string | null;
    context_size: number | null;
    max_output_tokens: number | null;
    supports_vision?: boolean;
    supports_audio?: boolean;
    details?: Record<string, any>;
}

/**
 * Interface for the response of /get_default_bindings
 */
export interface LollmsDefaultBindings {
    ttt?: string; // Default Text-to-Text binding instance name
    tti?: string; // Default Text-to-Image
    // Add other modalities if needed based on server response
}

// Interface for individual model details from list_available_models
export interface LollmsAvailableModel { // Export this new interface
    name: string; // The model name/identifier
    // Add other potentially useful fields from the server response if needed
    // e.g., size, description, parameters, family, context_length etc.
    [key: string]: any; // Allow other properties
}

/**
 * Interface for the response of /get_default_ttt_context_length
 */
export interface LollmsDefaultContextLength {
    context_length: number;
}

/**
 * Represents the structure for items in the `input_data` array for the /generate endpoint.
 */
export interface LollmsInputDataItem {
    type: 'text' | 'image' | 'audio' | 'video' | 'document';
    role: string; // e.g., 'user_prompt', 'system_prompt', 'context', 'input_image'
    data: string; // Text content, base64 string, or URL
    mime_type?: string | null; // Required for non-text types
    metadata?: Record<string, any> | null;
}

/**
 * Represents the expected payload for the /generate endpoint.
 */
export interface LollmsGeneratePayload {
    input_data: LollmsInputDataItem[];
    personality?: string | null;
    binding_name?: string | null; // Optional: Specific binding instance name
    model_name?: string | null;   // Optional: Specific model name for the chosen binding
    generation_type?: 'ttt' | 'tti' | 'tts' | 'stt' | 'ttv' | 'ttm' | 'i2i' | 'audio2audio';
    stream?: boolean;
    parameters?: Record<string, any>;
    functions?: string[] | null;
}

// --- LollmsClient Class ---

/**
 * Client for interacting with the LOLLMS Server API.
 */
export class LollmsClient {
    private readonly baseUrl: string;
    private readonly apiKey?: string;

    /**
     * Creates an instance of LollmsClient.
     * @param baseUrl The base URL of the LOLLMS server (e.g., http://localhost:9601).
     * @param apiKey Optional API key for authentication.
     */
    constructor(baseUrl: string, apiKey?: string) {
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        this.apiKey = apiKey;
        console.log(`LollmsClient initialized. Base URL: ${this.baseUrl}, API Key Set: ${!!this.apiKey}`);
    }

    /**
     * Constructs the headers for API requests, including the API key if provided.
     * @returns An object containing the necessary HTTP headers.
     */
    private getHeaders(): { [key: string]: string } {
        const headers: { [key: string]: string } = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        if (this.apiKey) {
            headers['X-API-Key'] = this.apiKey;
        }
        return headers;
    }

    /**
     * Handles API error responses by attempting to parse JSON details or using text fallback.
     * @param response The fetch Response object.
     * @returns A formatted error message string.
     */
    private async formatApiError(response: Response): Promise<string> {
        let errorBodyText = await response.text();
        let detail = errorBodyText;
        try {
            const jsonError = JSON.parse(errorBodyText);
            detail = jsonError.detail || JSON.stringify(jsonError);
        } catch (e) { /* Ignore parsing error, use the raw text */ }
        return `LOLLMS server error (${response.status}): ${detail}`;
    }

    /**
     * Fetches the list of *active* (configured and loaded) binding instance names from the server.
     * Uses the /api/v1/list_active_bindings endpoint.
     * @returns A promise resolving to an array of active binding names or null on failure.
     */
    async listActiveBindings(): Promise<string[] | null> {
        const apiUrl = `${this.baseUrl}/api/v1/list_active_bindings`;
        const headers = this.getHeaders();
        console.debug(`Requesting active bindings from: ${apiUrl}`);
        try {
            const response = await fetch(apiUrl, { method: 'GET', headers: headers, timeout: 8000 }); // Slightly longer timeout

            if (!response.ok) {
                const errorMsg = await this.formatApiError(response);
                console.error(`LOLLMS listActiveBindings Error: ${errorMsg}`);
                // Show error to user as this impacts config UI
                vscode.window.showErrorMessage(`Failed to fetch active bindings: ${errorMsg}`);
                return null;
            }
            const result = await response.json();
            console.debug("LOLLMS listActiveBindings Response:", result);

            // Expecting a simple list of strings based on typical API design
            if (Array.isArray(result) && result.every(item => typeof item === 'string')) {
                return result as string[];
            } else if (result && result.error) {
                console.error(`LOLLMS server returned error for list_active_bindings: ${result.error}`);
                vscode.window.showErrorMessage(`Server error fetching bindings: ${result.error}`);
                return null;
            }
            else {
                console.warn("Received invalid format for active bindings list:", result);
                vscode.window.showErrorMessage("Received unexpected data format for active bindings.");
                return null;
            }
        } catch (error: any) {
            console.error(`Error fetching LOLLMS active bindings from ${apiUrl}:`, error);
            vscode.window.showErrorMessage(`Network error fetching active bindings: ${error.message}`);
            return null;
        }
    }

    /**
     * Fetches the list of available models for a specific binding instance.
     * Uses the /api/v1/list_available_models/{binding_instance_name} endpoint.
     * @param bindingName The name of the binding instance.
     * @returns A promise resolving to an array of available model details or null on failure.
     */
    async listAvailableModels(bindingName: string): Promise<LollmsAvailableModel[] | null> {
        if (!bindingName) {
            console.error("LOLLMS listAvailableModels Error: bindingName parameter is required.");
            return null;
        }
        const safeBindingName = encodeURIComponent(bindingName);
        const apiUrl = `${this.baseUrl}/api/v1/list_available_models/${safeBindingName}`;
        const headers = this.getHeaders();
        console.debug(`Requesting available models for binding '${bindingName}' from: ${apiUrl}`);
        try {
            const response = await fetch(apiUrl, { method: 'GET', headers: headers, timeout: 15000 }); // Longer timeout possible

            if (!response.ok) {
                const errorMsg = await this.formatApiError(response);
                console.error(`LOLLMS listAvailableModels Error for '${bindingName}': ${errorMsg}`);
                vscode.window.showErrorMessage(`Failed to fetch models for '${bindingName}': ${errorMsg}`);
                return null;
            }
            const result = await response.json();
            console.debug(`LOLLMS listAvailableModels Response for '${bindingName}':`, result);

            // Expecting an array of objects, each having at least a 'name' property
            if (Array.isArray(result) && result.every(item => typeof item === 'object' && item !== null && 'name' in item)) {
                return result as LollmsAvailableModel[];
            } else if (result && result.error) {
                console.error(`LOLLMS server returned error for list_available_models on '${bindingName}': ${result.error}`);
                vscode.window.showErrorMessage(`Server error fetching models for '${bindingName}': ${result.error}`);
                return null;
            } else {
                console.warn(`Received invalid format for available models list for '${bindingName}':`, result);
                vscode.window.showErrorMessage(`Received unexpected data format for models of '${bindingName}'.`);
                return null;
            }
        } catch (error: any) {
            console.error(`Error fetching LOLLMS available models for '${bindingName}' from ${apiUrl}:`, error);
            vscode.window.showErrorMessage(`Network error fetching models for '${bindingName}': ${error.message}`);
            return null;
        }
    }
    

    /**
     * Fetches the context length of the default TTT binding from the server.
     * Uses the /api/v1/get_default_ttt_context_length endpoint.
     * @returns A promise resolving to the context length number or null on failure.
     */
    async getDefaultTttContextLength(): Promise<number | null> {
        const apiUrl = `${this.baseUrl}/api/v1/get_default_ttt_context_length`;
        const headers = this.getHeaders();

        console.debug(`Requesting default TTT context length from: ${apiUrl}`);
        try {
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: headers,
                timeout: 5000, // Short timeout for info endpoint
            });

            if (!response.ok) {
                const errorMsg = await this.formatApiError(response);
                console.error(`LOLLMS getDefaultTttContextLength Error: ${errorMsg}`);
                return null;
            }

            const result = await response.json() as LollmsDefaultContextLength | { error?: string };

            if ('context_length' in result && typeof result.context_length === 'number') {
                console.debug(`LOLLMS getDefaultTttContextLength Response: ${result.context_length}`);
                return result.context_length;
            } else if ('error' in result) {
                console.error(`LOLLMS server returned error for default context length: ${result.error}`);
                return null;
            } else {
                console.warn("Received invalid format for default context length:", result);
                return null;
            }

        } catch (error: any) {
            console.error(`Error fetching LOLLMS default context length from ${apiUrl}:`, error);
            return null;
        }
    }

    /**
     * Fetches model information (like context size) for a specific binding instance from the server.
     * Uses the /api/v1/get_model_info/{binding_name} endpoint.
     * @param bindingName The name of the binding instance (e.g., 'my_ollama_binding').
     * @returns A promise resolving to the model information object or null on failure.
     */
    async getModelInfo(bindingName: string): Promise<LollmsModelInfo | null> {
        if (!bindingName) {
            console.error("LOLLMS getModelInfo Error: bindingName parameter is required.");
            return null;
        }
        const safeBindingName = encodeURIComponent(bindingName);
        const apiUrl = `${this.baseUrl}/api/v1/get_model_info/${safeBindingName}`;
        const headers = this.getHeaders();
        headers['Accept'] = 'application/json';

        console.debug(`Requesting model info from: ${apiUrl}`);
        try {
            const response = await fetch(apiUrl, { method: 'GET', headers: headers, timeout: 10000 });

            if (!response.ok) {
                const errorMsg = await this.formatApiError(response);
                console.error(`LOLLMS getModelInfo Error for binding '${bindingName}': ${errorMsg}`);
                return null;
            }

            const result = await response.json();
            console.debug(`LOLLMS getModelInfo Response for '${bindingName}':`, result);

            // Perform type checking before asserting as LollmsModelInfo
            if (result && typeof result.context_size === 'number') {
                return {
                    binding_instance_name: result.binding_instance_name || bindingName,
                    model_name: result.model_name || null,
                    context_size: result.context_size,
                    max_output_tokens: typeof result.max_output_tokens === 'number' ? result.max_output_tokens : null,
                    supports_vision: typeof result.supports_vision === 'boolean' ? result.supports_vision : undefined,
                    supports_audio: typeof result.supports_audio === 'boolean' ? result.supports_audio : undefined,
                    details: typeof result.details === 'object' ? result.details : undefined,
                } as LollmsModelInfo;
            } else if (result && result.error) {
                console.error(`LOLLMS server returned error for getModelInfo on '${bindingName}': ${result.error}`);
                return null;
            } else {
                console.warn(`Received unexpected format for model info for binding '${bindingName}':`, result);
                return null;
            }
        } catch (error: any) {
            console.error(`Network or parsing error fetching LOLLMS model info for '${bindingName}' from ${apiUrl}:`, error);
            return null;
        }
    }

    /**
     * Sends a generation request to the LOLLMS server's /api/v1/generate endpoint.
     * Handles constructing the payload according to the multimodal API structure.
     * Allows optionally overriding the binding and model used.
     * @param payload The base LollmsGeneratePayload object containing input_data.
     * @param parameters Optional override parameters (merged with payload.parameters).
     * @param overrideBindingName Optional binding instance name to use instead of server default.
     * @param overrideModelName Optional model name to use instead of binding default.
     * @returns A promise resolving to the generated text content string (trimmed, fences removed)
     *          or the base64 image data (if image output found), or null on failure.
     */
    async generate(
        payload: LollmsGeneratePayload,
        parameters?: Record<string, any>,
        overrideBindingName?: string | null,
        overrideModelName?: string | null
    ): Promise<string | null> {
        const apiUrl = `${this.baseUrl}/api/v1/generate`;
        const headers = this.getHeaders();

        // Merge provided parameters with any existing in the payload
        const finalParameters = { ...(payload.parameters || {}), ...(parameters || {}) };

        // Construct the payload, including overrides only if they are provided
        const finalPayload: LollmsGeneratePayload = {
            ...payload, // Spread the base payload (includes input_data, generation_type etc.)
            parameters: finalParameters,
            stream: false // Force non-streaming for this simple generate method
        };

        // Add overrides if they have values
        if (overrideBindingName) {
            finalPayload.binding_name = overrideBindingName;
            console.debug(`Overriding binding instance: ${overrideBindingName}`);
        }
        if (overrideModelName) {
            finalPayload.model_name = overrideModelName;
            console.debug(`Overriding model name: ${overrideModelName}`);
        }

        console.debug("LOLLMS Generate Request Payload:", JSON.stringify(finalPayload, null, 2).substring(0, 1000) + "...");

        try {
            console.debug(`[Step 1] Sending fetch request to ${apiUrl}`);
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(finalPayload),
                // Note: Timeout is handled outside fetch for node-fetch v2
            });
            console.debug(`[Step 2] Received response status: ${response.status}`);

            if (!response.ok) {
                const errorMsg = await this.formatApiError(response);
                console.error("[Error Step 2a]", errorMsg);
                throw new Error(errorMsg);
            }

            let rawResponseText: string | null = null;
            try {
                console.debug("[Step 3] Reading response text...");
                rawResponseText = await response.text();
                console.debug("[Step 3a] Raw response text (first 500 chars):", rawResponseText?.substring(0, 500));
            } catch (textError: any) {
                console.error("[Error Step 3b] Failed to read response text:", textError);
                throw new Error(`Failed to read server response text: ${textError.message}`);
            }

            let result: any;
            try {
                console.debug("[Step 4] Parsing JSON from response text...");
                if (rawResponseText === null) throw new Error("Raw response text was null");
                result = JSON.parse(rawResponseText);
                console.debug("[Step 4a] Parsed JSON result:", result);
            } catch (parseError: any) {
                console.error("[Error Step 4b] Failed to parse JSON response:", parseError);
                console.error("--- Raw Response Text ---");
                console.error(rawResponseText);
                console.error("--- End Raw Response ---");
                throw new Error(`Failed to parse server response as JSON: ${parseError.message}`);
            }

            console.debug("[Step 5] Validating parsed response structure...");
            const isResultObject = typeof result === 'object' && result !== null;
            const hasOutputProperty = isResultObject && Object.prototype.hasOwnProperty.call(result, 'output');
            const isOutputArray = hasOutputProperty && Array.isArray(result.output);
            // Check for array-like behavior as a fallback
            const isOutputArrayLike = isOutputArray || (hasOutputProperty && typeof result.output?.length === 'number');
            console.debug(`Validation: isResultObject=${isResultObject}, hasOutputProperty=${hasOutputProperty}, isOutputArray=${isOutputArray}, isOutputArrayLike=${isOutputArrayLike}`);

            if (isResultObject && hasOutputProperty && isOutputArrayLike) {
                console.debug("[Step 5a] Validation passed: result.output exists and is array-like.");
                const outputArray: any[] = result.output; // Cast to any[] for find

                // Prioritize image output if present
                const imageOutput = outputArray.find(out => out?.type === 'image');
                if (imageOutput && typeof imageOutput.data === 'string') {
                    console.debug("[Step 6] Found image output.");
                    // Return the base64 data directly for images
                    return imageOutput.data;
                }

                // Fallback to text output if no image found
                const textOutput = outputArray.find(out => out?.type === 'text');
                if (textOutput) {
                    console.debug("[Step 6] Found textOutput object:", textOutput);
                    if (typeof textOutput.data === 'string') {
                        console.debug("[Step 6a] textOutput.data is a string.");
                        let extractedText: string | null = null; // Declare here
                        try {
                            console.debug("[Step 7] Extracting code block...");
                            extractedText = editorUtils.extractFirstCodeBlock(textOutput.data);
                            console.debug("[Step 7a] Extracted text:", extractedText);
                            return extractedText; // Return extracted text (can be empty string)
                        } catch (extractError: any) {
                            console.error("[Error Step 7b] Error during extractFirstCodeBlock:", extractError);
                            throw new Error(`Error processing extracted code: ${extractError.message}`);
                        }
                    } else {
                        console.warn("[Step 6b] textOutput found, but textOutput.data is not a string. Type:", typeof textOutput.data);
                        return ""; // Treat as success but no usable text
                    }
                } else {
                    console.warn("[Step 6c] No 'text' or 'image' output found in output array:", result.output);
                    return ""; // Treat as success but no usable output found
                }
            } else {
                // Determine the failure reason based on the checks above
                let reason = "Unknown reason";
                if (!isResultObject) reason = "result object is not a valid object";
                else if (!hasOutputProperty) reason = "result object does not have 'output' property";
                else if (!isOutputArrayLike) reason = `result.output is not array-like (type: ${typeof result.output})`;

                console.error(`[Error Step 5b] Unexpected LOLLMS response format. Reason: ${reason}.`);
                throw new Error(`Invalid response format from LOLLMS server (${reason}).`);
            }

        } catch (error: any) {
            console.error("[Final Catch Block] Error calling LOLLMS generate API or processing response:", error);
            vscode.window.showErrorMessage(`Failed to generate response from LOLLMS server: ${error.message}`);
            return null; // Return null when any error is caught
        }
    }
}