export function register(ctx) {
  ctx.registerSettingsView(async (root) => {
    const policy = await ctx.action('get');
    root.innerHTML = `<form class="space-y-5"><fieldset><legend class="text-sm font-medium">批准方式</legend><div class="mt-3 space-y-3 text-sm"><label class="flex gap-3"><input type="radio" name="mode" value="request_approval" ${policy.executionMode === 'request_approval' ? 'checked' : ''}>每次执行前请求批准</label><label class="flex gap-3"><input type="radio" name="mode" value="approve_high_risk" ${policy.executionMode === 'approve_high_risk' ? 'checked' : ''}>仅高风险操作请求批准</label><label class="flex gap-3"><input type="radio" name="mode" value="full_access" ${policy.executionMode === 'full_access' ? 'checked' : ''}>完全访问执行</label></div></fieldset><label class="block text-sm font-medium">允许能力<textarea name="caps" class="mt-2 min-h-24 w-full rounded-md border border-border bg-surface p-3 text-sm">${policy.allowedCapabilities.join(', ')}</textarea></label><div class="flex justify-end"><button class="rounded-md bg-accent px-3 py-2 text-sm text-white">保存执行策略</button></div></form>`;
    root.querySelector('form').onsubmit = async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); await ctx.action('update', { execution_mode: form.get('mode'), allowed_capabilities: String(form.get('caps')).split(',').map((item) => item.trim()).filter(Boolean) }); };
    return () => { root.innerHTML = ''; };
  });
}
