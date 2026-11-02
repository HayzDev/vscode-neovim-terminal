for key, target in pairs({ ['<S-Left>'] = '<Home>', ['<S-Right>'] = '<End>' }) do
  vim.keymap.set({ 'n', 'x', 'o', 'i', 'c' }, key, target, { remap = true })
end
for key, target in pairs({ ['<S-Up>'] = '<S-Tab>', ['<S-Down>'] = '<Tab>' }) do
  vim.keymap.set('x', key, target, { remap = true })
  vim.keymap.set('n', key, 'v' .. target, { remap = true })
end
