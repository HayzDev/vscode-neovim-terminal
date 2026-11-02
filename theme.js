const fs = require('node:fs/promises');
const path = require('node:path');
const { parse } = require('jsonc-parser');

async function readTheme(file, stack = new Set()) {
  if (stack.has(file)) throw new Error(`Circular theme include: ${file}`);
  stack.add(file);
  const errors = [];
  const theme = parse(await fs.readFile(file, 'utf8'), errors, { allowTrailingComma: true });
  if (errors.length || !theme || typeof theme !== 'object') throw new Error(`Invalid JSON theme: ${file}`);
  const parent = theme.include ? await readTheme(path.resolve(path.dirname(file), theme.include), stack) : {};
  return {
    colors: { ...parent.colors, ...theme.colors },
    tokenColors: [...(parent.tokenColors || []), ...(Array.isArray(theme.tokenColors) ? theme.tokenColors : [])],
    semanticTokenColors: { ...parent.semanticTokenColors, ...theme.semanticTokenColors },
  };
}

function overrides(settings, name) {
  const result = { ...settings };
  for (const [key, value] of Object.entries(settings || {})) {
    if (!key.startsWith('[')) continue;
    const patterns = [...key.matchAll(/\[([^\]]+)\]/g)].map(match => match[1]);
    if (patterns.some(pattern => new RegExp(`^${pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(name))) {
      Object.assign(result, value);
    }
    delete result[key];
  }
  return result;
}

function rgb(value, background = '#000000') {
  if (typeof value !== 'string' || !/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return undefined;
  let hex = value.slice(1);
  if (hex.length <= 4) hex = [...hex].map(digit => digit + digit).join('');
  const channels = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  if (hex.length === 8) {
    const alpha = parseInt(hex.slice(6), 16) / 255;
    channels.forEach((channel, index) => {
      channels[index] = Math.round(channel * alpha + parseInt(background.slice(1 + index * 2, 3 + index * 2), 16) * (1 - alpha));
    });
  }
  return '#' + channels.map(channel => channel.toString(16).padStart(2, '0')).join('');
}

function luminance(color) {
  const channels = [1, 3, 5].map(offset => {
    const channel = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first, second) {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function hintColors(accent, background, minimum = 3) {
  const target = contrast('#000000', background) > contrast('#ffffff', background) ? '#000000' : '#ffffff';
  let chip = accent;
  for (let step = 1; contrast(chip, background) < minimum && step <= 100; step++) {
    chip = '#' + [1, 3, 5].map(offset => {
      const from = parseInt(accent.slice(offset, offset + 2), 16);
      const to = parseInt(target.slice(offset, offset + 2), 16);
      return Math.round(from + (to - from) * step / 100).toString(16).padStart(2, '0');
    }).join('');
  }
  return { bg: chip, fg: contrast('#000000', chip) > contrast('#ffffff', chip) ? '#000000' : '#ffffff',
    bold: true, italic: false, blend: 0, nocombine: true };
}

function palette(theme, name, light, colorSettings = {}, tokenSettings = {}, semanticSettings = {}) {
  const colors = { ...theme.colors, ...overrides(colorSettings, name) };
  const tokens = overrides(tokenSettings, name);
  const rules = [...(theme.tokenColors || [])];
  const categories = { comments: 'comment', strings: 'string', keywords: 'keyword', numbers: 'constant.numeric', types: 'entity.name.type', functions: 'entity.name.function', variables: 'variable' };
  for (const [key, scope] of Object.entries(categories)) {
    if (tokens[key]) rules.push({ scope, settings: typeof tokens[key] === 'string' ? { foreground: tokens[key] } : tokens[key] });
  }
  rules.push(...(tokens.textMateRules || []));
  const base = light ? '#ffffff' : '#1e1e1e';
  const background = rgb(colors['editor.background'], base) || base;
  const foreground = rgb(colors['editor.foreground'], background) || (light ? '#000000' : '#d4d4d4');
  const color = (key, fallback = foreground) => rgb(colors[key], background) || fallback;
  const highlights = {};
  const set = (group, fg, bg, extra = {}) => {
    highlights[group] = { ...(fg ? { fg } : {}), ...(bg ? { bg } : {}), ...extra };
  };
  set('Normal', foreground, background);
  set('NormalNC', foreground, background);
  set('EndOfBuffer', background, background);
  set('SignColumn', foreground, rgb(colors['editorGutter.background'], background));
  set('LineNr', color('editorLineNumber.foreground'));
  set('CursorLineNr', color('editorLineNumber.activeForeground'));
  set('CursorLine', undefined, color('editor.lineHighlightBackground', background));
  set('Visual', undefined, color('editor.selectionBackground', light ? '#add6ff' : '#264f78'));
  // Flat and transparent themes often give floating widgets the editor's own
  // background. Keep their hues, but raise contrast enough to reveal the edges.
  const readable = (fg, bg) => hintColors(fg, bg, 4.5).bg;
  const surface = key => hintColors(color(key, background), background, 1.12).bg;
  const popup = surface('editorHoverWidget.background');
  const menu = surface('editorSuggestWidget.background');
  const border = hintColors(color('editorHoverWidget.border', color('focusBorder')), popup, 3).bg;
  const selected = hintColors(color('editorSuggestWidget.selectedBackground', color('editor.selectionBackground', menu)), menu, 1.3).bg;
  set('NormalFloat', readable(color('editorHoverWidget.foreground'), popup), popup, { blend: 0 });
  set('FloatBorder', border, popup, { blend: 0 });
  set('FloatTitle', readable(color('terminal.ansiYellow', color('focusBorder')), popup), popup, { bold: true });
  set('FloatFooter', readable(foreground, popup), popup);
  set('Pmenu', readable(color('editorSuggestWidget.foreground'), menu), menu, { blend: 0 });
  set('PmenuSel', readable(color('editorSuggestWidget.selectedForeground'), selected), selected);
  for (const [target, groups] of Object.entries({
    NormalFloat: ['SnacksNormal', 'SnacksNormalNC', 'SnacksPicker', 'SnacksPickerBox', 'SnacksPickerNormal', 'SnacksPickerInput', 'SnacksPickerList', 'SnacksPickerPreview', 'TelescopeNormal', 'TelescopePromptNormal', 'TelescopeResultsNormal', 'TelescopePreviewNormal'],
    FloatBorder: ['SnacksWinSeparator', 'SnacksPickerBorder', 'SnacksPickerInputBorder', 'SnacksPickerListBorder', 'SnacksPickerPreviewBorder', 'SnacksPickerBoxBorder', 'TelescopeBorder', 'TelescopePromptBorder', 'TelescopeResultsBorder', 'TelescopePreviewBorder'],
    FloatTitle: ['SnacksTitle', 'SnacksPickerTitle', 'SnacksPickerInputTitle', 'SnacksPickerListTitle', 'SnacksPickerPreviewTitle', 'SnacksPickerBoxTitle', 'TelescopeTitle'],
    PmenuSel: ['SnacksPickerCursorLine', 'SnacksPickerListCursorLine', 'TelescopeSelection'],
  })) for (const group of groups) highlights[group] = { ...highlights[target] };
  const referenceAccent = readable(color('terminal.ansiCyan', '#5ad4e6'), popup);
  const referenceLocation = readable(color('terminal.ansiYellow', '#fce566'), popup);
  set('NeovimTerminalReferenceFile', referenceAccent);
  set('NeovimTerminalReferenceLocation', referenceLocation);
  set('NeovimTerminalReferencePath', readable(color('descriptionForeground', '#9e9e9e'), popup));
  set('TelescopeMatching', readable(color('terminal.ansiGreen', '#a9dc76'), popup), undefined, { bold: true });
  set('TelescopeSelectionCaret', referenceAccent, selected, { bold: true });
  set('TelescopeMultiSelection', referenceLocation, selected);
  set('WinSeparator', color('editorGroup.border'), background);
  set('StatusLine', color('statusBar.foreground'), color('statusBar.background', background));
  set('StatusLineNC', color('statusBar.foreground'), color('statusBar.noFolderBackground', background));
  for (const [group, key, fallback] of [
    ['FlashLabel', 'terminal.ansiYellow', '#ffd700'],
    ['FlashCurrentLabel', 'terminal.ansiMagenta', '#d75fff'],
  ]) highlights[group] = hintColors(color(key, fallback), background);
  for (const [groups, key, fallback] of [
    [['Search', 'FlashMatch'], 'terminal.ansiBlue', '#5fafff'],
    [['IncSearch', 'CurSearch', 'FlashCurrent'], 'terminal.ansiMagenta', '#d75fff'],
  ]) {
    const fg = hintColors(color(key, fallback), background, 4.5).bg;
    for (const group of groups) set(group, fg, undefined, { bold: true, italic: false, nocombine: true });
  }


  for (const [group, key] of Object.entries({ DiagnosticError: 'editorError.foreground', DiagnosticWarn: 'editorWarning.foreground', DiagnosticInfo: 'editorInfo.foreground', DiagnosticHint: 'editorHint.foreground', DiffAdd: 'diffEditor.insertedTextBackground', DiffDelete: 'diffEditor.removedTextBackground' })) {
    if (group.startsWith('Diff')) set(group, undefined, color(key, background));
    else set(group, color(key));
  }
  const scopes = {
    Comment: ['comment'], String: ['string'], Character: ['constant.character'],
    Number: ['constant.numeric'], Boolean: ['constant.language.boolean', 'constant.language'], Float: ['constant.numeric'],
    Constant: ['constant'], Identifier: ['variable'], Function: ['entity.name.function', 'support.function'],
    Statement: ['keyword'], Conditional: ['keyword.control.conditional'], Repeat: ['keyword.control.loop'],
    Keyword: ['keyword', 'storage'], Operator: ['keyword.operator'], Exception: ['keyword.control.exception'],
    PreProc: ['meta.preprocessor', 'keyword.control.directive'], Type: ['entity.name.type', 'support.type'],
    StorageClass: ['storage.modifier'], Structure: ['storage.type'], Special: ['constant.character.escape'],
    Delimiter: ['punctuation'], Title: ['entity.name.section'], Tag: ['entity.name.tag'],
  };
  // shortcut: map common TextMate scopes; language-specific scope stacks need a tokenizer bridge.
  for (const [group, candidates] of Object.entries(scopes)) {
    const matches = [];
    for (const rule of rules) {
      for (const selector of [rule.scope || ''].flat().flatMap(scope => scope.split(',').map(value => value.trim()))) {
        if (!selector || candidates.some(candidate => candidate === selector || candidate.startsWith(selector + '.'))) {
          matches.push({ score: selector.length, settings: rule.settings });
        }
      }
    }
    const settings = Object.assign({}, ...matches.sort((a, b) => a.score - b.score).map(match => match.settings));
    const style = (settings.fontStyle || '').split(' ');
    set(group, rgb(settings.foreground, background) || foreground, rgb(settings.background, background), {
      bold: style.includes('bold'), italic: style.includes('italic'), underline: style.includes('underline'), strikethrough: style.includes('strikethrough'),
    });
  }
  const semantic = { ...theme.semanticTokenColors, ...overrides(semanticSettings, name).rules };
  return { name, light, highlights, semantic };
}

async function loadPalette(vscode) {
  const name = vscode.workspace.getConfiguration('workbench').get('colorTheme');
  for (const extension of vscode.extensions.all) {
    const contribution = extension.packageJSON.contributes?.themes?.find(theme => theme.id === name || theme.label === name);
    if (!contribution) continue;
    const theme = await readTheme(path.resolve(extension.extensionPath, contribution.path));
    const light = [vscode.ColorThemeKind.Light, vscode.ColorThemeKind.HighContrastLight].includes(vscode.window.activeColorTheme.kind);
    return palette(theme, name, light,
      vscode.workspace.getConfiguration('workbench').get('colorCustomizations', {}),
      vscode.workspace.getConfiguration('editor').get('tokenColorCustomizations', {}),
      vscode.workspace.getConfiguration('editor').get('semanticTokenColorCustomizations', {}));
  }
  throw new Error(`Cannot find the installed color theme: ${name}`);
}

module.exports = { loadPalette, readTheme, palette, rgb, overrides, hintColors, contrast };
