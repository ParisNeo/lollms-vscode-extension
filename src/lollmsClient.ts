// src/lollmsClient.ts
import * as vscode from 'vscode';
import fetch, { Response } from 'node-fetch'; // Import Response type

/**
 * Represents the expected response structure for model info from the server.
 * Based on the lollms-server documentation for `/api/v1/get_model_info/{binding_name}`.
 */
interface LollmsModelInfo {
    binding_instance_name: string;
    model_name: string | null;
    context_size: number | null;
    max_output_tokens: number | null;
    supports_vision?: boolean; // Optional fields based on docs
    supports_audio?: boolean;
    details?: Record<string, any>;
}

/**
 * Represents the structure for items in the `input_data` array for the /generate endpoint.
 */
interface LollmsInputDataItem {
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
    binding_name?: string | null;
    model_name?: string | null;
    generation_type?: 'ttt' | 'tti' | 'tts' | 'stt' | 'ttv' | 'ttm' | 'i2i' | 'audio2audio';
    stream?: boolean;
    parameters?: Record<string, any>;
    functions?: string[] | null;
}


/**
 * Client for interacting with the LOLLMS Server API.
 */
export class LollmsClient {
    private readonly baseUrl: string;
    private readonly apiKey?: string;

    constructor(baseUrl: string, apiKey?: string) {
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        this.apiKey = apiKey;
        console.log(`LollmsClient initialized. Base URL: ${this.baseUrl}, API Key Set: ${!!this.apiKey}`);
    }

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

    private async formatApiError(response: Response): Promise<string> {
        let errorBodyText = await response.text();
        let detail = errorBodyText;
        try {
            const jsonError = JSON.parse(errorBodyText);
            detail = jsonError.detail || JSON.stringify(jsonError);
        } catch (e) { /* Ignore parsing error */ }
        return `LOLLMS server error (${response.status}): ${detail}`;
    }

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
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: headers,
                timeout: 10000,
            });

            if (!response.ok) {
                const errorMsg = await this.formatApiError(response);
                console.error(`LOLLMS getModelInfo Error for binding '${bindingName}': ${errorMsg}`);
                return null;
            }

            const result = await response.json();
            console.debug(`LOLLMS getModelInfo Response for '${bindingName}':`, result);

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

    async generate(
        payload: LollmsGeneratePayload,
        parameters?: Record<string, any>,
    ): Promise<string | null> {
        const apiUrl = `${this.baseUrl}/api/v1/generate`;
        const headers = this.getHeaders();

        const finalParameters = { ...(payload.parameters || {}), ...(parameters || {}) };
        const finalPayload: LollmsGeneratePayload = {
             ...payload,
             parameters: finalParameters,
             stream: false
        };

        console.debug("LOLLMS Generate Request Payload:", JSON.stringify(finalPayload, null, 2).substring(0, 1000) + "...");

        try {
            console.debug(`[Step 1] Sending fetch request to ${apiUrl}`);
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(finalPayload),
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
            const isOutputArrayLike = isOutputArray || (hasOutputProperty && typeof result.output?.length === 'number');
            console.debug(`Validation: isResultObject=${isResultObject}, hasOutputProperty=${hasOutputProperty}, isOutputArray=${isOutputArray}, isOutputArrayLike=${isOutputArrayLike}`);

            if (isResultObject && hasOutputProperty && isOutputArrayLike) {
                 console.debug("[Step 5a] Validation passed: result.output exists and is array-like.");
                 const outputArray: any[] = result.output;
                 const textOutput = outputArray.find(out => out?.type === 'text');

                 if (textOutput) {
                      console.debug("[Step 6] Found textOutput object:", textOutput);
                      if (typeof textOutput.data === 'string') {
                            console.debug("[Step 6a] textOutput.data is a string.");
                            let extractedText: string | null = null; // Initialize as potentially null
                            try {
                                console.debug("[Step 7] Extracting code block...");
                                extractedText = editorUtils.extractFirstCodeBlock(textOutput.data); // Can return empty string
                                console.debug("[Step 7a] Extracted text:", extractedText);
                                // Return the extracted text. Even if empty, it's a valid string result.
                                return extractedText;
                            } catch (extractError: any) {
                                 console.error("[Error Step 7b] Error during extractFirstCodeBlock:", extractError);
                                 // Propagate the error, caught by the outer catch block
                                 throw new Error(`Error processing extracted code: ${extractError.message}`);
                            }
                      } else {
                            console.warn("[Step 6b] textOutput found, but textOutput.data is not a string. Type:", typeof textOutput.data);
                            return ""; // Treat as success but no usable text
                      }
                 } else {
                      console.warn("[Step 6c] No object with type 'text' found in output array:", result.output);
                      return ""; // Treat as success but no text output
                 }
            } else {
                let reason = "Unknown reason";
                if (!isResultObject) reason = "result object is not a valid object";
                else if (!hasOutputProperty) reason = "result object does not have 'output' property";
                else if (!isOutputArrayLike) reason = `result.output is not array-like (type: ${typeof result.output})`;

                console.error(`[Error Step 5b] Unexpected LOLLMS response format. Reason: ${reason}.`);
                // Throw error to be caught by the final catch block
                throw new Error(`Invalid response format from LOLLMS server (${reason}).`);
            }

        } catch (error: any) {
             console.error("[Final Catch Block] Error calling LOLLMS generate API or processing response:", error);
             vscode.window.showErrorMessage(`Failed to generate response from LOLLMS server: ${error.message}`);
             return null; // Return null when any error is caught
        }
    }
}

// Ensure editorUtils is imported at the top
import * as editorUtils from './editorUtils';