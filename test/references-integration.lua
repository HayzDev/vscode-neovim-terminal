-- Run from the extension root: nvim --clean --headless '+luafile test/references-integration.lua'
-- Uses the installed Telescope and Plenary copies; no live LSP/network required.
local data = vim.fn.stdpath('data') .. '/lazy/'
vim.opt.rtp:append(data .. 'plenary.nvim')
vim.opt.rtp:append(data .. 'telescope.nvim')
require('telescope').setup({})
dofile('lua/references.lua')
local folder = vim.fn.tempname()
vim.fn.mkdir(folder, 'p')
local file = folder .. '/Readable.ahk'
vim.fn.writefile({'first()', '    target()', '    target()'}, file)
local original_request = vim.lsp.buf_request_all
local original_client = vim.lsp.get_client_by_id
vim.lsp.buf_request_all = function(_, _, _, callback)
  local uri = vim.uri_from_fname(file)
  callback({ [1] = { result = {
    { uri = uri, range = { start = { line = 1, character = 4 }, ['end'] = { line = 1, character = 10 } } },
    { uri = uri, range = { start = { line = 2, character = 4 }, ['end'] = { line = 2, character = 10 } } },
  } } })
end
vim.lsp.get_client_by_id = function() return { offset_encoding = 'utf-16' } end
vim.lsp.get_clients = function() return { { supports_method = function() return true end } } end
for _, width in ipairs({180, 100}) do
  vim.o.columns = width
  vim.o.lines = 50
  require('telescope.builtin').lsp_references({ jump_type = 'never', include_current_line = true })
  local picker
  assert(vim.wait(5000, function()
    local ok, value = pcall(require('telescope.actions.state').get_current_picker, vim.api.nvim_get_current_buf())
    if ok and value and value.manager and value.manager:num_results() == 2 then picker = value; return true end
  end, 20), 'picker must render both references')
  local lines = vim.api.nvim_buf_get_lines(picker.results_bufnr,0,-1,false)
  assert(table.concat(lines):find('Readable.ahk',1,true), vim.inspect(lines))
  assert(table.concat(lines):find('target()',1,true), vim.inspect(lines))
  assert(picker.sorting_strategy == 'ascending')
  assert(picker.__flex_strategy == (width == 180 and 'horizontal' or 'vertical'), 'adaptive preview')
  assert(vim.api.nvim_win_get_position(picker.prompt_win)[1] < vim.api.nvim_win_get_position(picker.results_win)[1], 'prompt above results')
  local entry = picker:get_selection()
  assert(entry.filename:gsub('\\','/') == file:gsub('\\','/'))
  require('telescope.actions').select_default(picker.prompt_bufnr)
  assert(vim.api.nvim_buf_get_name(0):gsub('\\','/') == file:gsub('\\','/'), 'jump file preserved')
  assert(vim.api.nvim_win_get_cursor(0)[1] == 2, 'jump line preserved')
  print('PASS real Telescope references: width=' .. width .. ', layout and display and jump')
end
vim.lsp.buf_request_all = original_request
vim.lsp.get_client_by_id = original_client
vim.fn.delete(folder, 'rf')
vim.cmd('qa!')
