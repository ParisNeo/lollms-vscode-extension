// media/chatView.js
// eslint-disable-next-line no-undef
const vscode = acquireVsCodeApi();

// --- DOM Elements ---
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const contextStatusSpan = document.getElementById('context-status');
const modelStatusSpan = document.getElementById('model-status');
const spinner = document.getElementById('spinner');

// --- State ---
let isGenerating = false;

// --- Functions ---

/** Scrolls the message container to the bottom */
function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/** Renders a single message object to the DOM */
function renderMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', `message-${message.sender}`); // e.g., message-user, message-assistant

    const senderSpan = document.createElement('span');
    senderSpan.classList.add('sender');
    senderSpan.textContent = message.sender === 'user' ? 'You' : 'LOLLMS';
    if (message.sender === 'system') {
        senderSpan.textContent = 'System';
        messageDiv.classList.add(`message-${message.type}`); // Add error/info class for system messages
    }

    const contentDiv = document.createElement('div');
    contentDiv.classList.add('content');

    // Basic code block detection and formatting (can be enhanced)
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)\n```/g;
    let lastIndex = 0;
    let hasCode = false;

    message.content.replace(codeBlockRegex, (match, lang, code, offset) => {
        hasCode = true;
        // Add text before the code block
        if (offset > lastIndex) {
            const textNode = document.createTextNode(message.content.substring(lastIndex, offset));
            contentDiv.appendChild(textNode);
        }

        // Create code block container
        const codeContainer = document.createElement('div');
        codeContainer.classList.add('code-block-container');

        // Add language label and copy button
        const header = document.createElement('div');
        header.classList.add('code-block-header');
        const langLabel = document.createElement('span');
        langLabel.classList.add('language-label');
        langLabel.textContent = lang || 'code';
        header.appendChild(langLabel);

        const copyButton = document.createElement('button');
        copyButton.classList.add('copy-button');
        copyButton.title = 'Copy Code';
        copyButton.innerHTML = `<span class="codicon codicon-copy"></span> Copy`; // Use Codicon
        copyButton.addEventListener('click', () => {
            vscode.postMessage({ command: 'copyCode', payload: { code: code.trim() } });
        });
        header.appendChild(copyButton);
        codeContainer.appendChild(header);

        // Add code itself (use <pre><code> for semantic correctness and styling)
        const pre = document.createElement('pre');
        const codeElement = document.createElement('code');
        // Basic escaping (replace with a proper library if complex HTML is needed)
        codeElement.textContent = code.trim(); // Let CSS handle whitespace/wrapping in <pre>
        // Add syntax highlighting class if language is known
        if (lang) {
            codeElement.classList.add(`language-${lang}`);
        }
        pre.appendChild(codeElement);
        codeContainer.appendChild(pre);

        contentDiv.appendChild(codeContainer);

        lastIndex = offset + match.length;
        return ''; // Necessary for replace function logic
    });

    // Add any remaining text after the last code block
    if (lastIndex < message.content.length) {
        const textNode = document.createTextNode(message.content.substring(lastIndex));
        contentDiv.appendChild(textNode);
    }

    // If no code blocks were found, just set the text content directly
    if (!hasCode) {
        contentDiv.textContent = message.content;
    }


    messageDiv.appendChild(senderSpan);
    messageDiv.appendChild(contentDiv);
    messagesContainer.appendChild(messageDiv);

    scrollToBottom();
}

/** Clears all messages from the display */
function clearMessages() {
    messagesContainer.innerHTML = '';
}

/** Updates the UI state based on generation status */
function setGeneratingStatus(generating) {
    isGenerating = generating;
    messageInput.disabled = generating;
    sendButton.disabled = generating;
    spinner.style.display = generating ? 'inline-block' : 'none';
     modelStatusSpan.textContent = generating ? "Generating..." : (modelStatusSpan.textContent === "Generating..." ? "Ready" : modelStatusSpan.textContent); // Update status text intelligently
}

/** Updates the context status display */
function updateContextStatus(fileCount) {
    contextStatusSpan.textContent = `Context: ${fileCount} file(s)`;
}

/** Updates the model/connection status display */
function updateModelStatus(messageText, isError = false) {
    modelStatusSpan.textContent = `Status: ${messageText}`;
    modelStatusSpan.style.color = isError ? 'var(--vscode-errorForeground)' : 'var(--vscode-descriptionForeground)';
}

/** Sends the message from the input field */
function sendMessage() {
    const text = messageInput.value.trim();
    if (text && !isGenerating) {
        vscode.postMessage({ command: 'sendMessage', payload: { text: text } });
        messageInput.value = ''; // Clear input after sending
        messageInput.focus(); // Keep focus on input
    }
}

// --- Event Listeners ---

// Listen for messages from the extension host
window.addEventListener('message', event => {
    const message = event.data; // The JSON data that the extension sent
    console.log("ChatView received message:", message.type, message.payload);

    switch (message.type) {
        case 'loadHistory':
            clearMessages();
            message.payload.history.forEach(renderMessage);
            setGeneratingStatus(message.payload.isGenerating);
            scrollToBottom();
            break;
        case 'addMessage':
            renderMessage(message.payload);
            break;
        case 'generationStatus':
            setGeneratingStatus(message.payload.isGenerating);
            break;
        case 'contextUpdated':
             updateContextStatus(message.payload.fileCount);
            break;
        case 'statusUpdate':
             updateModelStatus(message.payload.message, message.payload.isError);
            break;
    }
});

// Handle Send button click
sendButton.addEventListener('click', sendMessage);

// Handle Enter key press in textarea (Shift+Enter for new line)
messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault(); // Prevent default newline insertion
        sendMessage();
    }
});

// --- Initialization ---

// Request initial state when the view loads
vscode.postMessage({ command: 'getViewState' });
console.log("ChatView initialized, requesting state.");
messageInput.focus();