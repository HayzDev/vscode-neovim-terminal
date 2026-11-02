local channel = ...
local attached, pending = {}, {}
vim.g.neovim_terminal_generation = (vim.g.neovim_terminal_generation or 0) + 1
local generation = vim.g.neovim_terminal_generation
local function send(method, value) pcall(vim.rpcnotify, channel, method, value) end
local function info(buf)
  local cursor = buf == vim.api.nvim_get_current_buf() and vim.api.nvim_win_get_cursor(0)
    or vim.api.nvim_buf_get_mark(buf, '"')
  if cursor[1] == 0 then cursor = { (vim.fn.getbufinfo(buf)[1] or {}).lnum or 1, 0 } end
  return { buf = buf, path = vim.api.nvim_buf_get_name(buf), buftype = vim.bo[buf].buftype,
    filetype = vim.bo[buf].filetype, modified = vim.bo[buf].modified, cursor = cursor }
end
local function snapshot(buf)
  if not vim.api.nvim_buf_is_valid(buf) or not vim.api.nvim_buf_is_loaded(buf) then return end
  local value = info(buf)
  if value.buftype ~= '' then return end
  local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
  local separator = vim.bo[buf].fileformat == 'dos' and '\r\n' or '\n'
  value.fileformat = vim.bo[buf].fileformat
  value.text = table.concat(lines, separator) .. (vim.bo[buf].endofline and separator or '')
  if #lines == 1 and lines[1] == '' and vim.api.nvim_buf_call(buf, function() return vim.fn.wordcount().bytes end) == 0 then
    value.text = ''
  end
  send('neovim_terminal.buffer', value)
end
local function queue(buf)
  if pending[buf] then return end
  pending[buf] = true
  vim.schedule(function() pending[buf] = nil; snapshot(buf) end)
end
local function attach(buf)
  if attached[buf] or vim.bo[buf].buftype ~= '' then return end
  attached[buf] = true
  vim.api.nvim_buf_attach(buf, false, {
    on_lines = function()
      if generation ~= vim.g.neovim_terminal_generation then return true end
      queue(buf)
    end,
    on_detach = function() attached[buf] = nil end,
  })
end
local function report()
  local buf = vim.api.nvim_get_current_buf()
  attach(buf)
  send('neovim_terminal.file', info(buf))
  queue(buf)
end
vim.o.hidden = true
vim.o.title = true
vim.o.titlestring = 'nvim: %t%m'
vim.api.nvim_create_autocmd({ 'BufEnter', 'WinEnter', 'BufFilePost', 'BufWritePost', 'BufModifiedSet', 'FileType' }, {
  group = vim.api.nvim_create_augroup('NeovimTerminalCurrentFile', { clear = true }), callback = report,
})
vim.api.nvim_create_autocmd({ 'CursorMoved', 'CursorMovedI' }, {
  group = 'NeovimTerminalCurrentFile',
  callback = function() send('neovim_terminal.file', info(vim.api.nvim_get_current_buf())) end,
})
_G.neovim_terminal_snapshot = function()
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(buf) then attach(buf); snapshot(buf) end
  end
end
_G.neovim_terminal_snapshot()
report()
