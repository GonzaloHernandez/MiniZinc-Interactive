const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');
const fs = require('fs');

let activeProcess = null;
let standardOutputChannel = null;

function log(msg) {
    try {
        fs.appendFileSync(path.join(__dirname, 'debug.log'), new Date().toISOString() + ': ' + msg + '\n');
    } catch (e) { }
}
class MiniZincCodeActionProvider {
    async provideCodeActions(document, range, context, token) {
        try {
            const allDocDiagnostics = vscode.languages.getDiagnostics(document.uri);
            const activeLine = range.start.line;
            const lineDiagnostics = allDocDiagnostics.filter(d =>
                d.range.start.line === activeLine || d.range.end.line === activeLine
            );

            log('provideCodeActions called for ' + document.uri.fsPath + ', context count: ' + context.diagnostics.length + ', line diagnostics: ' + lineDiagnostics.length);
            const codeActions = [];
            const declarations = findDeclarations(document);

            for (const diagnostic of lineDiagnostics) {
                log('diagnostic message: ' + diagnostic.message);

                const lineNum = diagnostic.range.start.line;
                const lineText = document.lineAt(lineNum).text;

                // Error: type error: no function or predicate with name `verify' found
                // Error: undefined identifier `verify'
                const match = diagnostic.message.match(/no function or predicate with name `([^']+)' found/) ||
                    diagnostic.message.match(/undefined identifier `([^']+)'/);

                if (!match) {
                    log('no match for diagnostic: ' + diagnostic.message);

                    // General keyword typo suggestion on the diagnostic line (only run for syntax/other errors)
                    const wordRegex = /\b([a-zA-Z_]\w*)\b/g;
                    let wordMatch;
                    const MZN_KEYWORDS = [
                        'solve', 'constraint', 'predicate', 'function', 'output', 'include',
                        'satisfy', 'minimize', 'maximize', 'var', 'int', 'float', 'bool',
                        'string', 'array', 'set', 'of', 'let', 'in', 'if', 'then', 'else',
                        'elseif', 'endif', 'alldifferent', 'all_different'
                    ];

                    while ((wordMatch = wordRegex.exec(lineText)) !== null) {
                        const word = wordMatch[1];
                        const charStart = wordMatch.index;

                        // Skip short words to avoid stupid keyword suggestions (e.g. changing 'S' to 'of'/'in'/'if')
                        if (word.length < 3) {
                            continue;
                        }

                        // Skip if it's already a keyword
                        if (MZN_KEYWORDS.includes(word.toLowerCase())) {
                            continue;
                        }

                        // Skip if it is already a declared identifier (variable/function/predicate) in the document
                        if (declarations.some(d => d.name === word)) {
                            continue;
                        }

                        for (const kw of MZN_KEYWORDS) {
                            const dist = getLevenshteinDistance(word, kw);
                            const maxDist = word.length <= 4 ? 1 : 2;
                            if (dist > 0 && dist <= maxDist) {
                                const action = new vscode.CodeAction(`Change '${word}' to '${kw}'`, vscode.CodeActionKind.QuickFix);
                                action.diagnostics = [diagnostic];
                                action.edit = new vscode.WorkspaceEdit();
                                const wordRange = new vscode.Range(lineNum, charStart, lineNum, charStart + word.length);
                                action.edit.replace(document.uri, wordRange, kw);
                                codeActions.push(action);
                            }
                        }
                    }
                    continue;
                }

                const missingSymbol = match[1];
                log('matched missingSymbol: ' + missingSymbol);

                // If the compiler suggested a fix: "did you mean `...`?"
                const meanMatch = diagnostic.message.match(/did you mean [`'"]([^`'"]+)[`'"]/);
                if (meanMatch) {
                    const suggestedSymbol = meanMatch[1];
                    const action = new vscode.CodeAction(`Change to '${suggestedSymbol}'`, vscode.CodeActionKind.QuickFix);
                    action.diagnostics = [diagnostic];
                    action.edit = new vscode.WorkspaceEdit();
                    action.edit.replace(document.uri, diagnostic.range, suggestedSymbol);
                    codeActions.push(action);
                }

                // 1. Spell suggestion suggestions
                const suggestions = [];
                for (const decl of declarations) {
                    const dist = getLevenshteinDistance(missingSymbol, decl.name);
                    if (dist <= 3 && decl.name !== missingSymbol) {
                        suggestions.push(decl.name);
                    }
                }
                const commonKeywords = ['alldifferent', 'all_different', 'increasing', 'strictly_increasing', 'solve', 'satisfy', 'minimize', 'maximize', 'constraint', 'output', 'show'];
                for (const kw of commonKeywords) {
                    const dist = getLevenshteinDistance(missingSymbol, kw);
                    if (dist <= 3 && kw !== missingSymbol) {
                        suggestions.push(kw);
                    }
                }
                const uniqueSuggestions = [...new Set(suggestions)];
                for (const sugg of uniqueSuggestions) {
                    const action = new vscode.CodeAction(`Change to '${sugg}'`, vscode.CodeActionKind.QuickFix);
                    action.diagnostics = [diagnostic];
                    action.edit = new vscode.WorkspaceEdit();
                    action.edit.replace(document.uri, diagnostic.range, sugg);
                    codeActions.push(action);
                }
                log('Added ' + uniqueSuggestions.length + ' spell suggestions');

                // 2. Suggestions to include library or workspace file
                const KNOWN_GLOBALS = {
                    'alldifferent': 'alldifferent.mzn',
                    'all_different': 'all_different.mzn',
                    'increasing': 'increasing.mzn',
                    'strictly_increasing': 'increasing.mzn',
                    'decreasing': 'decreasing.mzn',
                    'strictly_decreasing': 'decreasing.mzn',
                    'cumulative': 'cumulative.mzn',
                    'element': 'element.mzn',
                    'bin_packing': 'bin_packing.mzn',
                    'bin_packing_load': 'bin_packing_load.mzn',
                    'lex_less': 'lex_less.mzn',
                    'lex_lesseq': 'lex_lesseq.mzn',
                    'table': 'table.mzn',
                    'circuit': 'circuit.mzn',
                    'disjunctive': 'disjunctive.mzn',
                    'distribute': 'distribute.mzn',
                    'nvalue': 'nvalue.mzn',
                    'global_cardinality': 'global_cardinality.mzn',
                    'partition_set': 'partition_set.mzn'
                };

                if (KNOWN_GLOBALS[missingSymbol]) {
                    const libFile = KNOWN_GLOBALS[missingSymbol];
                    const action = new vscode.CodeAction(`Include library '${libFile}'`, vscode.CodeActionKind.QuickFix);
                    action.diagnostics = [diagnostic];
                    action.edit = new vscode.WorkspaceEdit();
                    action.edit.insert(document.uri, new vscode.Position(0, 0), `include "${libFile}";\n`);
                    codeActions.push(action);
                }

                // Scan other workspace files
                try {
                    const mznFiles = await vscode.workspace.findFiles('**/*.mzn');
                    for (const fileUri of mznFiles) {
                        if (fileUri.fsPath === document.uri.fsPath) {
                            continue;
                        }
                        try {
                            const fileDoc = await vscode.workspace.openTextDocument(fileUri);
                            const fileDecls = findDeclarations(fileDoc);
                            const foundDecl = fileDecls.find(d => d.name === missingSymbol);
                            if (foundDecl) {
                                const relPath = vscode.workspace.asRelativePath(fileUri);
                                const action = new vscode.CodeAction(`Include workspace file '${relPath}'`, vscode.CodeActionKind.QuickFix);
                                action.diagnostics = [diagnostic];
                                action.edit = new vscode.WorkspaceEdit();
                                action.edit.insert(document.uri, new vscode.Position(0, 0), `include "${relPath}";\n`);
                                codeActions.push(action);
                            }
                        } catch (e) {
                            // Ignore
                        }
                    }
                } catch (e) {
                    // Ignore
                }

                // 3. Create Function/Predicate Stub
                const subCall = lineText.substring(diagnostic.range.start.character);
                const parenMatch = subCall.match(/^[a-zA-Z_]\w*\s*\(([^)]*)\)/);
                const isFuncOrPredError = diagnostic.message.includes('no function or predicate');

                if (parenMatch || isFuncOrPredError) {
                    let argText = '';
                    if (parenMatch) {
                        argText = parenMatch[1];
                    }

                    const parsedArgs = parseArgumentTypes(argText, declarations);
                    const argListStr = parsedArgs.map(a => `${a.type}: ${a.name}`).join(', ');

                    const lastLine = document.lineCount - 1;
                    const lastLineText = document.lineAt(lastLine).text;
                    const position = new vscode.Position(lastLine, lastLineText.length);

                    // Create Predicate suggestion
                    const predAction = new vscode.CodeAction(`Create predicate '${missingSymbol}(${parsedArgs.map(a => a.name).join(', ')})'`, vscode.CodeActionKind.QuickFix);
                    predAction.diagnostics = [diagnostic];
                    predAction.edit = new vscode.WorkspaceEdit();
                    predAction.edit.insert(document.uri, position, `\n\npredicate ${missingSymbol}(${argListStr}) =\n  true;\n`);
                    codeActions.push(predAction);

                    // Create Function suggestion
                    const funcAction = new vscode.CodeAction(`Create function '${missingSymbol}(${parsedArgs.map(a => a.name).join(', ')})'`, vscode.CodeActionKind.QuickFix);
                    funcAction.diagnostics = [diagnostic];
                    funcAction.edit = new vscode.WorkspaceEdit();
                    funcAction.edit.insert(document.uri, position, `\n\nfunction var int: ${missingSymbol}(${argListStr}) =\n  0;\n`);
                    codeActions.push(funcAction);
                }
            }

            log('Returning ' + codeActions.length + ' actions');
            return codeActions;
        } catch (e) {
            log('Error in provideCodeActions: ' + e.message + '\n' + e.stack);
            throw e;
        }
    }
}

function activate(context) {
    log('activate called');
    console.log('MiniZinc-Interactive extension is now active!');

    // Initialize output channel
    standardOutputChannel = vscode.window.createOutputChannel("MiniZinc Standard Run");

    // Initialize diagnostic collection
    let diagnosticCollection = vscode.languages.createDiagnosticCollection('minizinc');
    context.subscriptions.push(diagnosticCollection);

    let changeTimeout = null;
    function triggerDiagnostics(document) {
        log('triggerDiagnostics called, document path: ' + (document ? document.uri.fsPath : 'null') + ', languageId: ' + (document ? document.languageId : 'null'));
        if (!document || document.languageId !== 'minizinc') {
            return;
        }
        if (changeTimeout) {
            clearTimeout(changeTimeout);
        }
        changeTimeout = setTimeout(() => {
            runDiagnostics(document, diagnosticCollection);
        }, 500); // 500ms debounce
    }

    // Register linter event listeners
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            triggerDiagnostics(event.document);
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(document => {
            if (document.languageId === 'minizinc') {
                if (changeTimeout) {
                    clearTimeout(changeTimeout);
                }
                runDiagnostics(document, diagnosticCollection);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(document => {
            if (document.languageId === 'minizinc') {
                runDiagnostics(document, diagnosticCollection);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(document => {
            if (diagnosticCollection.has(document.uri)) {
                diagnosticCollection.delete(document.uri);
            }
        })
    );

    // Initial check for currently visible editors
    vscode.window.visibleTextEditors.forEach(editor => {
        if (editor.document.languageId === 'minizinc') {
            runDiagnostics(editor.document, diagnosticCollection);
        }
    });

    // Command 1: Run Model Directly (Standard Output to Channel - 1-Click)
    let runModelDisposable = vscode.commands.registerCommand('minizinc.runModel', async () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor || activeEditor.document.languageId !== 'minizinc') {
            vscode.window.showWarningMessage('Please open a MiniZinc (.mzn) file first.');
            return;
        }
        await executeModel(activeEditor.document.uri.fsPath, null);
    });

    // Command 1.2: Run Model with Data Selection (1-Click file picker)
    let runModelWithDataDisposable = vscode.commands.registerCommand('minizinc.runModelWithData', async () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor || activeEditor.document.languageId !== 'minizinc') {
            vscode.window.showWarningMessage('Please open a MiniZinc (.mzn) file first.');
            return;
        }

        const modelPath = activeEditor.document.uri.fsPath;

        // Scan for .dzn data files
        const dznFiles = await vscode.workspace.findFiles('**/*.dzn');
        let selectedDataPath = null;

        if (dznFiles.length > 0) {
            const choices = dznFiles.map(file => ({
                label: `$(database) ${vscode.workspace.asRelativePath(file)}`,
                path: file.fsPath
            }));

            const pick = await vscode.window.showQuickPick(choices, {
                placeHolder: 'Select a data (.dzn) file for this run'
            });

            if (pick === undefined) {
                // User cancelled
                return;
            }
            selectedDataPath = pick.path;
        } else {
            vscode.window.showInformationMessage('No .dzn data files found in the workspace. Running directly.');
        }

        await executeModel(modelPath, selectedDataPath);
    });

    // Command 2: Open Interactive Solver Dashboard (Webview)
    let openDashboardDisposable = vscode.commands.registerCommand('minizinc.openDashboard', async () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor || activeEditor.document.languageId !== 'minizinc') {
            vscode.window.showWarningMessage('Please open a MiniZinc (.mzn) file to open the dashboard.');
            return;
        }

        const modelUri = activeEditor.document.uri;
        const modelPath = modelUri.fsPath;
        const modelName = path.basename(modelPath);

        const panel = vscode.window.createWebviewPanel(
            'minizincDashboard',
            `MiniZinc: ${modelName}`,
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        // Fetch solvers and data files
        getSolvers((solvers) => {
            vscode.workspace.findFiles('**/*.dzn').then(async (dznUris) => {
                const dznFiles = dznUris.map(uri => ({
                    fsPath: uri.fsPath,
                    relativePath: vscode.workspace.asRelativePath(uri)
                }));

                panel.webview.html = getWebviewContent(modelName, solvers, dznFiles, panel.webview.cspSource);
            });
        });

        let dashboardProcess = null;

        // Handle messages from Webview
        panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'run':
                        if (dashboardProcess) {
                            dashboardProcess.kill();
                        }

                        panel.webview.postMessage({ type: 'start' });

                        const runArgs = [modelPath];
                        if (message.dataPath) {
                            runArgs.push(message.dataPath);
                        }
                        if (message.solverId && message.solverId !== 'default') {
                            runArgs.push('--solver', message.solverId);
                        }

                        runArgs.push('--json-stream');

                        if (message.allSolutions) {
                            runArgs.push('-a');
                        }
                        if (message.statistics) {
                            runArgs.push('-s');
                        }
                        if (message.timeLimit) {
                            runArgs.push('--time-limit', String(message.timeLimit));
                        }
                        if (message.customArgs) {
                            const extra = message.customArgs.trim().split(/\s+/).filter(x => x.length > 0);
                            runArgs.push(...extra);
                        }

                        dashboardProcess = cp.spawn('minizinc', runArgs);
                        let buffer = '';

                        dashboardProcess.stdout.on('data', (data) => {
                            buffer += data.toString();
                            const lines = buffer.split('\n');
                            buffer = lines.pop(); // Hold incomplete line

                            for (const line of lines) {
                                if (line.trim().length === 0) continue;
                                panel.webview.postMessage({ type: 'raw', content: line });

                                try {
                                    const parsed = JSON.parse(line);
                                    if (parsed.type === 'solution') {
                                        panel.webview.postMessage({ type: 'solution', data: parsed });
                                    } else if (parsed.type === 'statistics') {
                                        panel.webview.postMessage({ type: 'stats', data: parsed.statistics });
                                    } else if (parsed.type === 'status') {
                                        panel.webview.postMessage({ type: 'status', value: parsed.status });
                                    }
                                } catch (e) {
                                    // Not JSON, ignore or log
                                }
                            }
                        });

                        dashboardProcess.stderr.on('data', (data) => {
                            const text = data.toString();
                            panel.webview.postMessage({ type: 'raw', content: `[Error] ${text}` });
                        });

                        dashboardProcess.on('close', (code) => {
                            dashboardProcess = null;
                            panel.webview.postMessage({ type: 'exit', code: code });
                        });
                        break;

                    case 'stop':
                        if (dashboardProcess) {
                            dashboardProcess.kill();
                            panel.webview.postMessage({ type: 'raw', content: '[System] Terminated solve run.' });
                            panel.webview.postMessage({ type: 'exit', code: -1 });
                            dashboardProcess = null;
                        }
                        break;

                    case 'copy':
                        vscode.env.clipboard.writeText(message.text);
                        vscode.window.showInformationMessage('Solution copied to clipboard!');
                        break;
                }
            },
            undefined,
            context.subscriptions
        );

        // Terminate process if panel is closed
        panel.onDidDispose(() => {
            if (dashboardProcess) {
                dashboardProcess.kill();
            }
        }, null, context.subscriptions);
    });

    context.subscriptions.push(runModelDisposable);
    context.subscriptions.push(runModelWithDataDisposable);
    context.subscriptions.push(openDashboardDisposable);

    // Register Rename Provider (F2)
    const renameProvider = vscode.languages.registerRenameProvider('minizinc', {
        provideRenameEdits(document, position, newName, token) {
            const wordRange = document.getWordRangeAtPosition(position);
            if (!wordRange) {
                return null;
            }
            const word = document.getText(wordRange);
            const occurrences = getOccurrences(document, word);

            const edit = new vscode.WorkspaceEdit();
            for (const occ of occurrences) {
                const range = new vscode.Range(occ.line, occ.character, occ.line, occ.character + occ.length);
                edit.replace(document.uri, range, newName);
            }
            return edit;
        }
    });
    context.subscriptions.push(renameProvider);

    // Register Go to Definition Provider (F12)
    const definitionProvider = vscode.languages.registerDefinitionProvider('minizinc', {
        provideDefinition(document, position, token) {
            const wordRange = document.getWordRangeAtPosition(position);
            if (!wordRange) {
                return null;
            }
            const word = document.getText(wordRange);
            const declarations = findDeclarations(document);
            const decl = declarations.find(d => d.name === word);
            if (decl) {
                const range = new vscode.Range(decl.line, decl.character, decl.line, decl.character + word.length);
                return new vscode.Location(document.uri, range);
            }
            return null;
        }
    });
    context.subscriptions.push(definitionProvider);

    // Register Find References Provider (Shift+F12)
    const referenceProvider = vscode.languages.registerReferenceProvider('minizinc', {
        provideReferences(document, position, context, token) {
            const wordRange = document.getWordRangeAtPosition(position);
            if (!wordRange) {
                return null;
            }
            const word = document.getText(wordRange);
            const occurrences = getOccurrences(document, word);
            return occurrences.map(occ => {
                const range = new vscode.Range(occ.line, occ.character, occ.line, occ.character + occ.length);
                return new vscode.Location(document.uri, range);
            });
        }
    });
    context.subscriptions.push(referenceProvider);

    // Register Outline/Document Symbol Provider (Ctrl+Shift+O)
    const symbolProvider = vscode.languages.registerDocumentSymbolProvider('minizinc', {
        provideDocumentSymbols(document, token) {
            const declarations = findDeclarations(document);
            return declarations.map(decl => {
                const range = new vscode.Range(decl.line, decl.character, decl.line, decl.character + decl.name.length);
                return new vscode.DocumentSymbol(
                    decl.name,
                    decl.kindName,
                    decl.kind,
                    range,
                    range
                );
            });
        }
    });
    context.subscriptions.push(symbolProvider);

    // Register Code Action Provider (Quick Fixes)
    const codeActionProvider = vscode.languages.registerCodeActionsProvider('minizinc', new MiniZincCodeActionProvider(), {
        providedCodeActionKinds: [
            vscode.CodeActionKind.QuickFix
        ]
    });
    context.subscriptions.push(codeActionProvider);
}

function deactivate() {
    if (activeProcess) {
        activeProcess.kill();
    }
}

async function executeModel(modelPath, selectedDataPath) {
    // Show output channel
    standardOutputChannel.clear();
    standardOutputChannel.show(true);
    standardOutputChannel.appendLine(`[MiniZinc] Starting compilation and run...`);
    standardOutputChannel.appendLine(`[MiniZinc] Model: ${path.basename(modelPath)}`);
    if (selectedDataPath) {
        standardOutputChannel.appendLine(`[MiniZinc] Data: ${path.basename(selectedDataPath)}`);
    }
    standardOutputChannel.appendLine(`--------------------------------------------------`);

    const args = [modelPath];
    if (selectedDataPath) {
        args.push(selectedDataPath);
    }
    args.push('-s'); // Include statistics

    if (activeProcess) {
        activeProcess.kill();
        standardOutputChannel.appendLine(`[MiniZinc] Terminated previous running instance.`);
    }

    activeProcess = cp.spawn('minizinc', args);

    activeProcess.stdout.on('data', (data) => {
        standardOutputChannel.append(data.toString());
    });

    activeProcess.stderr.on('data', (data) => {
        standardOutputChannel.append(`[Error] ${data.toString()}`);
    });

    activeProcess.on('close', (code) => {
        activeProcess = null;
        standardOutputChannel.appendLine(`--------------------------------------------------`);
        standardOutputChannel.appendLine(`[MiniZinc] Finished with exit code ${code}`);
    });
}

// Get list of solvers
function getSolvers(callback) {
    cp.exec('minizinc --solvers', (err, stdout, stderr) => {
        if (err) {
            callback([{ id: 'default', name: 'Gecode (Default)' }]);
            return;
        }

        const lines = stdout.split('\n');
        const solvers = [{ id: 'default', name: 'Default Solver' }];
        let startParsing = false;

        for (let line of lines) {
            line = line.trim();
            if (line.includes('Available solver configurations:')) {
                startParsing = true;
                continue;
            }
            if (line.includes('Search path for solver configurations:')) {
                break;
            }
            if (startParsing && line.length > 0) {
                const namePart = line.split('(')[0].trim();
                const match = line.match(/\(([^,)]+)/);
                const id = match ? match[1].trim() : namePart.toLowerCase().replace(/\s+/g, '.');
                solvers.push({ id, name: `${namePart} (${id})` });
            }
        }

        callback(solvers);
    });
}

// Generate premium Webview HTML
function getWebviewContent(modelName, solvers, dznFiles, cspSource) {
    const solverOptions = solvers.map(s => `<option value="${s.id}">${s.name}</option>`).join('\n');
    const dataOptions = dznFiles.map(f => `<option value="${f.fsPath}">${f.relativePath}</option>`).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MiniZinc Solver Dashboard</title>
    <style>
        :root {
            --bg-main: #0f172a;
            --bg-card: rgba(30, 41, 59, 0.7);
            --border-card: rgba(255, 255, 255, 0.08);
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
            --accent-indigo: #6366f1;
            --accent-indigo-hover: #4f46e5;
            --accent-emerald: #10b981;
            --accent-rose: #ef4444;
            --accent-sky: #38bdf8;
            --terminal-bg: #0b0f19;
        }
        
        body {
            background-color: var(--bg-main);
            color: var(--text-primary);
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            margin: 0;
            padding: 24px;
            box-sizing: border-box;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--border-card);
        }

        .header h1 {
            font-size: 1.5rem;
            margin: 0;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 10px;
            background: linear-gradient(to right, #a5b4fc, #818cf8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .model-badge {
            font-size: 0.85rem;
            background-color: rgba(99, 102, 241, 0.15);
            color: var(--accent-indigo);
            padding: 4px 10px;
            border-radius: 6px;
            border: 1px solid rgba(99, 102, 241, 0.3);
            font-family: monospace;
        }

        .dashboard-layout {
            display: grid;
            grid-template-columns: 340px 1fr;
            gap: 24px;
            align-items: start;
        }

        @media (max-width: 960px) {
            .dashboard-layout {
                grid-template-columns: 1fr;
            }
        }

        .card {
            background: var(--bg-card);
            border: 1px solid var(--border-card);
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
            backdrop-filter: blur(8px);
        }

        .card h2 {
            font-size: 1.1rem;
            margin-top: 0;
            margin-bottom: 18px;
            color: var(--text-primary);
            font-weight: 600;
            border-left: 3px solid var(--accent-indigo);
            padding-left: 8px;
        }

        .form-group {
            margin-bottom: 18px;
        }

        .form-group.inline {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(15, 23, 42, 0.3);
            padding: 8px 12px;
            border-radius: 8px;
        }

        label {
            display: block;
            font-size: 0.85rem;
            font-weight: 500;
            margin-bottom: 6px;
            color: var(--text-secondary);
        }

        .form-group.inline label {
            margin-bottom: 0;
        }

        select, input[type="number"], input[type="text"] {
            width: 100%;
            background-color: rgba(15, 23, 42, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 10px 12px;
            color: var(--text-primary);
            font-size: 0.9rem;
            box-sizing: border-box;
            outline: none;
            transition: all 0.2s;
        }

        select:focus, input:focus {
            border-color: var(--accent-indigo);
            box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
        }

        .switch {
            position: relative;
            display: inline-block;
            width: 40px;
            height: 20px;
        }

        .switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }

        .slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: #334155;
            transition: .4s;
            border-radius: 20px;
        }

        .slider:before {
            position: absolute;
            content: "";
            height: 14px;
            width: 14px;
            left: 3px;
            bottom: 3px;
            background-color: white;
            transition: .4s;
            border-radius: 50%;
        }

        input:checked + .slider {
            background-color: var(--accent-indigo);
        }

        input:checked + .slider:before {
            transform: translateX(20px);
        }

        .btn-container {
            display: flex;
            gap: 12px;
            margin-top: 24px;
        }

        .btn {
            flex: 1;
            padding: 12px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 0.95rem;
            cursor: pointer;
            border: none;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: all 0.2s;
        }

        .btn-run {
            background: linear-gradient(135deg, var(--accent-indigo), #4f46e5);
            color: white;
            box-shadow: 0 4px 14px rgba(99, 102, 241, 0.3);
        }

        .btn-run:hover {
            box-shadow: 0 6px 20px rgba(99, 102, 241, 0.5);
            transform: translateY(-1px);
        }

        .btn-run:disabled {
            background: #475569;
            box-shadow: none;
            cursor: not-allowed;
            transform: none;
        }

        .btn-stop {
            background-color: #334155;
            color: var(--text-primary);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .btn-stop:hover:not(:disabled) {
            background-color: var(--accent-rose);
            color: white;
            border-color: var(--accent-rose);
        }

        .btn-stop:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .status-section {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: rgba(15, 23, 42, 0.4);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            padding: 12px 16px;
            margin-bottom: 20px;
        }

        .status-label {
            font-weight: 500;
            font-size: 0.9rem;
            color: var(--text-secondary);
        }

        .status-badge {
            font-size: 0.8rem;
            font-weight: 600;
            padding: 4px 10px;
            border-radius: 20px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .status-idle { background: rgba(71, 85, 105, 0.2); color: #94a3b8; border: 1px solid rgba(71, 85, 105, 0.4); }
        .status-solving { background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); animation: statusPulse 1.5s infinite alternate; }
        .status-finished { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); }
        .status-error { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }

        @keyframes statusPulse {
            from { box-shadow: 0 0 2px rgba(59, 130, 246, 0.3); }
            to { box-shadow: 0 0 10px rgba(59, 130, 246, 0.6); }
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 12px;
            margin-bottom: 24px;
        }

        .stat-box {
            background: rgba(15, 23, 42, 0.4);
            border: 1px solid rgba(255, 255, 255, 0.03);
            border-radius: 8px;
            padding: 14px;
            text-align: center;
        }

        .stat-num {
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--accent-sky);
            margin-bottom: 4px;
        }

        .stat-name {
            font-size: 0.72rem;
            color: var(--text-muted);
            text-transform: uppercase;
            font-weight: 600;
            letter-spacing: 0.05em;
        }

        .solutions-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }

        .solutions-header h2 {
            margin: 0;
        }

        .clear-btn {
            background: transparent;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            font-size: 0.8rem;
            padding: 4px 8px;
            border-radius: 4px;
            transition: all 0.2s;
        }

        .clear-btn:hover {
            color: var(--text-primary);
            background: rgba(255, 255, 255, 0.05);
        }

        .solutions-list {
            max-height: 480px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 14px;
            padding-right: 4px;
        }

        .solution-card {
            background: rgba(15, 23, 42, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 10px;
            overflow: hidden;
            transition: border-color 0.2s;
        }

        .solution-card:hover {
            border-color: rgba(99, 102, 241, 0.3);
        }

        .solution-title {
            background: rgba(255, 255, 255, 0.02);
            padding: 10px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(255, 255, 255, 0.03);
        }

        .solution-title span {
            font-weight: 600;
            font-size: 0.85rem;
            color: var(--accent-indigo);
        }

        .time-tag {
            font-size: 0.75rem;
            color: var(--text-muted);
        }

        .copy-btn {
            background: rgba(99, 102, 241, 0.1);
            border: 1px solid rgba(99, 102, 241, 0.2);
            color: var(--accent-indigo);
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 0.75rem;
            cursor: pointer;
            transition: all 0.2s;
        }

        .copy-btn:hover {
            background: var(--accent-indigo);
            color: white;
        }

        .solution-card pre {
            margin: 0;
            padding: 16px;
            overflow-x: auto;
            font-family: 'Fira Code', 'Courier New', monospace;
            font-size: 0.9rem;
            color: #e2e8f0;
            background: rgba(0, 0, 0, 0.15);
        }

        .terminal-panel {
            margin-top: 24px;
            background-color: var(--terminal-bg);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 10px;
        }

        .terminal-header {
            padding: 10px 16px;
            background-color: rgba(255, 255, 255, 0.02);
            border-bottom: 1px solid rgba(255, 255, 255, 0.03);
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
        }

        .terminal-header span {
            font-size: 0.8rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--text-secondary);
        }

        .terminal-content {
            padding: 16px;
            max-height: 180px;
            overflow-y: auto;
            font-family: 'Fira Code', monospace;
            font-size: 0.8rem;
            color: #cbd5e1;
            white-space: pre-wrap;
            margin: 0;
        }

        .empty-placeholder {
            text-align: center;
            color: var(--text-muted);
            padding: 40px;
            font-size: 0.9rem;
            border: 1px dashed rgba(255, 255, 255, 0.05);
            border-radius: 8px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>MiniZinc Solver Dashboard</h1>
        <div class="model-badge">${modelName}</div>
    </div>

    <div class="dashboard-layout">
        <!-- Controls Column -->
        <div class="card">
            <h2>Solver Controls</h2>
            
            <div class="form-group">
                <label for="solver">Solver Engine</label>
                <select id="solver">
                    ${solverOptions}
                </select>
            </div>

            <div class="form-group">
                <label for="datafile">Data File (.dzn)</label>
                <select id="datafile">
                    <option value="">None (Run directly)</option>
                    ${dataOptions}
                </select>
            </div>

            <div class="form-group">
                <label for="timeout">Time Limit (milliseconds)</label>
                <input type="number" id="timeout" placeholder="Unlimited" min="1">
            </div>

            <div class="form-group inline">
                <label for="allsolutions">Find All Solutions</label>
                <label class="switch">
                    <input type="checkbox" id="allsolutions">
                    <span class="slider"></span>
                </label>
            </div>

            <div class="form-group inline">
                <label for="statistics">Gather Statistics</label>
                <label class="switch">
                    <input type="checkbox" id="statistics" checked>
                    <span class="slider"></span>
                </label>
            </div>

            <div class="form-group">
                <label for="customargs">Custom CLI Arguments</label>
                <input type="text" id="customargs" placeholder="e.g. -p 4 --verbose">
            </div>

            <div class="btn-container">
                <button class="btn btn-run" id="run-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                    Run Solver
                </button>
                <button class="btn btn-stop" id="stop-btn" disabled>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
                    Stop
                </button>
            </div>
        </div>

        <!-- Dashboard Results Column -->
        <div>
            <!-- Status Badge Area -->
            <div class="status-section">
                <span class="status-label">Solver Process Status:</span>
                <span class="status-badge status-idle" id="status-badge">Idle</span>
            </div>

            <!-- Stats Boxes -->
            <div class="stats-grid">
                <div class="stat-box">
                    <div class="stat-num" id="stat-solutions">0</div>
                    <div class="stat-name">Solutions</div>
                </div>
                <div class="stat-box">
                    <div class="stat-num" id="stat-time">0.00s</div>
                    <div class="stat-name">Solve Time</div>
                </div>
                <div class="stat-box">
                    <div class="stat-num" id="stat-failures">0</div>
                    <div class="stat-name">Failures</div>
                </div>
                <div class="stat-box">
                    <div class="stat-num" id="stat-nodes">0</div>
                    <div class="stat-name">Search Nodes</div>
                </div>
            </div>

            <!-- Solutions Section -->
            <div class="solutions-header">
                <h2>Solutions</h2>
                <button class="clear-btn" id="clear-btn">Clear list</button>
            </div>

            <div class="solutions-list" id="solutions-container">
                <div class="empty-placeholder" id="placeholder">No solutions found yet. Configure options and click Run.</div>
            </div>

            <!-- Terminal output -->
            <div class="terminal-panel">
                <div class="terminal-header" id="terminal-toggle">
                    <span>Raw Output Console</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
                <pre class="terminal-content" id="terminal-log" style="display: block;">Waiting for run...</pre>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        const runBtn = document.getElementById('run-btn');
        const stopBtn = document.getElementById('stop-btn');
        const clearBtn = document.getElementById('clear-btn');
        const statusBadge = document.getElementById('status-badge');
        
        // Form Elements
        const solverSelect = document.getElementById('solver');
        const dataSelect = document.getElementById('datafile');
        const timeoutInput = document.getElementById('timeout');
        const allSolutionsCheck = document.getElementById('allsolutions');
        const statisticsCheck = document.getElementById('statistics');
        const customArgsInput = document.getElementById('customargs');
        
        // Stats elements
        const statSolutions = document.getElementById('stat-solutions');
        const statTime = document.getElementById('stat-time');
        const statFailures = document.getElementById('stat-failures');
        const statNodes = document.getElementById('stat-nodes');
        
        // Output lists
        const solutionsContainer = document.getElementById('solutions-container');
        const terminalLog = document.getElementById('terminal-log');
        const placeholder = document.getElementById('placeholder');
        const terminalToggle = document.getElementById('terminal-toggle');

        let elapsedTimer = null;
        let elapsedSeconds = 0.0;
        let solutionCount = 0;
        let solutionTexts = {};

        // Toggle terminal panel
        terminalToggle.addEventListener('click', () => {
            if (terminalLog.style.display === 'none') {
                terminalLog.style.display = 'block';
            } else {
                terminalLog.style.display = 'none';
            }
        });

        // Run Clicked
        runBtn.addEventListener('click', () => {
            const dataPath = dataSelect.value;
            const solverId = solverSelect.value;
            const timeout = timeoutInput.value ? parseInt(timeoutInput.value) : null;
            const allSolutions = allSolutionsCheck.checked;
            const statistics = statisticsCheck.checked;
            const customArgs = customArgsInput.value;

            vscode.postMessage({
                command: 'run',
                dataPath,
                solverId,
                timeLimit: timeout,
                allSolutions,
                statistics,
                customArgs
            });
        });

        // Stop Clicked
        stopBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'stop' });
        });

        // Clear Clicked
        clearBtn.addEventListener('click', () => {
            clearDashboard();
        });

        function clearDashboard() {
            solutionsContainer.innerHTML = '';
            solutionsContainer.appendChild(placeholder);
            placeholder.style.display = 'block';
            terminalLog.textContent = 'Output cleared.';
            solutionCount = 0;
            solutionTexts = {};
            statSolutions.textContent = '0';
            statTime.textContent = '0.00s';
            statFailures.textContent = '0';
            statNodes.textContent = '0';
        }

        // Listener for messages from VS Code extension
        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'start':
                    runBtn.disabled = true;
                    stopBtn.disabled = false;
                    statusBadge.textContent = 'Solving';
                    statusBadge.className = 'status-badge status-solving';
                    
                    // Reset stats
                    solutionCount = 0;
                    solutionTexts = {};
                    statSolutions.textContent = '0';
                    statFailures.textContent = '0';
                    statNodes.textContent = '0';
                    
                    // Clear previous solutions/logs
                    solutionsContainer.innerHTML = '';
                    terminalLog.textContent = '[Running MiniZinc...]\\n';
                    
                    // Start visual timer
                    elapsedSeconds = 0.0;
                    clearInterval(elapsedTimer);
                    elapsedTimer = setInterval(() => {
                        elapsedSeconds += 0.05;
                        statTime.textContent = elapsedSeconds.toFixed(2) + 's';
                    }, 50);
                    break;

                case 'solution':
                    if (placeholder.parentNode === solutionsContainer) {
                        solutionsContainer.removeChild(placeholder);
                    }
                    solutionCount++;
                    statSolutions.textContent = solutionCount;

                    const dznOutput = message.data.output.default || message.data.output.dzn || message.data.output.raw || JSON.stringify(message.data.output);
                    solutionTexts[solutionCount] = dznOutput;

                    const card = document.createElement('div');
                    card.className = 'solution-card';
                    card.innerHTML = \`
                        <div class="solution-title">
                            <span>Solution #\${solutionCount}</span>
                            <div>
                                <span class="time-tag" style="margin-right:12px;">Found at \${elapsedSeconds.toFixed(2)}s</span>
                                <button class="copy-btn" onclick="copyText(\${solutionCount})">Copy</button>
                            </div>
                        </div>
                        <pre>\${escapeHtml(dznOutput)}</pre>
                    \`;
                    solutionsContainer.insertBefore(card, solutionsContainer.firstChild);
                    break;

                case 'stats':
                    const s = message.data;
                    if (s.solveTime !== undefined) {
                        clearInterval(elapsedTimer);
                        statTime.textContent = s.solveTime.toFixed(3) + 's';
                    }
                    if (s.failures !== undefined) {
                        statFailures.textContent = s.failures;
                    }
                    if (s.nodes !== undefined) {
                        statNodes.textContent = s.nodes;
                    }
                    break;

                case 'status':
                    statusBadge.textContent = message.value.replace(/_/g, ' ');
                    if (message.value === 'ALL_SOLUTIONS' || message.value === 'OPTIMAL_SOLUTION' || message.value === 'SATISFIABLE') {
                        statusBadge.className = 'status-badge status-finished';
                    } else if (message.value === 'UNSATISFIABLE' || message.value === 'UNKNOWN') {
                        statusBadge.className = 'status-badge status-error';
                    }
                    break;

                case 'raw':
                    terminalLog.textContent += message.content + '\\n';
                    terminalLog.scrollTop = terminalLog.scrollHeight;
                    break;

                case 'exit':
                    clearInterval(elapsedTimer);
                    runBtn.disabled = false;
                    stopBtn.disabled = true;
                    
                    if (statusBadge.className.includes('status-solving')) {
                        statusBadge.textContent = message.code === 0 ? 'Finished' : 'Error';
                        statusBadge.className = message.code === 0 ? 'status-badge status-finished' : 'status-badge status-error';
                    }

                    if (solutionsContainer.children.length === 0) {
                        solutionsContainer.appendChild(placeholder);
                        placeholder.style.display = 'block';
                        placeholder.textContent = message.code === 0 ? 'Model search completed. No solutions exist.' : 'Execution halted due to errors.';
                    }
                    
                    terminalLog.textContent += \`\\n[Process exited with code \${message.code}]\n\`;
                    terminalLog.scrollTop = terminalLog.scrollHeight;
                    break;
            }
        });

        function copyText(id) {
            const text = solutionTexts[id];
            vscode.postMessage({
                command: 'copy',
                text: text
            });
        }

        function escapeHtml(text) {
            return text
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }
    </script>
</body>
</html>`;
}

function runDiagnostics(document, diagnosticCollection) {
    const filePath = document.uri.fsPath;
    log('runDiagnostics started for ' + filePath);

    // Spawn compiler in check-only mode reading from stdin
    const checkerProcess = cp.spawn('minizinc', ['--model-check-only', '-'], {
        cwd: path.dirname(filePath)
    });
    let stderr = '';

    checkerProcess.stderr.on('data', (data) => {
        stderr += data.toString();
    });

    // Write document content to stdin
    checkerProcess.stdin.write(document.getText());
    checkerProcess.stdin.end();

    checkerProcess.on('close', (code) => {
        try {
            log('runDiagnostics closed with code ' + code + ', stderr:\n' + stderr);
            const diagnostics = [];

            if (code !== 0 && stderr.trim().length > 0) {
                const lines = stderr.split('\n');
                let message = "MiniZinc compilation error";
                let lineNum = 1;
                let colStart = 1;
                let colEnd = 1;

                // Regex for location, e.g. "test.mzn:7.12:" or "test.mzn:7.12-15" or "stdin:2.14"
                const locRegex = /([^:\n\s]+):(\d+)\.(\d+)(?:-(\d+))?/g;

                // Extract Error details
                const errorMatches = [...stderr.matchAll(/Error:\s*(.+)/gi)];
                if (errorMatches.length > 0) {
                    const specificMatches = errorMatches
                        .map(m => m[1].trim())
                        .filter(m => m !== 'type error' && m !== 'syntax error' && m.length > 0);
                    if (specificMatches.length > 0) {
                        message = specificMatches[0];
                    } else {
                        message = errorMatches[0][1].trim();
                    }
                } else {
                    const firstNonEmpty = lines.find(l => l.trim().startsWith('Error') || l.trim().startsWith('syntax error'));
                    if (firstNonEmpty) {
                        message = firstNonEmpty.trim();
                    }
                }

                // Extract line and column numbers
                const locMatches = [...stderr.matchAll(locRegex)];
                if (locMatches.length > 0) {
                    lineNum = parseInt(locMatches[0][2], 10);
                    colStart = parseInt(locMatches[0][3], 10);
                    colEnd = locMatches[0][4] ? parseInt(locMatches[0][4], 10) : colStart + 1;
                } else {
                    const lineRegex = /line\s+(\d+)/i;
                    const lineMatch = stderr.match(lineRegex);
                    if (lineMatch) {
                        lineNum = parseInt(lineMatch[1], 10);
                    }
                }

                // Safe range bounds checking
                const lineCount = document.lineCount;
                if (lineNum > lineCount) {
                    lineNum = lineCount;
                }

                const lineText = document.lineAt(Math.max(0, lineNum - 1)).text;
                if (colEnd > lineText.length + 1) {
                    colEnd = lineText.length + 1;
                }

                const range = new vscode.Range(
                    new vscode.Position(Math.max(0, lineNum - 1), Math.max(0, colStart - 1)),
                    new vscode.Position(Math.max(0, lineNum - 1), Math.max(0, colEnd - 1))
                );

                log('Adding diagnostic at line ' + lineNum + ', range ' + range.start.line + ':' + range.start.character + '-' + range.end.character + ', message: ' + message);
                diagnostics.push(new vscode.Diagnostic(
                    range,
                    message,
                    vscode.DiagnosticSeverity.Error
                ));
            }

            diagnosticCollection.set(document.uri, diagnostics);
            log('Set diagnostics count: ' + diagnostics.length);
        } catch (err) {
            log('Exception in runDiagnostics callback: ' + err.message + '\n' + err.stack);
        }
    });
}

function getOccurrences(document, word) {
    const occurrences = [];
    const lineCount = document.lineCount;
    let inBlockComment = false;

    for (let l = 0; l < lineCount; l++) {
        const lineText = document.lineAt(l).text;
        let c = 0;
        const len = lineText.length;
        let inString = false;

        while (c < len) {
            if (inBlockComment) {
                if (c + 1 < len && lineText[c] === '*' && lineText[c + 1] === '/') {
                    inBlockComment = false;
                    c += 2;
                } else {
                    c++;
                }
                continue;
            }

            if (inString) {
                if (lineText[c] === '"') {
                    if (c > 0 && lineText[c - 1] === '\\') {
                        c++;
                    } else {
                        inString = false;
                        c++;
                    }
                } else {
                    c++;
                }
                continue;
            }

            if (c + 1 < len && lineText[c] === '/' && lineText[c + 1] === '*') {
                inBlockComment = true;
                c += 2;
                continue;
            }

            if (lineText[c] === '%') {
                break;
            }

            if (lineText[c] === '"') {
                inString = true;
                c++;
                continue;
            }

            const sub = lineText.substring(c);
            const match = sub.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
            if (match) {
                const foundWord = match[1];
                if (foundWord === word) {
                    const charBefore = c > 0 ? lineText[c - 1] : '';
                    const isWordCharBefore = /[a-zA-Z0-9_]/.test(charBefore);
                    if (!isWordCharBefore) {
                        occurrences.push({
                            line: l,
                            character: c,
                            length: word.length
                        });
                    }
                }
                c += foundWord.length;
            } else {
                c++;
            }
        }
    }
    return occurrences;
}

function findDeclarations(document) {
    const declarations = [];
    const lineCount = document.lineCount;
    let inBlockComment = false;

    const varRegex = /\b((?:var\s+)?(?:int|float|bool|string|set\s+of\s+[a-zA-Z_]\w*|\d+\.\.\d+|[a-zA-Z_]\w*|array\s*\[[^\]]+\]\s+of\s+(?:var\s+)?(?:int|float|bool|string|\d+\.\.\d+|[a-zA-Z_]\w*)))\s*:\s*([a-zA-Z_]\w*)/;
    const predRegex = /\b(predicate|test)\s+([a-zA-Z_]\w*)/;
    const funcRegex = /\bfunction\s+([a-zA-Z0-9_\.\s\[\]\:]+):\s*([a-zA-Z_]\w*)/;

    for (let l = 0; l < lineCount; l++) {
        const lineText = document.lineAt(l).text;
        let parsedText = '';
        let c = 0;
        const len = lineText.length;
        let inString = false;

        while (c < len) {
            if (inBlockComment) {
                parsedText += ' ';
                if (c + 1 < len && lineText[c] === '*' && lineText[c + 1] === '/') {
                    inBlockComment = false;
                    c += 2;
                } else {
                    c++;
                }
                continue;
            }
            if (inString) {
                parsedText += ' ';
                if (lineText[c] === '"') {
                    if (c > 0 && lineText[c - 1] === '\\') {
                        c++;
                    } else {
                        inString = false;
                        c++;
                    }
                } else {
                    c++;
                }
                continue;
            }
            if (c + 1 < len && lineText[c] === '/' && lineText[c + 1] === '*') {
                inBlockComment = true;
                parsedText += '  ';
                c += 2;
                continue;
            }
            if (lineText[c] === '%') {
                parsedText += ' '.repeat(len - c);
                break;
            }
            if (lineText[c] === '"') {
                inString = true;
                parsedText += ' ';
                c++;
                continue;
            }
            parsedText += lineText[c];
            c++;
        }

        let match = parsedText.match(varRegex);
        let kind = vscode.SymbolKind.Variable;
        let kindName = 'Variable';
        let type = '';
        let name = '';

        if (match) {
            type = match[1].trim();
            name = match[2];
        } else {
            match = parsedText.match(predRegex);
            if (match) {
                kind = vscode.SymbolKind.Function;
                kindName = 'Predicate/Test';
                type = match[1].trim();
                name = match[2];
            } else {
                match = parsedText.match(funcRegex);
                if (match) {
                    kind = vscode.SymbolKind.Function;
                    kindName = 'Function';
                    type = match[1].trim();
                    name = match[2];
                }
            }
        }

        if (match) {
            const index = parsedText.indexOf(name);
            declarations.push({
                name: name,
                type: type,
                line: l,
                character: index,
                kind: kind,
                kindName: kindName
            });
        }
    }
    return declarations;
}

function getLevenshteinDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) == a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    Math.min(
                        matrix[i][j - 1] + 1, // insertion
                        matrix[i - 1][j] + 1  // deletion
                    )
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

function parseArgumentTypes(argStr, declarations) {
    const args = argStr.split(',').map(a => a.trim()).filter(a => a.length > 0);
    return args.map((arg, idx) => {
        if (/^\d+$/.test(arg)) {
            return { name: `arg${idx + 1}`, type: 'int' };
        }
        if (/^\d+\.\d+$/.test(arg)) {
            return { name: `arg${idx + 1}`, type: 'float' };
        }
        if (/^".*"$/.test(arg)) {
            return { name: `arg${idx + 1}`, type: 'string' };
        }
        const decl = declarations.find(d => d.name === arg);
        if (decl) {
            let t = decl.type;
            if (t.includes('..')) {
                t = t.includes('var') ? 'var int' : 'int';
            }
            return { name: arg.toLowerCase(), type: t };
        }
        return { name: `arg${idx + 1}`, type: 'var int' };
    });
}

module.exports = {
    activate,
    deactivate
};
