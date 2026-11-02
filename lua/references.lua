-- Optional Telescope integration. No dependency is installed or keymap replaced.
local enabled = ...
if enabled == false then return end
local ok, config = pcall(require, 'telescope.config')
if not ok then return end
local make_entry = require('telescope.make_entry')
local entry_display = require('telescope.pickers.entry_display')
local state = require('telescope.state')

local function normalize(path) return vim.fs.normalize(path):gsub('/$', '') end
local function under(path, root)
  local a, b = path, root
  if vim.fn.has('win32') == 1 then a, b = a:lower(), b:lower() end
  return b ~= '' and (a == b or a:sub(1, #b + 1) == b .. '/')
end

-- Readable folder: workspace-relative or ~-relative, trimmed from the left by
-- whole segments so the most specific folders stay visible.
local function folder(filename, width)
  local home, cwd = normalize(vim.uv.os_homedir() or ''), normalize(vim.fn.getcwd())
  local dir = normalize(vim.fs.dirname(normalize(filename)))
  if under(dir, cwd) then dir = dir == cwd and '.' or dir:sub(#cwd + 2)
  elseif under(dir, home) then dir = '~' .. dir:sub(#home + 1) end
  if vim.fn.strdisplaywidth(dir) <= width then return dir end
  local parts, out = vim.split(dir, '/', { plain = true }), nil
  for i = #parts, 1, -1 do
    local candidate = '…/' .. table.concat(parts, '/', i)
    if vim.fn.strdisplaywidth(candidate) > width then break end
    out = candidate
  end
  return out or parts[#parts]
end

-- entry_display caches column widths on first use, so one module-level
-- displayer would keep the first picker's widths forever. Build per width.
local displayers = {}
local function layout()
  local status = state.get_status(vim.api.nvim_get_current_buf())
  local win = status and status.layout and status.layout.results and status.layout.results.winid
  local width = (win and vim.api.nvim_win_is_valid(win)) and vim.api.nvim_win_get_width(win) - #status.picker.selection_caret or 120
  if not displayers[width] then
    local file_w = math.max(14, math.min(32, math.floor(width * 0.22)))
    local folder_w = width >= 70 and math.max(12, math.min(40, math.floor(width * 0.22))) or 0
    local items = { { width = file_w }, { width = 8 } }
    if folder_w > 0 then items[#items + 1] = { width = folder_w } end
    items[#items + 1] = { remaining = true }
    displayers[width] = { folder = folder_w, display = entry_display.create({ separator = '  ', items = items }) }
  end
  return displayers[width]
end

local base_entry = make_entry.gen_from_quickfix({})
local function entry_maker(item)
  local entry = base_entry(item)
  if not entry then return end
  -- Keep the original entry's full filename, ordinal and LSP range for search,
  -- preview, quickfix export and precise jumps; shorten only the visible path.
  entry.display = function(value)
    local columns = layout()
    local filename = normalize(value.filename)
    local fields = {
      { vim.fs.basename(filename), 'NeovimTerminalReferenceFile' },
      { string.format('%d:%d', value.lnum or 1, value.col or 1), 'NeovimTerminalReferenceLocation' },
    }
    if columns.folder > 0 then
      fields[#fields + 1] = { folder(filename, columns.folder), 'NeovimTerminalReferencePath' }
    end
    fields[#fields + 1] = vim.trim((value.text or ''):gsub('[\r\n\t]', ' '))
    return columns.display(fields)
  end
  return entry
end

-- Size the window to the result count instead of padding one hit with a
-- screenful of empty rows; keep enough height for a useful preview.
local function result_count(picker)
  local results = picker and picker.finder and picker.finder.results
  return type(results) == 'table' and #results or math.huge
end
config.pickers.lsp_references = vim.tbl_deep_extend('keep', config.pickers.lsp_references or {}, {
  entry_maker = entry_maker,
  sorting_strategy = 'ascending',
  layout_strategy = 'flex',
  results_title = false,
  preview_title = 'Preview',
  layout_config = {
    width = 0.94,
    flex = { flip_columns = 140, flip_lines = 35 },
    horizontal = {
      prompt_position = 'top', preview_width = 0.5,
      height = function(picker, _, lines)
        return math.min(math.floor(lines * 0.85), math.max(18, result_count(picker) + 6))
      end,
    },
    vertical = {
      prompt_position = 'top', mirror = true, height = 0.85,
      -- Results get only the rows they need (up to 40%); preview takes the rest.
      preview_height = function(picker, _, height)
        local rows = math.max(3, math.min(result_count(picker), math.floor(height * 0.4)))
        return math.max(math.floor(height * 0.5), height - rows - 7)
      end,
    },
  },
})
