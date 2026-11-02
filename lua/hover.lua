local timer, generation, hover_win = nil, 0, nil
local function close()
  if hover_win and vim.api.nvim_win_is_valid(hover_win) then vim.api.nvim_win_close(hover_win, true) end
  hover_win = nil
end
local function show(mouse, token)
  if token ~= generation or not vim.api.nvim_win_is_valid(mouse.winid) then return end
  local buf = vim.api.nvim_win_get_buf(mouse.winid)
  local line = vim.api.nvim_buf_get_lines(buf, mouse.line - 1, mouse.line, false)[1] or ''
  local col = math.min(math.max(0, mouse.column - 1), #line)
  local clients = vim.lsp.get_clients({ bufnr = buf, method = 'textDocument/hover' })
  for _, client in ipairs(clients) do
    local character = vim.str_utfindex(line, client.offset_encoding or 'utf-16', col, false)
    local params = { textDocument = { uri = vim.uri_from_bufnr(buf) }, position = { line = mouse.line - 1, character = character } }
    client:request('textDocument/hover', params, function(err, result)
      if err or not result or not result.contents or token ~= generation then return end
      local lines = vim.lsp.util.convert_input_to_markdown_lines(result.contents)
      if #lines == 0 then return end
      close()
      local buffer = vim.api.nvim_create_buf(false, true)
      vim.api.nvim_buf_set_lines(buffer, 0, -1, false, lines)
      vim.bo[buffer].filetype = 'markdown'
      hover_win = vim.api.nvim_open_win(buffer, false, {
        relative = 'editor', row = math.min(mouse.screenrow, vim.o.lines - 4),
        col = math.max(0, math.min(mouse.screencol - 1, vim.o.columns - 45)),
        width = math.max(1, math.min(70, vim.o.columns - 4)), height = math.max(1, math.min(#lines, 12)),
        border = 'rounded', style = 'minimal', focusable = false,
      })
      vim.bo[buffer].bufhidden = 'wipe'
    end, buf)
    break
  end
end
local function moved()
  generation = generation + 1
  local token = generation
  if timer then timer:stop(); timer:close(); timer = nil end
  local mouse = vim.fn.getmousepos()
  if hover_win and mouse.winid == hover_win then return end
  close()
  if mouse.winid == 0 or mouse.line == 0 or mouse.column == 0 then return end
  local handle = vim.uv.new_timer()
  timer = handle
  handle:start(400, 0, vim.schedule_wrap(function()
    if not handle:is_closing() then handle:close() end
    if timer == handle then timer = nil end
    show(mouse, token)
  end))
end
vim.o.mouse = 'a'
vim.o.mousemoveevent = true
vim.keymap.set({ 'n', 'x', 'i' }, '<MouseMove>', moved)
vim.api.nvim_create_autocmd({ 'CursorMoved', 'CursorMovedI', 'InsertEnter', 'BufLeave', 'WinScrolled' }, {
  group = vim.api.nvim_create_augroup('NeovimTerminalHover', { clear = true }),
  callback = function() generation = generation + 1; close() end,
})
vim.api.nvim_create_user_command('NeovimTerminalHover', function()
  generation = generation + 1
  local cursor = vim.api.nvim_win_get_cursor(0)
  local position = vim.fn.screenpos(0, cursor[1], cursor[2] + 1)
  show({ winid = vim.api.nvim_get_current_win(), line = cursor[1], column = cursor[2] + 1,
    screenrow = position.row, screencol = position.col }, generation)
end, { force = true })
