#!/bin/bash
# Compila el motor OCR local de Locked Legal Advisor (Vision + PDFKit de macOS).
# Requiere las Command Line Tools de Xcode (swiftc). NO necesita Homebrew ni sudo.
# Instala el binario en ~/.local/bin/lla_ocr (lo busca serve_demo.py y el backend TS).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME/.local/bin"
echo "Compilando lla_ocr (Vision + PDFKit)…"
swiftc -O "$HERE/lla_ocr.swift" -o "$HOME/.local/bin/lla_ocr" \
  -framework Vision -framework PDFKit -framework CoreGraphics -framework ImageIO -framework Foundation
echo "OK → $HOME/.local/bin/lla_ocr"
echo "Asegúrate de que ~/.local/bin esté en tu PATH (o el binario se detecta por ruta absoluta)."
echo
echo "Prueba:  lla_ocr <archivo.pdf|imagen> --max-pages 5"
