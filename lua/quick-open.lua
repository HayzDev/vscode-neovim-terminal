-- Stay in Neovim instead of opening a native editor and redirecting it later.
local cwd = ...
if type(cwd) ~= 'string' or cwd == '' then cwd = vim.g.neovim_terminal_workspace end
assert(type(cwd) == 'string' and vim.fn.isdirectory(cwd) == 1, 'The VS Code workspace directory is unavailable')
-- Restored sessions or directory-changing plugins must not make workspace
-- search silently scan the home folder instead.
vim.api.nvim_set_current_dir(cwd)
vim.g.neovim_terminal_workspace = cwd
vim.g.neovim_terminal_picker_root = cwd
local ok, snacks = pcall(require, 'snacks')
if ok and snacks.picker and snacks.picker.files then
  snacks.picker.files({ cwd = cwd })
  return true
end
local has_telescope, telescope = pcall(require, 'telescope.builtin')
if has_telescope then
  telescope.find_files({ cwd = cwd })
  return true
end
return false
