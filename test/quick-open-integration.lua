-- Run from extension root with nvim --clean --headless '+luafile test/quick-open-integration.lua'
vim.opt.rtp:append(vim.fn.stdpath('data') .. '/lazy/snacks.nvim')
require('snacks').setup({ picker = { enabled = true }, notifier = { enabled = false } })
vim.o.columns, vim.o.lines = 120, 40
local original_cwd = vim.fn.getcwd()
local root = vim.fn.tempname()
vim.fn.mkdir(root,'p')
local target = root .. '/instant-file.txt'
vim.fn.writefile({'test fixture'},target)
local started = vim.uv.hrtime()
assert(assert(loadfile('lua/quick-open.lua'))(root))
local picker
assert(vim.wait(5000,function()
  picker=require('snacks').picker.get()[1]
  return picker and picker:count() == 1
end,10), 'real Snacks files must list fixture')
local ready_ms = (vim.uv.hrtime()-started)/1e6
picker:action('confirm')
assert(vim.wait(5000,function() return vim.api.nvim_buf_get_name(0):gsub('\\','/')==target:gsub('\\','/') end,10),'confirm must open the file directly in Neovim')
print(string.format('PASS real Snacks direct file picker: ready %.1fms, selected file without a native editor',ready_ms))
vim.api.nvim_set_current_dir(original_cwd)
assert(vim.fn.delete(root,'rf') == 0)
vim.cmd('qa!')
