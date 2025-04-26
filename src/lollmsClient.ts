import * as vscode from 'vscode';
// Make sure to install node-fetch: npm install node-fetch@2 @types/node-fetch@2 --save-dev
import fetch from 'node-fetch';

export class LollmsClient {
    private baseUrl: string;
    private apiKey?: string;

    constructor(baseUrl: string, apiKey?: string) {
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        this.apiKey = apiKey;
    }

    /**
     * Generic method to call the LOLLMS /generate endpoint.
     * @param fullPrompt The complete prompt string to send.
     * @param parameters Generation parameters.
     * @param personality Optional personality name.
     * @returns The generated text content or null on failure.
     */
    async generate(
        fullPrompt: string,
        parameters: Record<string, any>,
        personality: string | null = null
    ): Promise<string | null> {
        const apiUrl = `${this.baseUrl}/api/v1/generate`;

        const headers: { [key: string]: string } = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        if (this.apiKey) {
            headers['X-API-Key'] = this.apiKey;
        }

        const payload = {
            input_data: [{
                type: "text",
                role: "user_prompt", // Assume main prompt role here
                data: fullPrompt
                // We could potentially add more input_data items here
                // if the calling function passes structured context,
                // but for now keep it simple: full prompt is in 'data'.
            }],
            personality: personality,
            generation_type: "ttt", // Assume text generation
            stream: false,
            parameters: parameters || {}
        };

        console.debug("LOLLMS Request Payload:", JSON.stringify(payload, null, 2)); // Log the full payload

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload),
                // Consider making timeout configurable
                // timeout: parameters.timeout || 60000, // Example: 60 seconds default
            });

            if (!response.ok) {
                let errorBodyText = await response.text();
                let detail = errorBodyText;
                try {
                    const jsonError = JSON.parse(errorBodyText);
                    detail = jsonError.detail || JSON.stringify(jsonError);
                } catch (e) { /* Ignore parsing error, use text */ }
                console.error(`LOLLMS API Error (${response.status}): ${detail}`);
                throw new Error(`LOLLMS server error (${response.status}): ${detail}`);
            }

            const result = await response.json();
            console.debug("LOLLMS Response:", JSON.stringify(result, null, 2));

            if (result && result.output && typeof result.output.text === 'string') {
                const generatedText = result.output.text.trim();
                // Basic cleanup: remove potential markdown fences sometimes added by models
                return generatedText.replace(/^```(?:\w+)?\s*|\s*```$/gm, '').trim();
            } else {
                console.error("Unexpected LOLLMS response format:", result);
                throw new Error('Invalid response format from LOLLMS server.');
            }

        } catch (error: any) {
            console.error("Error calling LOLLMS API:", error);
            vscode.window.showErrorMessage(`Failed to communicate with LOLLMS: ${error.message}`);
            return null;
        }
    }
}