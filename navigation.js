// Keep the warm file-opening path to one RPC round trip, including cursor
// placement. Never reload an existing buffer: it may contain unsaved edits.
async function switchFile(client, filename, position) {
  return client.request('nvim_exec_lua', [`
    local file, position = ...
    if vim.api.nvim_win_get_config(0).relative ~= '' then
      for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
        if vim.api.nvim_win_get_config(win).relative == '' then
          vim.api.nvim_set_current_win(win)
          break
        end
      end
    end
    local buf = vim.fn.bufadd(file)
    vim.fn.bufload(buf)
    if vim.api.nvim_get_current_buf() ~= buf then vim.api.nvim_set_current_buf(buf) end
    if position then
      local row = math.max(1, math.min(position.line + 1, vim.api.nvim_buf_line_count(buf)))
      local text = vim.api.nvim_buf_get_lines(buf, row - 1, row, false)[1] or ''
      vim.api.nvim_win_set_cursor(0, {row, math.min(position.byteColumn, #text)})
    end
    return {buf=buf, path=vim.api.nvim_buf_get_name(buf), buftype=vim.bo[buf].buftype,
      filetype=vim.bo[buf].filetype, modified=vim.bo[buf].modified, cursor=vim.api.nvim_win_get_cursor(0)}
  `, [filename, position || false]]);
}

module.exports = { switchFile };
