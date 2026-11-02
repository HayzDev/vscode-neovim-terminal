local theme = ...
vim.g.neovim_terminal_theme = theme
vim.o.termguicolors = true
vim.o.background = theme.light and 'light' or 'dark'
vim.g.colors_name = 'vscode-terminal'
vim.cmd('highlight clear')
vim.api.nvim_exec_autocmds('ColorScheme', { pattern = 'vscode-terminal' })
for group, values in pairs(theme.highlights) do
  vim.api.nvim_set_hl(0, group, values)
end
local links = {
  ['@comment'] = 'Comment', ['@string'] = 'String', ['@character'] = 'Character',
  ['@number'] = 'Number', ['@boolean'] = 'Boolean', ['@constant'] = 'Constant',
  ['@variable'] = 'Identifier', ['@variable.parameter'] = 'Identifier', ['@variable.member'] = 'Identifier',
  ['@function'] = 'Function', ['@function.call'] = 'Function', ['@function.builtin'] = 'Function',
  ['@function.method'] = 'Function', ['@function.method.call'] = 'Function',
  ['@constructor'] = 'Type', ['@type'] = 'Type', ['@type.builtin'] = 'Type',
  ['@keyword'] = 'Keyword', ['@keyword.function'] = 'Keyword', ['@keyword.return'] = 'Keyword',
  ['@keyword.conditional'] = 'Conditional', ['@keyword.repeat'] = 'Repeat',
  ['@keyword.exception'] = 'Exception', ['@keyword.operator'] = 'Operator', ['@operator'] = 'Operator',
  ['@punctuation'] = 'Delimiter', ['@tag'] = 'Tag', ['@module'] = 'Type',
  ['@markup.heading'] = 'Title', ['@string.escape'] = 'Special',
}
local semantic = {
  namespace = 'Type', class = 'Type', enum = 'Type', interface = 'Type', struct = 'Type', type = 'Type', typeParameter = 'Type',
  parameter = 'Identifier', variable = 'Identifier', property = 'Identifier', enumMember = 'Constant',
  event = 'Function', ['function'] = 'Function', method = 'Function', macro = 'PreProc',
  keyword = 'Keyword', modifier = 'StorageClass', comment = 'Comment', string = 'String',
  number = 'Number', regexp = 'String', operator = 'Operator', decorator = 'Function',
}
for group, target in pairs(links) do vim.api.nvim_set_hl(0, group, { link = target }) end
for token, target in pairs(semantic) do
  local rule = theme.semantic[token] or theme.semantic['*']
  local values = { link = target }
  if rule then
    if type(rule) == 'string' then rule = { foreground = rule } end
    values = vim.api.nvim_get_hl(0, { name = target, link = false })
    if rule.foreground and rule.foreground:match('^#%x%x%x%x%x%x$') then values.fg = rule.foreground end
    for _, style in ipairs({ 'bold', 'italic', 'underline', 'strikethrough' }) do
      if rule[style] ~= nil then values[style] = rule[style] end
    end
  end
  vim.api.nvim_set_hl(0, '@lsp.type.' .. token, values)
end
-- Personal lualine themes contain explicit colors, so replace only its palette.
local loaded, lualine = pcall(require, 'lualine')
if loaded then
  local current = lualine.get_config()
  local normal = theme.highlights.Normal
  local accent = theme.highlights.Function.fg
  local modes = {}
  for _, mode in ipairs({ 'normal', 'insert', 'visual', 'replace', 'command', 'inactive' }) do
    modes[mode] = {
      a = { fg = normal.bg, bg = accent, gui = 'bold' },
      b = { fg = normal.fg, bg = normal.bg },
      c = { fg = normal.fg, bg = normal.bg },
    }
  end
  current.options.theme = modes
  lualine.setup(current)
end
-- Keep the selected hint chip separate from its foreground-only search match.
local has_flash, flash = pcall(require, 'flash.config')
if has_flash then
  flash.label.format = function(opts)
    local target = opts.state and opts.state.target
    local current = target and opts.match.win == target.win
      and opts.match.pos[1] == target.pos[1] and opts.match.pos[2] == target.pos[2]
    local group = (current or opts.hl_group == 'FlashCurrent') and 'FlashCurrentLabel' or opts.hl_group
    return { { opts.match.label, group } }
  end
end
vim.cmd.redraw()
