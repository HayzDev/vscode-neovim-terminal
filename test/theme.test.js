const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readTheme, palette, rgb, overrides } = require('../theme');

test('JSONC themes inherit colors and token rules and reject circular includes', async () => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'nvim-theme-')));
  try {
    await fs.writeFile(path.join(directory, 'base.json'), '{// comment\n"colors":{"editor.background":"#112233"},"tokenColors":[{"scope":"comment","settings":{"foreground":"#555555"}}],}');
    const child = path.join(directory, 'child.json');
    await fs.writeFile(child, '{"include":"base.json","colors":{"editor.foreground":"#abcdef"}}');
    const theme = await readTheme(child);
    const result = palette(theme, 'Child', false);
    assert.deepEqual(result.highlights.Normal, { fg: '#abcdef', bg: '#112233' });
    assert.equal(result.highlights.Comment.fg, '#555555');
    await fs.writeFile(path.join(directory, 'base.json'), '{"include":"child.json"}');
    await assert.rejects(readTheme(child), /Circular/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('theme-specific overrides, token styles, and transparent colors', () => {
  const result = palette({
    colors: { 'editor.background': '#101010', 'editor.foreground': '#eeeeee', 'editor.selectionBackground': '#ffffff80' },
    tokenColors: [{ scope: 'entity.name.function', settings: { foreground: '#ff0000', fontStyle: 'bold italic' } }],
  }, 'Theme [Dark]', false,
  { 'editor.background': '#202020', '[Theme *]': { 'editor.foreground': '#abcdef' }, '[Other]': { 'editor.foreground': '#000000' } },
  { textMateRules: [{ scope: ['entity.name.function'], settings: { foreground: '#00ff00', fontStyle: '' } }] });
  assert.deepEqual(result.highlights.Normal, { fg: '#abcdef', bg: '#202020' });
  assert.equal(result.highlights.Function.fg, '#00ff00');
  assert.equal(result.highlights.Function.bold, false);
  assert.equal(result.highlights.Visual.bg, '#909090');
  assert.equal(rgb('#123'), '#112233');
  assert.equal(rgb('#1230', '#abcdef'), '#abcdef');
  assert.equal(rgb('invalid'), undefined);
  assert.equal(overrides({ '[One][Two]': { key: 'yes' } }, 'Two').key, 'yes');
});


test('Flash hints contrast with dark, light, and midtone backgrounds and do not inherit dimming', () => {
  const { hintColors, contrast } = require('../theme');
  for (const background of ['#000000', '#1e1e1e', '#777777', '#cccccc', '#ffffff']) {
    for (const accent of [background, '#222222', '#fce566', '#5ad4e6', '#fc618d', '#ffffff']) {
      const hint = hintColors(accent, background);
      assert.ok(contrast(hint.bg, background) >= 3, `${hint.bg} must stand out from ${background}`);
      assert.ok(contrast(hint.fg, hint.bg) >= 4.5, 'label text must be readable');
      assert.equal(hint.nocombine, true);
      assert.equal(hint.italic, false);
      assert.equal(hint.blend, 0);
    }
  }
  assert.deepEqual(hintColors('#fce566', '#1e1e1e').bg, '#fce566', 'readable theme accents are preserved');
  assert.equal(contrast('#000000', '#ffffff'), 21);
});


test('search matches are foreground-only while both hint chips retain their colors', () => {
  const { hintColors, contrast } = require('../theme');
  for (const background of ['#1e1e1e', '#777777', '#ffffff']) {
    const result = palette({ colors: { 'editor.background': background,
      'terminal.ansiYellow': '#fce566', 'terminal.ansiMagenta': '#fc618d', 'terminal.ansiBlue': '#5ad4e6' } }, 'Test', false);
    assert.deepEqual(result.highlights.FlashLabel, hintColors('#fce566', background));
    assert.deepEqual(result.highlights.FlashCurrentLabel, hintColors('#fc618d', background));
    for (const group of ['Search', 'IncSearch', 'CurSearch', 'FlashCurrent', 'FlashMatch']) {
      assert.equal(result.highlights[group].bg, undefined);
      assert.ok(contrast(result.highlights[group].fg, background) >= 4.5);
    }
  }
});
