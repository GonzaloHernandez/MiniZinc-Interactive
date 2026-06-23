# MiniZinc Interactive

A VS Code extension that brings interactive development, real-time diagnostics, quick fixes, and visual analytics to your MiniZinc workflow.

## Features

### Direct Compilation & Execution (Standard Run)
Compile and run models instantly without leaving your code editor.
- **Top-Right Quick-Access Icons**: Click the Play (`▶`) or Play-Circle (`⚪▶`) icons on the top-right editor bar to execute your model immediately.
- **Keyboard Shortcuts**: Run models directly using the default keyboard shortcut `Ctrl+R` (or `Cmd+R` on macOS) or `Ctrl+F5`.
- **Run with Data File Picker**: Prompt and select `.dzn` data files interactively from your workspace using a fast search dropdown list.
- **Standard Output Terminal**: Visualizes all solver outputs and execution statistics in a dedicated "MiniZinc Standard Run" output panel.

### Solver Dashboard
For a more advanced interface, launch the interactive Solver Dashboard webview.
- **Custom Solvers**: Select dynamically from any locally installed MiniZinc solver (e.g., Gecode, Chuffed, COIN-OR CBC, etc.).
- **Interactive Control**: Stop, restart, or run models dynamically.
- **Real-Time Stream**: Visualizes solution streaming, search statistics, and solver exit statuses.
- **Data File Configuration**: Easily choose separate `.dzn` datasets directly from the dashboard workspace.
- **Solving Flags**: Toggle finding all solutions (`-a`), exporting solver statistics (`-s`), and specifying custom time limits or arguments.

### Real-Time Diagnostics (Linter)
Never guess compilation or syntax errors again.
- **Debounced Validation**: Checks model validity in the background on file change or save.
- **Inline Highlighting**: Surfaces precise syntax and type error line numbers, columns, and compiler messages directly in your editor.

### Smart Quick Fixes (Code Actions)
Accelerate modeling with context-aware automated quick fixes (`Ctrl+.` or `Cmd+.`):
- **Missing Library Auto-Include**: Automatically inserts standard imports (e.g., `include "alldifferent.mzn";`) when using global constraints.
- **Workspace-Wide Dependency Resolving**: Scans other workspace files for definitions and suggests relative includes.
- **Keyword Typo Correction**: Corrects typos in MiniZinc keywords (e.g., `solve`, `constraint`, `predicate`, `satisfy`).
- **Predicate & Function Stub Generation**: Generate placeholder stubs at the end of the file when calling an undefined function or predicate.

### Advanced IDE Intelligence
Rich language client features:
- **Go to Definition (`F12`)**: Instantly jump to variables, constants, predicates, or function declarations.
- **Find References (`Shift+F12`)**: Locate all occurrences of a symbol across your model.
- **Rename Symbol (`F2`)**: Rename identifiers safely across the entire document.
- **Outline view (`Ctrl+Shift+O` or `Cmd+Shift+O`)**: Explore and navigate model declarations with structured symbols outline.

### Auto-Complete Snippets
Includes standard templates for writing MiniZinc structures efficiently:
- `constraint`: Standard constraint declarations
- `forall` / `sum`: Loop quantifiers
- `varint` / `varbool` / `varfloat` / `arrayvarint`: Decision variables and arrays
- `solvesat` / `solvemin` / `solvemax`: Objective configurations
- `output`: Output rendering blocks

---

## Installation & Setup

### Prerequisites
1. **MiniZinc**: Ensure the `minizinc` compiler is installed and available in your environment's `PATH`. You can check this by running:
   ```bash
   minizinc --version
   ```

### Local Build and Install
Run the build installer script to bundle and copy the extension files directly into the local extensions repository:
```bash
bash install.sh
```
Once installed, reload your VS Code window (`Ctrl+Shift+P` / `Cmd+Shift+P` ➡️ **Developer: Reload Window**) or restart the editor.

---

## Extension Commands

| Command | Title | Default Shortcuts | Description |
|---|---|---|---|
| `minizinc.runModel` | **MiniZinc: Run Model Directly** | `Ctrl+R` / `Cmd+R` / `Ctrl+F5` | Compiles and runs the active model directly with default settings. |
| `minizinc.runModelWithData` | **MiniZinc: Run Model with Data File...** | - | Prompts for a workspace `.dzn` file and runs the model. |
| `minizinc.openDashboard` | **MiniZinc: Open Interactive Solver Dashboard** | - | Launches the graphical webview solver dashboard. |

*You can trigger these commands from the Command Palette, the editor tab title bar (using the shortcut icons), or via the editor context menu (right-click).*

---

## File Structure

```
MiniZinc-Interactive/
├── extension.js                    # Core extension code and LSP providers
├── package.json                    # Extension metadata and contribution points
├── language-configuration.json     # Bracket matching, commenting, and auto-closing rules
├── install.sh                      # Local development installation helper
├── snippets/
│   └── minizinc.code-snippets      # Standard autocomplete snippet templates
└── syntaxes/
    ├── minizinc.tmLanguage.json    # Syntax grammar rules for .mzn files
    └── minizinc-data.tmLanguage.json # Syntax grammar rules for .dzn files
```
