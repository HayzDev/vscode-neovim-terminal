-- A workspace backend has one shared screen. A surviving terminal from an
-- extension-host restart must not constrain a replacement to its smaller size.
local group = vim.api.nvim_create_augroup('NeovimTerminalSingleUI', { clear = true })
local latest
local function keep_latest()
  for _, ui in ipairs(vim.api.nvim_list_uis()) do
    if ui.chan ~= latest then
      -- Disconnect only the obsolete frontend; retain backend/buffers/RPC.
      vim.fn.chanclose(ui.chan)
    end
  end
end
vim.api.nvim_create_autocmd('UIEnter', {
  group = group,
  callback = function()
    latest = vim.v.event.chan
    -- UI attachment must finish before closing the previous channel.
    vim.schedule(keep_latest)
  end,
})
local uis = vim.api.nvim_list_uis()
if #uis > 0 then
  latest = uis[#uis].chan
  keep_latest()
end
