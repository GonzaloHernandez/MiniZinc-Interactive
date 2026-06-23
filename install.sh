#!/bin/bash
set -e

# Target directory
EXT_DIR="$HOME/.antigravity-ide/extensions/sonar-dev.minizinc-interactive-1.0.1"

echo "=== Installing MiniZinc Interactive ==="
echo "Target directory: $EXT_DIR"

# Create extension directory
mkdir -p "$EXT_DIR"

# Copy files
echo "Copying files..."
cp package.json "$EXT_DIR/"
cp README.md "$EXT_DIR/"
cp language-configuration.json "$EXT_DIR/"
cp extension.js "$EXT_DIR/"
cp icon.png "$EXT_DIR/"

mkdir -p "$EXT_DIR/syntaxes"
cp syntaxes/minizinc.tmLanguage.json "$EXT_DIR/syntaxes/"
cp syntaxes/minizinc-data.tmLanguage.json "$EXT_DIR/syntaxes/"

mkdir -p "$EXT_DIR/snippets"
cp snippets/minizinc.code-snippets "$EXT_DIR/snippets/"

echo "------------------------------------------"
echo "Successfully installed MiniZinc extension!"
echo "Please reload your VS Code window (Developer: Reload Window command) or restart the editor to load the extension."
echo "------------------------------------------"
