export function register(ctx) {
  ctx.registerSettingsView(async (root) => {
    root.innerHTML = `<div class="space-y-4"><div class="flex items-center justify-between gap-3"><p class="text-sm text-muted">模型连接由此插件管理，密钥仅保存在本机 Agent 数据目录。</p><button data-add class="rounded-md bg-accent px-3 py-2 text-sm text-white">添加供应商</button></div><div data-list class="space-y-3"></div></div>`;
    const list = root.querySelector('[data-list]');
    async function render() {
      const { providers } = await ctx.action('list');
      list.innerHTML = providers.length ? providers.map((p) => `<section class="rounded-md border border-border p-4"><div class="flex flex-wrap items-center justify-between gap-3"><div><strong>${escapeHtml(p.name)}</strong><p class="mt-1 text-xs text-muted">${escapeHtml(p.model || '未设置模型')} · ${escapeHtml(p.baseUrl)}</p></div><div class="flex gap-2"><button data-default="${p.id}" class="rounded border border-border px-2 py-1 text-xs" ${p.isDefault || !p.enabled ? 'disabled' : ''}>${p.isDefault ? '默认' : '设为默认'}</button><button data-toggle="${p.id}" class="rounded border border-border px-2 py-1 text-xs">${p.enabled ? '停止' : '启动'}</button><button data-delete="${p.id}" class="rounded border border-danger px-2 py-1 text-xs text-danger" ${p.isDefault ? 'disabled' : ''}>删除</button></div></div></section>`).join('') : '<p class="text-sm text-muted">尚未配置模型供应商。</p>';
      list.querySelectorAll('[data-default]').forEach((button) => button.onclick = async () => { await ctx.action('set-default', { id: button.dataset.default }); await render(); });
      list.querySelectorAll('[data-toggle]').forEach((button) => { const p = providers.find((item) => item.id === button.dataset.toggle); button.onclick = async () => { await ctx.action('update', { ...p, id: p.id, base_url: p.baseUrl, is_default: p.isDefault, api_key: undefined, enabled: !p.enabled }); await render(); }; });
      list.querySelectorAll('[data-delete]').forEach((button) => button.onclick = async () => { await ctx.action('delete', { id: button.dataset.delete }); await render(); });
    }
    root.querySelector('[data-add]').onclick = async () => {
      const name = prompt('供应商名称'); if (!name) return;
      const base_url = prompt('接口地址', 'https://api.openai.com/v1'); if (!base_url) return;
      const model = prompt('模型名称'); if (!model) return;
      const api_key = prompt('API 密钥'); if (!api_key) return;
      await ctx.action('create', { name, base_url, model, api_key, enabled: true }); await render();
    };
    await render();
    return () => { root.innerHTML = ''; };
  });
}
function escapeHtml(value) { const node = document.createElement('span'); node.textContent = String(value); return node.innerHTML; }
