# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

实时屏幕翻译 (Realtime Screen Translation) - A desktop application that captures screen regions via selection overlay, performs OCR, and translates the text. Uses PyQt6 for the GUI with global hotkey support.

## Common Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Run the application
python app.py

# Install PaddleOCR (Windows)
.\scripts\install_paddleocr.ps1
# Install PaddleOCR (Unix)
./scripts/install_paddleocr.sh

# Start local HY-MT1.5 GGUF translation server (Windows)
.\scripts\deploy_hymt_gguf.ps1
# Start local HY-MT1.5 GGUF translation server (Unix)
./scripts/deploy_hymt_gguf.sh

# Start unified OCR + translation service (Windows)
.\scripts\deploy_unified.ps1
# Start unified OCR + translation service (Unix)
./scripts/deploy_unified.sh

# Test OCR on an image
python scripts/ocr_test.py "path/to/image.png"
```

## Architecture

```
app.py                    # Entry point, imports and runs main()
rsta/
  __init__.py             # Package exports
  main_window.py          # MainWindow class - main application logic, hotkey handling, UI setup
  widgets.py              # Custom Qt widgets: StatusDot, InfoChip, RegionSelector, TranslationOverlay, LoadingSplash
  workers.py              # QObject workers for async operations: TranslateWorker, InitWorker, HealthCheckWorker
  ocr.py                  # OCR engines: TesseractOcrEngine, PaddleOcrEngine, HttpOcrEngine, create_ocr_engine()
  translators.py          # Translator backends: ArgosTranslator, LibreTranslateTranslator, UnifiedServiceTranslator, create_translator()
  capture.py              # Screen capture utilities
  config.py               # Configuration loading and defaults (CONFIG_PATH, DEFAULT_CONFIG, load_config)
  styles.py               # QSS stylesheets and palette (APP_STYLE, apply_app_palette)
scripts/
  serve_unified.py        # Unified OCR + translation HTTP service (FastAPI)
  serve_hymt_gguf.py      # Local GGUF-based MT server using llama-cpp-python
  serve_hymt.py           # Alternative HY-MT server
  serve_translategemma.py # TranslateGemma server
  ocr_test.py             # OCR testing utility
config.json               # Runtime configuration (hotkeys, OCR/translator settings, local service)
models/                   # Default model cache directory
```

## Key Patterns

**Configuration**: All settings flow through `config.json`. Use `load_config()` from `rsta/config.py` which merges user config with `DEFAULT_CONFIG`.

**Async Workers**: Long-running operations (OCR init, translation) use `QObject` workers moved to `QThread`. Workers emit signals (`finished`, `error`, `chunk` for streaming).

**Hotkeys**: Global hotkeys use `pynput.keyboard.GlobalHotKeys`. Hotkey strings use pynput format: `<ctrl>+<alt>+<shift>+q`.

**OCR Engines**: Factory pattern via `create_ocr_engine(config)`. Supports `paddleocr` (PP-OCRv5), `http` (remote unified service), and `tesseract`. PaddleOCR is preferred for accuracy.

**Translators**: Factory pattern via `create_translator(config)`. Supports `unified` (HTTP service), `argos` (offline), `libretranslate` (local/remote), and `none`.

**Unified Service**: The `serve_unified.py` script provides a single HTTP service for both OCR and translation. Set `ocr_engine: "http"` and `translator: "unified"` to use it.

**Streaming Translation**: `LibreTranslateTranslator.translate_stream()` and `UnifiedServiceTranslator.translate_stream()` yield chunks via SSE. Server uses JSON token format: `data: {"token": "..."}\n`.

## Configuration Keys

- `hotkey` / `swap_hotkey` / `close_overlay_hotkey`: Global hotkeys in pynput format
- `ocr_engine`: `paddleocr`, `http`, or `tesseract`
- `ocr_lang`: Tesseract language code (e.g., `chi_sim`, `eng`)
- `source_lang` / `target_lang`: Translation language codes
- `translator`: `unified`, `argos`, `libretranslate`, or `none`
- `paddleocr.*`: PaddleOCR-specific settings (lang, ocr_version, thresholds, debug options)
- `local_service.*`: Local MT server settings (enabled, port, quant level)
- `unified_service.*`: Unified OCR+translation service settings (enabled, host, port, timeout, ocr_model_type)
- `startup.*`: Startup behavior settings (auto_load_ocr, auto_load_translator, auto_start_unified_service, auto_start_local_service)
- `ui.*`: UI timing and overlay size constraints

## Code Style

- Python 3.10+, follow PEP 8
- UI strings are in Chinese
- 4-space indentation
- Use descriptive names, small readable functions
- All comments and documentation in Chinese per project convention
