# LoLLMs Server - Documentation

**Version:** 0.3.2 (as per `pyproject.toml`)
**Author:** ParisNeo ([GitHub Profile](https://github.com/ParisNeo))
**Repository:** [https://github.com/ParisNeo/lollms_server](https://github.com/ParisNeo/lollms_server)

**Warning:** This project is currently in **Alpha**. Expect potential bugs, breaking changes, and incomplete features. Use with caution, especially features involving code execution.

## Table of Contents

1.  [Introduction](#1-introduction)
2.  [Key Features](#2-key-features)
3.  [Core Concepts](#3-core-concepts)
    *   [Bindings & Binding Instances](#bindings--binding-instances)
    *   [Personalities](#personalities)
    *   [Functions](#functions)
    *   [Configuration (ConfigGuard)](#configuration-configguard)
    *   [Multimodal Input/Output](#multimodal-inputoutput)
    *   [Resource Management](#resource-management)
4.  [Installation](#4-installation)
    *   [Prerequisites](#prerequisites)
    *   [Installation Steps](#installation-steps)
    *   [Activating the Environment](#activating-the-environment)
    *   [Optional Dependencies](#optional-dependencies)
5.  [Configuration](#5-configuration)
    *   [Main Configuration File (`main_config.*`)](#main-configuration-file-main_config)
    *   [Binding Instance Configuration Files](#binding-instance-configuration-files)
    *   [Configuration Wizard (`configuration_wizard.py`)](#configuration-wizard-configuration_wizardpy)
    *   [Configuration Encryption](#configuration-encryption)
6.  [Running the Server](#6-running-the-server)
7.  [API Reference](#7-api-reference)
    *   [Authentication](#authentication)
    *   [Data Models (`api/models.py`)](#data-models-apimodels)
    *   [Endpoints (`api/endpoints.py`)](#endpoints-apiendpoints)
        *   [`GET /health`](#get-health)
        *   [`GET /api/v1/list_bindings`](#get-apiv1list_bindings)
        *   [`GET /api/v1/list_active_bindings`](#get-apiv1list_active_bindings)
        *   [`GET /api/v1/list_personalities`](#get-apiv1list_personalities)
        *   [`GET /api/v1/list_functions`](#get-apiv1list_functions)
        *   [`GET /api/v1/list_models`](#get-apiv1list_models)
        *   [`GET /api/v1/list_available_models/{binding_instance_name}`](#get-apiv1list_available_modelsbinding_instance_name)
        *   [`GET /api/v1/get_default_bindings`](#get-apiv1get_default_bindings)
        *   [`GET /api/v1/get_model_info/{binding_instance_name}`](#get-apiv1get_model_infobinding_instance_name)
        *   [`POST /api/v1/generate`](#post-apiv1generate)
        *   [`POST /api/v1/tokenize`](#post-apiv1tokenize)
        *   [`POST /api/v1/detokenize`](#post-apiv1detokenize)
        *   [`POST /api/v1/count_tokens`](#post-apiv1count_tokens)
    *   [Streaming Responses](#streaming-responses)
8.  [Web UI](#8-web-ui)
9.  [Extensibility](#9-extensibility)
    *   [Adding Custom Bindings](#adding-custom-bindings)
    *   [Adding Custom Personalities](#adding-custom-personalities)
    *   [Adding Custom Functions](#adding-custom-functions)
10. [Development](#10-development)
    *   [Testing](#testing)
    *   [Linting & Formatting](#linting--formatting)
11. [License](#11-license)
12. [Disclaimer](#12-disclaimer)

---

## 1. Introduction

`lollms_server` is a versatile, asynchronous, multi-modal generation server designed to work with the [LOLLMS](https://github.com/ParisNeo/lollms) ecosystem. It provides a unified API endpoint (`/generate`) to interact with various text, image, audio, video, and music generation backends (bindings) using configurable personalities and optional function execution.

Built with FastAPI for high performance and leveraging **ConfigGuard** for robust configuration management, `lollms_server` offers schema-driven configuration validation, built-in encryption for sensitive settings, configuration versioning, and an interactive setup wizard.

The server aims to provide a reliable and extensible platform for experimenting with and deploying multi-modal AI workflows, supporting dynamic discovery of components and secure API access.

## 2. Key Features

*   **Multi-Modal Generation:** Supports Text-to-Text (TTT), Text-to-Image (TTI), Text-to-Video (TTV), Text-to-Music (TTM), Text-to-Speech (TTS), Speech-to-Text (STT), Image-to-Image (I2I), Audio-to-Audio, and more through extensible bindings.
*   **Multimodal Input API:** Accepts complex inputs via the `/generate` endpoint's `input_data` list, allowing combinations of text, images, audio, etc., each with assigned roles (e.g., `user_prompt`, `input_image`, `system_context`, `mask_image`).
*   **Binding Agnostic:** Easily integrate different AI backends (local or remote APIs) like Ollama, OpenAI (including compatible APIs), DALL-E, Gemini, llama-cpp-python, Hugging Face Transformers, Diffusers, etc.
*   **LOLLMS Personality System:** Loads and utilizes standard LOLLMS personalities, including configuration-based prompts (`config.yaml`) and scripted Python workflows (`scripts/workflow.py`).
*   **Configuration Fortress (ConfigGuard):** Robust, schema-driven configuration (YAML, TOML, JSON, SQLite) with validation, encryption, versioning, and migration support. Includes an interactive setup wizard.
*   **Asynchronous & Concurrent:** Built with FastAPI and `asyncio` for high throughput and responsiveness.
*   **Resource Management:** Implements basic resource management (GPU semaphore/lock) to prevent overloading during model loading or intensive generation tasks. Requests are queued if resources are unavailable.
*   **Dynamic Discovery:** Automatically discovers personalities, binding types, and functions placed in user-configured folders upon startup.
*   **Secure API:** Uses API key authentication (`X-API-Key` header) for all functional API endpoints.
*   **Streaming Support:** Provides Server-Sent Events (SSE) for real-time streaming outputs.
*   **Extensible Function Calling:** Allows defining custom Python functions that can be discovered and executed within scripted personality workflows.
*   **Tokenizer Utilities:** API endpoints to tokenize, detokenize, and count tokens using the active binding's model.
*   **Model Information:** API endpoint to retrieve context size, capabilities, and other details about specific models accessible via a binding.
*   **(Optional) Integrated Web UI:** Includes a basic Vue.js frontend served directly by FastAPI for easy interaction and testing (configurable).
*   **Cross-Platform:** Includes installation scripts for Linux, macOS, and Windows.
*   **Testing:** Includes a `pytest`-based test suite for core components and API endpoints.

## 3. Core Concepts

### Bindings & Binding Instances

*   **Binding Type:** A Python class (inheriting from `core.bindings.Binding`) that provides the logic to interact with a specific AI backend (e.g., Ollama API, OpenAI API, local Diffusers library). Each binding type defines its capabilities (supported modalities, streaming) and has a corresponding `binding_card.yaml` file defining its metadata and the configuration schema required for its instances. Binding types are discovered in the `zoos/bindings/` and `personal_bindings/` folders.
*   **Binding Instance:** A specific, configured instance of a Binding Type. You define instances in separate configuration files (e.g., `my_ollama_instance.yaml`, `my_openai_gpt4o.yaml`) located in the `instance_bindings_folder` (typically `lollms_configs/bindings/`). Each instance file adheres to the schema defined in its type's `binding_card.yaml` and contains specific settings like API keys, model paths, or server URLs.
*   **`bindings_map`:** A crucial section in the main configuration file (`main_config.*`) that links the *instance name* (e.g., `my_ollama_instance`) to its corresponding *binding type name* (e.g., `ollama_binding`). This tells the server which binding code to use for each configured instance.

### Personalities

*   Define the behavior, instructions (system prompt), and context for the AI. Similar to custom GPTs.
*   Located in `zoos/personalities/` (examples) and `personal_personalities/` (user-defined).
*   Consist of:
    *   `config.yaml`: Defines metadata (name, author, description, category, tags), the core `personality_conditioning` (system prompt), default generation parameters, dependencies, etc. (Structure defined by `PersonalityConfig` in `core/personalities.py`).
    *   `(Optional) assets/`: Folder for icons, example files, etc. The `icon` field in `config.yaml` points to a file here.
    *   `(Optional) scripts/workflow.py`: For **scripted personalities**. Contains a `run_workflow` async function that defines complex, agentic behavior, potentially calling bindings, functions, or manipulating context.
*   The `PersonalityManager` discovers and loads personalities based on configuration paths and enablement status in the main config's `personalities_config` section.

### Functions

*   Custom, asynchronous Python functions (`async def ...`) located in `.py` files within the configured `functions_folder` (e.g., `personal_functions/`).
*   Discovered automatically by the `FunctionManager`. Functions are namespaced by their filename (e.g., `my_utils.calculate_something`).
*   Can be called from within scripted personality workflows (`run_workflow`) using `context['function_manager'].execute_function(...)` to extend capabilities (e.g., calling external tools, performing complex calculations, interacting with databases).

### Configuration (ConfigGuard)

*   `lollms_server` uses the **ConfigGuard** library for robust configuration management.
*   **Schema-Driven:** Configuration structure, types, defaults, validation rules, and help text are defined in Python dictionaries (`MAIN_SCHEMA` in `core/config.py` for the main config, `instance_schema` in `binding_card.yaml` for binding instances).
*   **Validation:** ConfigGuard automatically validates configuration files against their schemas upon loading, catching errors early.
*   **Versioning:** Schemas include a `__version__` key. ConfigGuard handles basic migration when loading older configuration files (applying new defaults, skipping removed keys).
*   **Encryption:** Sensitive fields marked with `"secret": true` in the schema (like API keys in binding instance configs) can be automatically encrypted/decrypted if an `encryption_key` is provided in the main config's `security` section. Requires the `cryptography` library.
*   **Multiple Formats:** Supports loading/saving main and instance configurations in YAML (`.yaml`, `.yml`), JSON (`.json`), TOML (`.toml`), or SQLite (`.db`, `.sqlite`, `.sqlite3`), automatically detected by file extension. Requires corresponding optional dependencies (`pyyaml`, `toml`).
*   **Interactive Wizard:** `configuration_wizard.py` guides users through creating the initial `main_config.*` file and optionally configuring binding instances using presets.

### Multimodal Input/Output

*   **Input (`InputData`):** The `/generate` endpoint uses a list named `input_data`. Each item in the list is an object specifying:
    *   `type`: The kind of data ('text', 'image', 'audio', 'video', 'document').
    *   `role`: How the data should be interpreted (e.g., 'user_prompt', 'system_context', 'input_image', 'mask_image', 'controlnet_image'). Roles are defined by bindings/personalities.
    *   `data`: The actual content (text string, base64 encoded binary data, potentially a URL in the future).
    *   `mime_type`: Required for binary data (e.g., 'image/png', 'audio/wav').
    *   `metadata`: Optional dictionary for extra info (e.g., filename).
*   **Output (`OutputData`):** Generation results (both streaming and non-streaming) are standardized into a list of `OutputData` objects, each containing:
    *   `type`: The kind of output ('text', 'image', 'audio', 'video', 'json', 'error', 'info').
    *   `data`: The generated content.
    *   `mime_type`: For binary output.
    *   `thoughts`: Extracted content from `<think>...</think>` tags generated by the LLM.
    *   `metadata`: Dictionary with details like model used, usage stats, finish reason, etc.
*   **Thoughts:** Language models might be prompted to output reasoning steps or internal state within `<think>...</think>` tags. The server (or bindings like Gemini/Ollama) parses these tags. Thoughts are included in the `OutputData` (for non-streaming) or `StreamChunk` (for streaming) models, separate from the main `data` content.

### Resource Management

*   The `ResourceManager` (`core/resource_manager.py`) provides a mechanism to limit concurrent access to shared, finite resources, primarily intended for GPU access.
*   Configured via the `resource_manager` section in the main config:
    *   `gpu_strategy`:
        *   `semaphore`: Allows up to `gpu_limit` concurrent tasks access.
        *   `simple_lock`: Allows only one task access at a time.
        *   `none`: No locking is performed.
    *   `gpu_limit`: Maximum concurrent tasks for the `semaphore` strategy.
    *   `queue_timeout`: Maximum time (seconds) a task will wait to acquire the resource before timing out.
*   Bindings that require GPU access (like Diffusers, potentially LlamaCpp) use `async with resource_manager.acquire_gpu_resource():` to ensure controlled access during model loading or intensive generation.

## 4. Installation

### Prerequisites

*   **Python:** Version **3.9 or higher**. Verify with `python --version` or `python3 --version`. Must be in PATH. ([python.org](https://www.python.org/))
*   **pip:** Python package installer. Usually included with Python.
*   **Git:** For cloning the repository. ([git-scm.com](https://git-scm.com/))
*   **(Optional) Backend Requirements:** Depending on the bindings you plan to use:
    *   Ollama server running ([ollama.com](https://ollama.com/)).
    *   GPU drivers and CUDA Toolkit (for local GPU bindings like Diffusers, LlamaCpp).
    *   Specific Python libraries for local models (`llama-cpp-python`, `torch`, `diffusers`, etc.). See [Optional Dependencies](#optional-dependencies).
    *   API keys for services like OpenAI, Google Gemini.

### Installation Steps

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/ParisNeo/lollms_server.git
    cd lollms_server
    ```

2.  **Run the Installation Script:** This script sets up a virtual environment and installs core dependencies.
    *   **Linux / macOS:**
        ```bash
        chmod +x install.sh
        ./install.sh
        ```
    *   **Windows:**
        Double-click `install.bat` or run from terminal:
        ```cmd
        .\install.bat
        ```

    **What the script does (`install_core.py`):**
    *   Verifies your Python version (>= 3.9).
    *   Creates a virtual environment named `venv` in the project root.
    *   Installs core dependencies listed in `requirements.txt` (FastAPI, Uvicorn, Pydantic, PyYAML, ConfigGuard, ASCIIColors, PipMaster, etc.) into `venv`.
    *   **Launches the interactive Configuration Wizard (`configuration_wizard.py`)**:
        *   Prompts for the location of your user configuration directory (default: `lollms_configs/`).
        *   Asks for the desired main configuration file format (default: `.yaml`).
        *   Guides through setting server host/port, paths, security (API keys, encryption key), default bindings, resource limits.
        *   Offers **Presets** to quickly configure common setups (e.g., "Ollama GPU + DALL-E 3"). Selecting a preset automatically populates the main config (`bindings_map`, `defaults`, etc.) and offers to configure the required binding *instance* files (e.g., `lollms_configs/bindings/my_ollama_gpu.yaml`) with interactive editing.
    *   Presents a **CLI Menu** after the wizard/core install:
        *   Option 1: Re-run the Configuration Wizard.
        *   Option 2: Install optional dependencies (for specific bindings like Ollama, Diffusers, or config formats like TOML).
        *   Option 3: Manage binding instances (Add/Edit/Remove instance configuration files).
        *   Option 4: Exit.

### Activating the Environment

**Crucial:** Before running the server or installing additional packages, you *must* activate the virtual environment in your terminal session.

*   **Linux / macOS (bash/zsh):**
    ```bash
    source venv/bin/activate
    ```
*   **Windows (Command Prompt):**
    ```cmd
    venv\Scripts\activate.bat
    ```
*   **Windows (PowerShell):**
    ```powershell
    .\venv\Scripts\Activate.ps1
    ```
    (Note: You might need to adjust your PowerShell execution policy: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process`)

Your terminal prompt should now start with `(venv)`.

### Optional Dependencies

Core dependencies are installed automatically. Bindings and specific features often require extra libraries. You can install these using the installer menu (Option 2) or manually using `pip` *after activating the virtual environment*.

The project uses `pip extras` defined in `pyproject.toml` for convenience:

*   `pip install .[yaml]` (Included by default)
*   `pip install .[toml]` (For TOML config files)
*   `pip install .[encryption]` (For `cryptography` library)
*   `pip install .[openai]`
*   `pip install .[ollama]`
*   `pip install .[gemini]`
*   `pip install .[dalle]`
*   `pip install .[llamacpp]`
*   `pip install .[diffusers]` (Installs torch, transformers, diffusers, etc. - can be large!)
*   `pip install .[all]` (Installs dependencies for all listed extras)
*   `pip install .[dev]` (Installs testing and linting tools)

Check the `requirements` listed in `zoos/bindings/*/binding_card.yaml` for specific binding needs. Heavy dependencies like PyTorch/CUDA for Diffusers or LlamaCpp often require specific installation steps depending on your OS and hardware (refer to their official documentation).

## 5. Configuration

Configuration is managed by **ConfigGuard** using schemas.

### Main Configuration File (`main_config.*`)

*   **Location:** Determined during the first run (or via wizard), typically `lollms_configs/main_config.yaml`.
*   **Format:** YAML (default), TOML, JSON, or SQLite, based on the chosen file extension.
*   **Structure:** Defined by `MAIN_SCHEMA` in `lollms_server/core/config.py`.

**Key Sections:**

*   **`server`**:
    *   `host` (str): IP address to bind to (e.g., "0.0.0.0" for all interfaces, "127.0.0.1" for local only). Default: "0.0.0.0".
    *   `port` (int): Port number. Default: 9601.
    *   `allowed_origins` (list[str]): List of URLs allowed for CORS access (essential for web UIs on different ports/domains). Default includes common localhost ports.
*   **`paths`**: (Resolved to absolute paths at startup)
    *   `config_base_dir` (str): Root directory for configuration files.
    *   `instance_bindings_folder` (str): Subdirectory within `config_base_dir` for binding instance configs (e.g., `bindings`).
    *   `personalities_folder` (str): Path to user-defined personalities.
    *   `bindings_folder` (str): Path to user-defined binding types.
    *   `functions_folder` (str): Path to user-defined functions.
    *   `models_folder` (str): Base directory where model files/subdirectories are stored (scanned by `/list_models`).
    *   `example_*_folder` (str, nullable): Paths to built-in examples (usually within `zoos/`).
*   **`security`**:
    *   `allowed_api_keys` (list[str]): List of valid API keys. If empty, API key authentication is disabled (not recommended).
    *   `encryption_key` (str, nullable, secret): Optional Fernet encryption key (base64 encoded, 32 bytes) used to encrypt/decrypt sensitive fields in binding instance configs. Generate via wizard/ConfigGuard. Store securely!
*   **`defaults`**:
    *   `*_binding` (str, nullable): Default binding *instance name* (must match a key in `bindings_map`) for each modality (e.g., `ttt_binding`, `tti_binding`). Used if `binding_name` is not specified in `/generate` request.
    *   `default_context_size` (int): Fallback context window size if model info cannot be determined.
    *   `default_max_output_tokens` (int): Fallback maximum generation token limit.
*   **`bindings_map`**: (Dynamic Section)
    *   **CRUCIAL:** Maps your chosen, unique **instance names** (keys) to their corresponding **binding type names** (values, from `binding_card.yaml`).
    *   *Example:* `my_ollama_instance: ollama_binding` links the config file `lollms_configs/bindings/my_ollama_instance.yaml` to the `ollama_binding` code.
*   **`resource_manager`**:
    *   `gpu_strategy` (str): `semaphore`, `simple_lock`, or `none`.
    *   `gpu_limit` (int): Max concurrent tasks for `semaphore`.
    *   `queue_timeout` (int): Seconds to wait for resource before failing.
*   **`webui`**:
    *   `enable_ui` (bool): Serve the built-in Vue.js web UI. Default: `false`.
*   **`logging`**:
    *   `log_level` (str): "DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL".
    *   `level` (int): Numeric log level (used internally).
*   **`personalities_config`**: (Dynamic Section, nullable)
    *   Allows overriding settings for specific personalities. Keys are the personality *folder names*.
    *   *Example:* `python_builder_executor: { enabled: false }` disables the personality whose folder is named `python_builder_executor`.

### Binding Instance Configuration Files

*   **Location:** Inside the `instance_bindings_folder` defined in the main config (e.g., `lollms_configs/bindings/`).
*   **Naming:** `your_instance_name.extension` (e.g., `my_openai_gpt4o.yaml`). The `your_instance_name` part **must** match a key defined in the `bindings_map` of the main config. The `.extension` determines the format (e.g., `.yaml`).
*   **Content:** Defined by the `instance_schema` found in the corresponding binding type's `binding_card.yaml` (e.g., `zoos/bindings/openai_binding/binding_card.yaml`).
*   **Required Fields:** Must typically include `type` (matching the binding type name) and `binding_instance_name` (matching the filename stem and `bindings_map` key).
*   **Sensitive Data:** Fields marked `"secret": true` in the schema (like `api_key`) will be encrypted if an `encryption_key` is set in the main config.

### Configuration Wizard (`configuration_wizard.py`)

*   Launched automatically by `install_core.py` if no main config file is found.
*   Can be run manually later via the installer menu (Option 1).
*   Provides an interactive, menu-driven way to:
    *   Select the main configuration directory and file format.
    *   Apply **Presets** for common configurations (e.g., Ollama + DALL-E), which populates `defaults`, `bindings_map`, and other sections.
    *   Interactively configure required **binding instance** files based on chosen presets, prompting for API keys or other necessary details.
    *   Manually edit all sections and settings defined in `MAIN_SCHEMA`.
    *   Manage API keys and the encryption key.
    *   Review the final configuration before saving.

### Configuration Encryption

*   If `security.encryption_key` is set in the main config, ConfigGuard automatically encrypts any field marked `"secret": true` in a binding instance schema when saving the instance file.
*   Decryption happens automatically when the instance config is loaded.
*   The encryption key itself is *not* stored encrypted. It must be secured by other means (environment variable `LOLLMS_ENCRYPTION_KEY`, secure file storage, secrets manager). The wizard helps generate a key but doesn't manage its secure storage.
*   Requires the `cryptography` library (`pip install .[encryption]`).

## 6. Running the Server

1.  **Activate Environment:** Ensure the `venv` is active (`source venv/bin/activate` or `venv\Scripts\activate.bat`).
2.  **Use Scripts (Recommended):**
    *   **Linux/macOS:** `./run.sh`
    *   **Windows:** `.\run.bat`
    These scripts ensure the environment is active and execute `lollms_server/main.py`.
3.  **Run Manually:**
    ```bash
    (venv) python lollms_server/main.py
    ```
    The server reads host, port, workers, etc., directly from the loaded main configuration file.
4.  **Server Logs:** Output will be printed to the console, indicating the address, loaded components, and any errors. Check logs for details.
5.  **Stopping:** Press `Ctrl+C` in the terminal where the server is running. The lifespan manager will attempt graceful shutdown (e.g., unloading models).

## 7. API Reference

The server exposes a REST API for interaction.

### Authentication

Most endpoints under `/api/v1/` require authentication via an API key.

*   **Mechanism:** Include a valid API key (defined in `main_config.*` under `security.allowed_api_keys`) in the `X-API-Key` HTTP header of your request.
*   **Configuration:** If `security.allowed_api_keys` is an empty list `[]` in the main config, authentication is **disabled**, and the `X-API-Key` header is not required. This is **not recommended** for servers accessible by others.
*   **Error Codes:**
    *   `403 Forbidden`: API key is required by config, but none was provided in the header.
    *   `401 Unauthorized`: An `X-API-Key` was provided, but it does not match any key in the `allowed_api_keys` list.

### Data Models (`api/models.py`)

These Pydantic models define the structure of request bodies and responses.

*   **`InputData`**: Represents one piece of multimodal input.
    *   `type` (str): 'text', 'image', 'audio', 'video', 'document'.
    *   `role` (str): How the input is used (e.g., 'user_prompt', 'input_image', 'system_context').
    *   `data` (str): Content (text, base64 data, URL).
    *   `mime_type` (str|null): Required for binary data (e.g., 'image/png').
    *   `metadata` (dict|null): Optional extra info.
*   **`OutputData`**: Represents one piece of generated output.
    *   `type` (str): 'text', 'image', 'audio', 'video', 'json', 'error', 'info'.
    *   `data` (Any): Generated content.
    *   `mime_type` (str|null): For binary output.
    *   `thoughts` (str|null): Extracted `<think>...</think>` content.
    *   `metadata` (dict|null): Extra info (model used, usage, etc.).
*   **`GenerateRequest`**: Body for `POST /generate`. Contains `input_data: List[InputData]` and optional fields like `personality`, `binding_name`, `model_name`, `generation_type`, `stream`, `parameters`.
*   **`GenerateResponse`**: Non-streaming response wrapper. Contains `personality`, `request_id`, `output: List[OutputData]`, `execution_time`.
*   **`StreamChunk`**: Model for SSE data during streaming. Contains `type` ('chunk', 'final', 'error', 'info', 'function_call'), `content`, `thoughts`, `metadata`.
*   **Listing Responses:** `ListBindingsResponse`, `ListActiveBindingsResponse`, `ListPersonalitiesResponse`, `ListFunctionsResponse`, `ListModelsResponse`, `ListAvailableModelsResponse`. Contain dictionaries or lists of corresponding info models (e.g., `BindingTypeInfo`, `BindingInstanceInfo`, `PersonalityInfo`, `ModelInfo`).
*   **Utility Responses:** `TokenizeResponse`, `DetokenizeResponse`, `CountTokensResponse`.
*   **Info Responses:** `HealthResponse`, `GetDefaultBindingsResponse`, `GetModelInfoResponse`.

### Endpoints (`api/endpoints.py`)

All endpoints below are prefixed with `/api/v1` and require `X-API-Key` authentication (unless disabled).

---

#### `GET /health`

*   **Summary:** Check Server Health and Configuration Status.
*   **Description:** Provides server status, version, and whether API key security is enabled. No authentication required.
*   **Parameters:** None.
*   **Request Body:** None.
*   **Success Response (200 OK):** `HealthResponse`
    ```json
    {
      "status": "ok",
      "version": "0.3.2",
      "api_key_required": true
    }
    ```
*   **Errors:** Unlikely, maybe 500 if basic app setup failed.

---

#### `GET /api/v1/list_bindings`

*   **Summary:** List Discovered Binding Types and Configured Instances.
*   **Description:** Lists discovered binding types (from code/cards) and configured binding instances (from main config map and instance files). Sensitive info like API keys is omitted from the response.
*   **Parameters:** None.
*   **Request Body:** None.
*   **Success Response (200 OK):** `ListBindingsResponse`
    ```json
    {
      "binding_types": {
        "ollama_binding": {
          "type_name": "ollama_binding",
          "display_name": "Ollama",
          "version": "1.2.1",
          "author": "ParisNeo",
          "description": "Binding for the Ollama inference server...",
          "requirements": ["ollama>=0.1.7", "pillow>=9.0.0"],
          "supports_streaming": true,
          "documentation_url": "...",
          "supported_output_modalities": ["text", "image"],
          "supported_input_modalities": ["text"]
        },
        "openai_binding": {
          "type_name": "openai_binding",
          "display_name": "OpenAI Compatible",
          "version": "1.2.1",
          // ... other metadata ...
        }
      },
      "binding_instances": {
        "my_ollama_instance": {
          "type": "ollama_binding",
          "binding_instance_name": "my_ollama_instance",
          "host": "http://localhost:11434",
          "default_model": "llama3:8b"
        },
        "openai_gpt4o": {
          "type": "openai_binding",
          "binding_instance_name": "openai_gpt4o",
          "base_url": null,
          "context_size": 4096,
          "default_model": "gpt-4o-mini"
        }
      }
    }
    ```
*   **Errors:**
    *   `401 Unauthorized`, `403 Forbidden`: Authentication error.
    *   `500 Internal Server Error`: If manager fails unexpectedly.
    *   `503 Service Unavailable`: If BindingManager is not ready.

---

#### `GET /api/v1/list_active_bindings`

*   **Summary:** List Successfully Loaded Binding Instances.
*   **Description:** Lists only the binding instances that were successfully configured, passed health checks (if applicable), and loaded by the server. Omits sensitive data.
*   **Parameters:** None.
*   **Request Body:** None.
*   **Success Response (200 OK):** `ListActiveBindingsResponse`
    ```json
    {
      "bindings": {
        "my_ollama_instance": {
          "type": "ollama_binding",
          "binding_instance_name": "my_ollama_instance",
          "host": "http://localhost:11434",
          "default_model": "llama3:8b"
        }
        // Only includes instances that loaded without errors
      }
    }
    ```
*   **Errors:**
    *   `401 Unauthorized`, `403 Forbidden`: Authentication error.
    *   `500 Internal Server Error`: If manager fails unexpectedly.
    *   `503 Service Unavailable`: If BindingManager is not ready.

---

#### `GET /api/v1/list_personalities`

*   **Summary:** List Available Personalities.
*   **Description:** Lists loaded personalities that are marked as enabled in the main configuration (`personalities_config` section).
*   **Parameters:** None.
*   **Request Body:** None.
*   **Success Response (200 OK):** `ListPersonalitiesResponse`
    ```json
    {
      "personalities": {
        "lollms": {
          "name": "lollms",
          "author": "ParisNeo",
          "version": "1.2.0",
          "description": "This personality is a helpful and Kind AI...",
          "category": "generic",
          "language": "english",
          "tags": [],
          "icon": "default.png",
          "is_scripted": false,
          "path": "/path/to/lollms_server/zoos/personalities/lollms"
        },
        "artbot": {
          "name": "artbot",
          "author": "lollms_server Team",
          "version": "1.0",
          "description": "A creative assistant that can discuss ideas and generate images...",
          "category": "Creative",
          "language": null,
          "tags": ["art", "image generation", "tti", "multimodal"],
          "icon": "default.png",
          "is_scripted": true,
          "path": "/path/to/lollms_server/zoos/personalities/artbot"
        }
      }
    }
    ```
*   **Errors:**
    *   `401 Unauthorized`, `403 Forbidden`: Authentication error.
    *   `500 Internal Server Error`: If manager fails unexpectedly.
    *   `503 Service Unavailable`: If PersonalityManager is not ready.

---

#### `GET /api/v1/list_functions`

*   **Summary:** List Available Custom Functions.
*   **Description:** Lists discovered custom asynchronous Python functions available for use in scripted personalities. Names are namespaced (`module_stem.function_name`).
*   **Parameters:** None.
*   **Request Body:** None.
*   **Success Response (200 OK):** `ListFunctionsResponse`
    ```json
    {
      "functions": [
        "my_utils.calculate_something",
        "external_apis.fetch_weather"
      ]
    }
    ```
*   **Errors:**
    *   `401 Unauthorized`, `403 Forbidden`: Authentication error.
    *   `500 Internal Server Error`: If manager fails unexpectedly.
    *   `503 Service Unavailable`: If FunctionManager is not ready.

---

#### `GET /api/v1/list_models`

*   **Summary:** List Discovered Models in Folder (File Scan).
*   **Description:** Lists models found by scanning the subdirectories (`gguf`, `diffusers_models`, `tti`, etc.) within the main `models_folder` defined in the configuration. This is a simple file/directory scan, not specific to any binding's capabilities.
*   **Parameters:** None.
*   **Request Body:** None.
*   **Success Response (200 OK):** `ListModelsResponse`
    ```json
    {
      "models": {
        "ttt": [],
        "tti": [],
        "ttv": [],
        "ttm": [],
        "tts": [],
        "stt": [],
        "audio2audio": [],
        "i2i": [],
        "gguf": [
          "llama-3-8b-instruct.Q4_K_M.gguf",
          "phi-3-mini-instruct.Q5_K_M.gguf"
        ],
        "diffusers_models": [
          "stabilityai", // Might contain subdirs like stable-diffusion-xl-base-1.0
          "dreamshaper-xl-v2"
        ]
      }
    }
    ```
*   **Errors:**
    *   `401 Unauthorized`, `403 Forbidden`: Authentication error.
    *   `500 Internal Server Error`: If `models_folder` path is missing in config or scanning fails.

---

#### `GET /api/v1/list_available_models/{binding_instance_name}`

*   **Summary:** List Models Available to a Specific Binding Instance.
*   **Description:** Retrieves models recognized by a specific configured binding instance (e.g., local files it can load, models available via its API endpoint). The response format includes standardized details.
*   **Parameters:**
    *   `binding_instance_name` (Path, required): The configured name of the binding instance (e.g., `my_ollama_instance`).
*   **Request Body:** None.
*   **Success Response (200 OK):** `ListAvailableModelsResponse`
    ```json
    {
      "binding_instance_name": "my_ollama_instance",
      "models": [
        {
          "name": "llama3:8b",
          "size": 4700000000,
          "modified_at": "2025-05-10T10:00:00Z",
          "quantization_level": "Q4_0",
          "format": "gguf",
          "family": "llama",
          "families": ["llama"],
          "parameter_size": "8B",
          "context_size": 8192,
          "max_output_tokens": null,
          "template": null,
          "license": null,
          "homepage": null,
          "supports_vision": false,
          "supports_audio": false,
          "details": {
             "digest": "sha256:abcdef123..."
          }
        },
        {
          "name": "llava:latest",
          // ... other fields ...
          "supports_vision": true,
          // ...
        }
      ]
    }
    ```
*   **Errors:**
    *   `401 Unauthorized`, `403 Forbidden`: Authentication error.
    *   `404 Not Found`: If the specified `binding_instance_name` does not exist or failed to load.
    *   `500 Internal Server Error`: If the binding fails to list models.
    *   `501 Not Implemented`: If the binding doesn't support listing models.
    *   `503 Service Unavailable`: If BindingManager is not ready.

---

#### `GET /api/v1/get_default_bindings`

*   **Summary:** Get Current Default Binding Instances & Parameters.
*   **Description:** Retrieves the currently configured default binding instance names for each modality (TTT, TTI, etc.) and general default parameters (context size, max tokens) from the server's main configuration (`defaults` section).
*   **Parameters:** None.
*   **Request Body:** None.
*   **Success Response (200 OK):** `GetDefaultBindingsResponse`
    ```json
    {
      "defaults": {
        "ttt_binding": "my_ollama_instance",
        "tti_binding": "dalle3_standard",
        "tts_binding": null,
        "stt_binding": null,
        "ttv_binding": null,
        "ttm_binding": null,
        "default_context_size": 8192,
        "default_max_output_tokens": 2048
      }
    }
    ```
*   **Errors:**
    *   `401 Unauthorized`, `403 Forbidden`: Authentication error.
    *   `500 Internal Server Error`: If accessing the configuration fails.

---

#### `GET /api/v1/get_model_info/{binding_instance_name}`

*   **Summary:** Get Information about a Specific Model via a Binding.
*   **Description:** Retrieves standardized details (context size, capabilities) and binding-specific info about a model accessible through the specified binding instance. If `model_name` query parameter is omitted, returns info for the instance's default or currently active/loaded model.
*   **Parameters:**
    *   `binding_instance_name` (Path, required): The configured name of the binding instance.
    *   `model_name` (Query, optional): The specific model name/ID to query.
*   **Request Body:** None.
*   **Success Response (200 OK):** `GetModelInfoResponse`
    ```json
    {
      "binding_instance_name": "my_ollama_instance",
      "model_name": "llama3:8b", // Model this info pertains to
      "model_type": "ttt",
      "context_size": 8192,
      "max_output_tokens": null, // Ollama doesn't expose this directly
      "supports_vision": false,
      "supports_audio": false,
      "supports_streaming": true,
      "details": {
        "format": "gguf",
        "family": "llama",
        "families": ["llama"],
        "parameter_size": "8B",
        "quantization_level": "Q4_0"
      }
    }
    ```
    *Example (Model not found):*
    ```json
    {
      "binding_instance_name": "my_ollama_instance",
      "model_name": "non_existent_model",
      "model_type": null,
      "context_size": null,
      "max_output_tokens": null,
      "supports_vision": false,
      "supports_audio": false,
      "supports_streaming": true,
      "error": "Model not found locally", // Or other error message
      "details": {
          "status": "not_found"
      }
    }
    ```
*   **Errors:**
    *   `401 Unauthorized`, `403 Forbidden`: Authentication error.
    *   `404 Not Found`: If the `binding_instance_name` doesn't exist OR if the binding reports it cannot find info for the requested `model_name`.
    *   `500 Internal Server Error`: If the binding fails unexpectedly while retrieving info.
    *   `501 Not Implemented`: If the binding doesn't support the `get_model_info` method.
    *   `503 Service Unavailable`: If BindingManager is not ready.

---

#### `POST /api/v1/generate`

*   **Summary:** Generate Multimodal Output.
*   **Description:** Main endpoint to trigger generation tasks (text, image, etc.) using specified inputs, personality, binding, and parameters. Supports streaming.
*   **Parameters:** None.
*   **Request Body:** `GenerateRequest` (JSON)
    *   `input_data` (List[InputData], required): List of inputs (text, image, etc.) with roles. Must contain at least one item.
    *   `personality` (str, optional): Name of the personality to use.
    *   `binding_name` (str, optional): Specific binding instance name to use (overrides defaults).
    *   `model_name` (str, optional): Specific model name for the binding (overrides binding's default).
    *   `generation_type` (str, optional): Task type ('ttt', 'tti', 'tts', etc.). Default: 'ttt'.
    *   `stream` (bool, optional): Request streaming output. Default: false.
    *   `parameters` (dict, optional): Generation parameters (e.g., `max_tokens`, `temperature`, `image_size`, `strength`, `controlnet_scale`) overriding defaults/personality.
*   **Success Response (Non-streaming, 200 OK):** `GenerateResponse` (JSON)
    ```json
    {
      "personality": "artbot",
      "request_id": "a1b2c3d4e5f6a7b8",
      "output": [
        {
          "type": "text",
          "data": "Certainly! Here is a description of the astronaut...",
          "mime_type": null,
          "thoughts": "The user wants an image. I should describe it first, then generate the image.",
          "metadata": { /* ... TTT model usage, etc ... */ }
        },
        {
          "type": "image",
          "data": "BASE64_ENCODED_PNG_STRING",
          "mime_type": "image/png",
          "thoughts": null,
          "metadata": {
              "prompt_used": "Astronaut riding a unicorn on the moon, digital art",
              "model": "dall-e-3",
              /* ... other TTI metadata ... */
          }
        }
      ],
      "execution_time": 5.78
    }
    ```
*   **Success Response (Streaming, 200 OK):** `text/event-stream`
    *   A stream of Server-Sent Events (SSE). Each event has the format `data: JSON_STRING\n\n`, where `JSON_STRING` is a JSON representation of the `StreamChunk` model.
    *   `StreamChunk` types:
        *   `chunk`: Contains a piece of the generated content (e.g., text snippet) and potentially `thoughts` related to that chunk.
        *   `info`: Informational messages from the workflow/binding (e.g., "Starting image generation...").
        *   `error`: Reports an error during streaming.
        *   `function_call`: (Reserved for future use).
        *   `final`: The last message, indicating the stream end. Its `content` field contains the complete, standardized `List[OutputData]` (like the non-streaming response's `output` field).
*   **Errors:**
    *   `400 Bad Request`: Invalid request structure, incompatible input data for binding, invalid parameters, required model not specified/loadable.
    *   `401 Unauthorized`, `403 Forbidden`: Authentication error.
    *   `404 Not Found`: Requested personality or binding instance not found.
    *   `408 Request Timeout`: If the request waits too long in the resource queue.
    *   `422 Unprocessable Entity`: Invalid request body structure (validation error).
    *   `500 Internal Server Error`: Unexpected error during generation, binding failure.
    *   `501 Not Implemented`: Binding doesn't support requested modality or feature (e.g., streaming).
    *   `503 Service Unavailable`: Required binding/manager failed to load or is unavailable.

*   **Example `curl` (Non-streaming TTT):**
    ```bash
    curl -X POST http://localhost:9601/api/v1/generate \
    -H "Content-Type: application/json" \
    -H "X-API-Key: YOUR_API_KEY" \
    -d '{
      "input_data": [{"type": "text", "role": "user_prompt", "data": "What is the capital of France?"}],
      "stream": false
    }'
    ```

*   **Example `curl` (Streaming TTT):**
    ```bash
    curl -N -X POST http://localhost:9601/api/v1/generate \
    -H "Content-Type: application/json" \
    -H "X-API-Key: YOUR_API_KEY" \
    -d '{
      "input_data": [{"type": "text", "role": "user_prompt", "data": "Write a short poem about stars."}],
      "stream": true
    }'
    ```
    *(Output will be a stream of `data: {...}` events)*

*   **Example `curl` (TTI):**
    ```bash
    # Assume IMAGE_BASE64 contains the base64 string of a PNG image
    curl -X POST http://localhost:9601/api/v1/generate \
    -H "Content-Type: application/json" \
    -H "X-API-Key: YOUR_API_KEY" \
    -d '{
      "input_data": [
        {"type": "text", "role": "user_prompt", "data": "A cute cat wearing sunglasses, photorealistic"},
        {"type": "image", "role": "style_reference", "data": "'"$IMAGE_BASE64"'", "mime_type": "image/png"}
      ],
      "generation_type": "tti",
      "binding_name": "my_diffusers_xl"
    }'
    ```

---

#### `POST /api/v1/tokenize`

*   **Summary:** Tokenize Text using a Binding Instance.
*   **Description:** Tokenizes the provided text using the tokenizer associated with the specified binding instance. Uses the instance's default/active model if `model_name` is omitted. Not all bindings support this.
*   **Parameters:** None.
*   **Request Body:** `TokenizeRequest` (JSON)
    *   `text` (str, required): Text to tokenize.
    *   `binding_name` (str, optional): Binding instance name. Uses default TTT binding if omitted.
    *   `model_name` (str, optional): Specific model name. Uses binding's active/default if omitted.
    *   `add_bos` (bool, optional): Add Beginning-Of-Sentence token (if supported). Default: false.
    *   `add_eos` (bool, optional): Add End-Of-Sentence token (if supported). Default: false.
*   **Success Response (200 OK):** `TokenizeResponse` (JSON)
    ```json
    {
      "tokens": [1, 1724, 421, 29901, 374, 13, ...],
      "count": 25
    }
    ```
*   **Errors:**
    *   `400 Bad Request`: No binding specified or configured.
    *   `401 Unauthorized`, `403 Forbidden`: Authentication error.
    *   `404 Not Found`: Specified `binding_instance_name` not found.
    *   `500 Internal Server Error`: Binding failed during tokenization.
    *   `501 Not Implemented`: Binding does not support tokenization.
    *   `503 Service Unavailable`: BindingManager not ready.

---

#### `POST /api/v1/detokenize`

*   **Summary:** Detokenize Tokens using a Binding Instance.
*   **Description:** Converts a list of token IDs back to text using the tokenizer associated with the specified binding instance. Uses the instance's default/active model if `model_name` is omitted. Not all bindings support this.
*   **Parameters:** None.
*   **Request Body:** `DetokenizeRequest` (JSON)
    *   `tokens` (List[int], required): List of token IDs.
    *   `binding_name` (str, optional): Binding instance name. Uses default TTT binding if omitted.
    *   `model_name` (str, optional): Specific model name. Uses binding's active/default if omitted.
*   **Success Response (200 OK):** `DetokenizeResponse` (JSON)
    ```json
    {
      "text": "This is the detokenized text."
    }
    ```
*   **Errors:** Same as `/tokenize`.

---

#### `POST /api/v1/count_tokens`

*   **Summary:** Count Tokens in Text using a Binding Instance.
*   **Description:** Counts the number of tokens in the provided text using the tokenizer associated with the specified binding instance. Relies on the binding's `tokenize` implementation. Uses the instance's default/active model if `model_name` is omitted. Not all bindings support this.
*   **Parameters:** None.
*   **Request Body:** `CountTokensRequest` (JSON)
    *   `text` (str, required): Text to count tokens for.
    *   `binding_name` (str, optional): Binding instance name. Uses default TTT binding if omitted.
    *   `model_name` (str, optional): Specific model name. Uses binding's active/default if omitted.
    *   `add_bos` (bool, optional): Include BOS token in count (if applicable). Default: false.
    *   `add_eos` (bool, optional): Include EOS token in count (if applicable). Default: false.
*   **Success Response (200 OK):** `CountTokensResponse` (JSON)
    ```json
    {
      "count": 25
    }
    ```
*   **Errors:** Same as `/tokenize`.

---

### Streaming Responses

When `stream: true` is requested for `/generate`, the server responds with `Content-Type: text/event-stream`. The client receives a series of Server-Sent Events (SSE).

*   **Event Format:** Each event looks like `data: <JSON_STRING>\n\n`.
*   **`<JSON_STRING>`:** A JSON representation of the `StreamChunk` model.
*   **`StreamChunk` Fields:**
    *   `type`: Indicates the message type:
        *   `chunk`: Contains a piece of the generated output (`content`) and potentially `thoughts` related to it.
        *   `info`: Informational message (e.g., status update).
        *   `error`: An error occurred during streaming.
        *   `function_call`: Reserved for future function calling implementation.
        *   `final`: The last message. The `content` field contains the complete `List[OutputData]` result.
    *   `content`: The data payload for the chunk (text snippet, error message, or the final `List[OutputData]`).
    *   `thoughts`: Internal thoughts extracted from `<think>` tags relevant to this chunk.
    *   `metadata`: Additional information (e.g., usage stats in the `final` chunk).

Clients need to parse these events, decode the JSON data, and handle the different chunk types appropriately (e.g., append text chunks, display info/errors, process the final result).

## 8. Web UI

`lollms_server` includes an optional, basic web interface built with Vue.js.

*   **Enable:** Set `enable_ui: true` in the `[webui]` section of your main configuration file.
*   **Build (One-time setup):**
    1.  Navigate to the `webui/` directory in the project root: `cd webui`
    2.  Install Node.js dependencies: `npm install`
    3.  Build the static assets: `npm run build`
    4.  Return to the project root: `cd ..`
*   **Run Server:** Start `lollms_server` normally (e.g., `./run.sh`).
*   **Access:** Open your browser to the server's root URL (e.g., `http://localhost:9601`).

The UI allows selecting personalities, bindings, sending prompts, viewing responses (including streamed text and images), and adjusting some parameters. It uses the server's API endpoints.

## 9. Extensibility

You can add your own components to `lollms_server`. Place them in the directories specified in your main config's `[paths]` section (e.g., `personal_bindings/`, `personal_personalities/`, `personal_functions/`). The server will discover them on startup.

### Adding Custom Bindings

1.  **Create Folder:** Inside `personal_bindings/`, create a folder for your binding type (e.g., `my_custom_api_binding`).
2.  **Implement Class:** Inside the folder, create `__init__.py`. Define a class inheriting from `lollms_server.core.bindings.Binding`.
    *   Set the class attribute `binding_type_name` (e.g., `"my_custom_api_binding"`). This **must** match the `type_name` in your card.
    *   Implement the `__init__` method to accept `config: Dict[str, Any]` and `resource_manager: ResourceManager`. Store the config and initialize your binding's client or state.
    *   Implement required abstract methods: `list_available_models`, `get_supported_input_modalities`, `get_supported_output_modalities`, `load_model`, `unload_model`, `generate`, `get_model_info`.
    *   Optionally implement `generate_stream`, `tokenize`, `detokenize`, `health_check`, `get_resource_requirements`, `supports_input_role`.
    *   Handle `multimodal_data` list in `generate`/`generate_stream`.
3.  **Create `binding_card.yaml`:** In the same folder, define:
    *   `type_name`: Must match the class attribute.
    *   `display_name`, `version`, `author`, `description`, `requirements` (list of pip dependencies).
    *   `supports_streaming` (bool).
    *   `instance_schema`: A ConfigGuard schema defining the settings needed for instances of this binding (e.g., API key, URL, local paths). Include `__version__`, `type`, and `binding_instance_name` fields in the schema for ConfigGuard.
4.  **Configure Instance:**
    *   Create a file (e.g., `my_instance.yaml`) in `lollms_configs/bindings/`.
    *   Add `type: your_binding_type` and settings defined in your `instance_schema`.
    *   Add `my_instance: your_binding_type` to the `bindings_map` in `main_config.yaml`.
5.  **Dependencies:** Ensure required Python libraries (from `requirements` in card) are installed in `venv`.
6.  **Restart Server:** The new type and instance should be discovered and loaded.

### Adding Custom Personalities

**1. Simple (Config-based):**

*   **Create Folder:** E.g., `personal_personalities/my_writer`.
*   **Create `config.yaml`:** Define `name`, `author`, `version`, `personality_description`, `personality_conditioning`, etc. See `PersonalityConfig` in `core/personalities.py` or `zoos/personalities/lollms/config.yaml` for fields.
*   **(Optional) Add `assets/icon.png`** (and set `icon: icon.png` in `config.yaml`).
*   **Restart Server.**

**2. Scripted (Agentic):**

*   **Follow Simple Steps:** Create folder, `config.yaml`.
*   **Create Script:** Add `scripts/workflow.py` inside the personality folder.
*   **Define `run_workflow`:** Implement the async function:
    ```python
    # scripts/workflow.py
    import ascii_colors as logging
    from typing import Any, Dict, Optional, List, Union, AsyncGenerator
    # Import types as needed
    from lollms_server.api.models import OutputData, InputData

    async def run_workflow(prompt: str, params: Dict, context: Dict) -> Union[str, Dict, List[Dict], AsyncGenerator[Dict, None]]:
        binding = context.get('binding')
        config = context.get('config')
        function_manager = context.get('function_manager')
        input_data_list = context.get('input_data')
        # ... your logic ...
        # Example: Call binding
        # text_result = await binding.generate(prompt="Refined prompt", ...)
        # Example: Call function
        # success, func_result = await function_manager.execute_function("my_utils.do_task", {"arg": value})
        # Example: Return structured output
        return [{"type": "text", "data": "Result text"}, {"type": "info", "data": "Task completed"}]
        # Example: Return stream
        # async def my_stream():
        #     yield {"type": "chunk", "content": "Starting..."}
        #     # ... yield more chunks ...
        #     yield {"type": "final", "content": [{"type":"text", "data":"Final text"}]}
        # return my_stream()
    ```
*   **Set `script_path`:** In `config.yaml`, add `script_path: scripts/workflow.py`.
*   **(Optional) Dependencies:** Add any Python package names needed by your script to the `dependencies` list in `config.yaml`. The server will attempt to install them.
*   **(Optional) Configure Overrides:** Use the main config's `personalities_config` section to disable this personality by its folder name (e.g., `my_writer: { enabled: false }`).
*   **Restart Server.**

### Adding Custom Functions

1.  Create a Python file (e.g., `my_tools.py`) in your `functions_folder` (e.g., `personal_functions/`).
2.  Define asynchronous functions within the file:
    ```python
    import asyncio
    async def my_async_tool(param1: str, optional_param: int = 0) -> Dict:
        # ... your function logic ...
        await asyncio.sleep(0.1) # If doing I/O
        return {"result": f"Processed {param1} with {optional_param}"}
    ```
    *Functions MUST be `async def`.*
3.  **Restart Server.** The function will be discovered as `my_tools.my_async_tool`.
4.  Call it from scripted personalities using `context['function_manager'].execute_function("my_tools.my_async_tool", {"param1": "value"})`.

## 10. Development

### Testing

*   A test suite using `pytest` is located in the `tests/` directory.
*   **Setup:**
    1.  Activate the virtual environment (`venv`).
    2.  Install development dependencies: `pip install -e .[dev]`
*   **Run Tests:** From the project root directory:
    ```bash
    (venv) pytest
    ```
    Or with coverage:
    ```bash
    (venv) pytest --cov=lollms_server
    ```

### Linting & Formatting

*   **Ruff:** Used for linting (combines Flake8, isort, etc.).
    ```bash
    (venv) ruff check .
    (venv) ruff format . # Optional formatting check/apply with Ruff
    ```
*   **Black:** Used for code formatting.
    ```bash
    (venv) black .
    ```
*   **Mypy:** Used for static type checking.
    ```bash
    (venv) mypy lollms_server
    ```
    Configure your IDE (like VS Code) to use these tools automatically for the best development experience.

## 11. License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.

Copyright 2025 ParisNeo

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.

## 12. Disclaimer

This software is provided "as is" without warranty of any kind. Features involving code execution (like the `python_builder_executor` personality) are experimental and **extremely dangerous**. Use them only in isolated, secure environments and at your own risk. The developers are not responsible for any damage or data loss caused by the use of this software. Always review code generated by LLMs before execution.