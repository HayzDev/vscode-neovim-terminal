-- Optional Telescope integration. No dependency is installed or keymap replaced.
local enabled = ...
if enabled == false then return end
local ok, config = pcall(require, 'telescope.config')
if not ok then return end
local make_entry = require('telescope.make_entry')
local display = require('telescope.pickers.entry_display').create({
  separator = '  ',
  items = { { width = 0.24 }, { width = 9 }, { width = 0.20 }, { remaining = true } },
})
local base_entry = make_entry.gen_from_quickfix({})
local function entry_maker(item)
  local entry = base_entry(item)
  if not entry then return end
  -- Keep the original entry's full filename, ordinal and LSP range for search,
  -- preview, quickfix export and precise jumps; shorten only the visible path.
  entry.display = function(value)
    local filename = value.filename:gsub('\\', '/')
    local basename = filename:match('([^/]+)$') or filename
    local directory = vim.fn.fnamemodify(filename, ':h:~:.')
    directory = vim.fn.pathshorten(directory)
    local text = vim.trim(value.text or ''):gsub('[\r\n\t]', ' ')
    return display({
      { basename, 'NeovimTerminalReferenceFile' },
      { string.format('%d:%d', value.lnum or 1, value.col or 1), 'NeovimTerminalReferenceLocation' },
      { directory, 'NeovimTerminalReferencePath' },
      text,
    })
  end
  return entry
end
config.pickers.lsp_references = vim.tbl_deep_extend('keep', config.pickers.lsp_references or {}, {
  entry_maker = entry_maker,
  sorting_strategy = 'ascending',
  layout_strategy = 'flex',
  layout_config = {
    width = 0.94, height = 0.85,
    flex = { flip_columns = 140, flip_lines = 35 },
    horizontal = { prompt_position = 'top', preview_width = 0.45 },
    vertical = { prompt_position = 'top', preview_height = 0.40, mirror = true },
  },
  results_title = 'References  |  File / Line:Col / Folder / Code',
  preview_title = 'Reference Preview',
})
