export function register(ctx) {
  const { React, components } = ctx.ui;
  const { Button, Card, Input, Label, TextField } = components;
  ctx.registerSettingsView(async () => {
    function ProviderView() {
      const [providers, setProviders] = React.useState([]);
      const [form, setForm] = React.useState({ name: '', base_url: 'https://api.openai.com/v1', model: '', api_key: '' });
      const refresh = React.useCallback(async () => { const result = await ctx.action('list'); setProviders(result.providers); }, []);
      React.useEffect(() => { void refresh(); }, [refresh]);
      const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
      const create = async (event) => { event.preventDefault(); await ctx.action('create', { ...form, enabled: true }); setForm({ name: '', base_url: 'https://api.openai.com/v1', model: '', api_key: '' }); await refresh(); };
      return React.createElement('div', { className: 'space-y-5' },
        React.createElement('div', { className: 'flex items-center justify-between gap-3' }, React.createElement('p', { className: 'text-sm text-muted' }, '模型连接由此插件管理，密钥仅保存在本机 Agent 数据目录。'), React.createElement('span', { className: 'text-xs text-muted' }, `${providers.length} 个连接`)),
        React.createElement(Card.Root, null, React.createElement(Card.Content, { className: 'space-y-4 p-5' },
          React.createElement('h2', { className: 'font-medium' }, '添加模型供应商'),
          React.createElement('form', { className: 'grid gap-4 sm:grid-cols-2', onSubmit: create },
            field(React, TextField, Input, Label, 'name', '供应商名称', form.name, (value) => update('name', value)), field(React, TextField, Input, Label, 'base_url', '接口地址', form.base_url, (value) => update('base_url', value)), field(React, TextField, Input, Label, 'model', '模型名称', form.model, (value) => update('model', value)), field(React, TextField, Input, Label, 'api_key', 'API 密钥', form.api_key, (value) => update('api_key', value), 'password'),
            React.createElement(Button, { type: 'submit', className: 'sm:col-span-2' }, '添加供应商')))),
        React.createElement('div', { className: 'space-y-3' }, providers.map((provider) => React.createElement(Card.Root, { key: provider.id }, React.createElement(Card.Content, { className: 'flex flex-wrap items-center justify-between gap-4 p-4' }, React.createElement('div', null, React.createElement('p', { className: 'font-medium' }, provider.name), React.createElement('p', { className: 'text-xs text-muted' }, `${provider.model || '未设置模型'} · ${provider.baseUrl}`)), React.createElement('div', { className: 'flex gap-2' }, React.createElement(Button, { size: 'sm', variant: 'secondary', isDisabled: provider.isDefault || !provider.enabled, onPress: async () => { await ctx.action('set-default', { id: provider.id }); await refresh(); } }, provider.isDefault ? '默认' : '设为默认'), React.createElement(Button, { size: 'sm', variant: 'secondary', onPress: async () => { await ctx.action('update', { id: provider.id, name: provider.name, base_url: provider.baseUrl, model: provider.model, is_default: provider.isDefault, enabled: !provider.enabled }); await refresh(); } }, provider.enabled ? '停止' : '启动'), React.createElement(Button, { size: 'sm', variant: 'danger', isDisabled: provider.isDefault, onPress: async () => { await ctx.action('delete', { id: provider.id }); await refresh(); } }, '删除'))))), providers.length ? null : React.createElement('p', { className: 'py-8 text-center text-sm text-muted' }, '尚未配置模型供应商。')));
    }
    return React.createElement(ProviderView);
  });
}
function field(React, TextField, Input, Label, key, title, value, onChange, type) { return React.createElement(TextField.Root, { key, value, onChange }, React.createElement(Label, null, title), React.createElement(Input, { type })); }
