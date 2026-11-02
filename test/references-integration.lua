-- Run from the extension root: nvim --clean --headless '+luafile test/references-integration.lua'
-- Uses the installed Telescope and Plenary copies; no live LSP/network required.
local data = vim.fn.stdpath('data') .. '/lazy/'
vim.opt.rtp:append(data .. 'plenary.nvim')
vim.opt.rtp:append(data .. 'telescope.nvim')
require('telescope').setup({})
dofile('lua/references.lua')
-- A deep folder outside the cwd, like a Mason package's bundled syntax file.
local root = vim.fn.tempname()
local folder = root .. '/packages/autohotkey2-lsp/extension/syntaxes'
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
local function groups_at(buf, row, col)
  local found = {}
  for _, mark in ipairs(vim.api.nvim_buf_get_extmarks(buf, -1, { row, 0 }, { row, -1 }, { details = true, overlap = true })) do
    local start, details = mark[3], mark[4]
    local finish = details.end_row == row and details.end_col or math.huge
    if details.hl_group and start <= col and col < finish then found[details.hl_group] = true end
  end
  return found
end
for _, width in ipairs({180, 100, 72}) do
  vim.o.columns = width
  vim.o.lines = 50
  require('telescope.builtin').lsp_references({ jump_type = 'never', include_current_line = true })
  local picker
  assert(vim.wait(5000, function()
    local ok, value = pcall(require('telescope.actions.state').get_current_picker, vim.api.nvim_get_current_buf())
    if ok and value and value.manager and value.manager:num_results() == 2 then picker = value; return true end
  end, 20), 'picker must render both references')
  vim.wait(200, function() return #vim.api.nvim_buf_get_extmarks(picker.results_bufnr, -1, 0, -1, {}) > 0 end)
  local lines = vim.api.nvim_buf_get_lines(picker.results_bufnr,0,-1,false)
  local text = table.concat(lines, '\n')
  assert(text:find('Readable.ahk',1,true), text)
  assert(text:find('target()',1,true), text)
  assert(text:find('2:5',1,true), text)
  -- Folder stays readable (whole trailing segments, no c:/U/X/... initials) and
  -- is omitted on narrow lists, where the code needs the room.
  local results_width = vim.api.nvim_win_get_width(picker.results_win)
  if results_width - 2 >= 70 then assert(text:find('/syntaxes',1,true) and not text:find('/p/a/',1,true), text)
  else assert(not text:find('syntaxes',1,true), text) end
  assert(picker.sorting_strategy == 'ascending')
  assert(picker.__flex_strategy == (width == 180 and 'horizontal' or 'vertical'), 'adaptive preview')
  assert(vim.api.nvim_win_get_position(picker.prompt_win)[1] < vim.api.nvim_win_get_position(picker.results_win)[1], 'prompt above results')
  -- Two hits must not get a screenful of empty result rows.
  local results_height = vim.api.nvim_win_get_height(picker.results_win)
  assert(results_height <= (width == 180 and 14 or 3), 'compact results height ' .. results_height)
  assert(vim.api.nvim_win_get_height(picker.preview_win) >= 10, 'useful preview height')
  assert(picker.results_title == false, 'no column legend title')
  -- The selected row keeps its per-column groups underneath the selection.
  local row = lines[1]:find('Readable', 1, true) - 1
  local selected = groups_at(picker.results_bufnr, 0, row)
  assert(selected.TelescopeSelection and selected.NeovimTerminalReferenceFile, vim.inspect(selected))
  local loc = lines[1]:find('2:5', 1, true) - 1
  assert(groups_at(picker.results_bufnr, 0, loc).NeovimTerminalReferenceLocation, 'location color on selected row')
  local entry = picker:get_selection()
  assert(entry.filename:gsub('\\','/') == file:gsub('\\','/'))
  assert(entry.ordinal:find('Readable.ahk',1,true), 'full path searchable')
  require('telescope.actions').select_default(picker.prompt_bufnr)
  assert(vim.api.nvim_buf_get_name(0):gsub('\\','/') == file:gsub('\\','/'), 'jump file preserved')
  assert(vim.api.nvim_win_get_cursor(0)[1] == 2, 'jump line preserved')
  print(('PASS real Telescope references: width=%d results=%dx%d %s'):format(width, results_width, results_height, lines[1]))
end
vim.lsp.buf_request_all = original_request
vim.lsp.get_client_by_id = original_client
vim.fn.delete(root, 'rf')
vim.cmd('qa!')
