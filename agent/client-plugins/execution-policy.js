export function register(ctx) {
  const { React, components } = ctx.ui;
  const { Button, Card, Input, Label, Switch, TextField } = components;
  ctx.registerSettingsView(async () => {
    const initial = await ctx.action('get');
    function PolicyView() {
      const [mode, setMode] = React.useState(initial.executionMode);
      const [caps, setCaps] = React.useState(initial.allowedCapabilities.join(', '));
      const save = async (event) => { event.preventDefault(); await ctx.action('update', { execution_mode: mode, allowed_capabilities: caps.split(',').map((item) => item.trim()).filter(Boolean) }); };
      return React.createElement('form', { className: 'space-y-5', onSubmit: save }, React.createElement(Card.Root, null, React.createElement(Card.Content, { className: 'space-y-4 p-5' }, React.createElement('h2', { className: 'font-medium' }, '批准方式'), ['request_approval', 'approve_high_risk', 'full_access'].map((item) => React.createElement(Switch, { key: item, isSelected: mode === item, onChange: () => setMode(item) }, React.createElement(Switch.Content, null, item === 'request_approval' ? '每次执行前请求批准' : item === 'approve_high_risk' ? '仅高风险操作请求批准' : '完全访问执行'), React.createElement(Switch.Control, null, React.createElement(Switch.Thumb, null))))), React.createElement(TextField.Root, { value: caps, onChange: setCaps }, React.createElement(Label, null, '允许能力（逗号分隔）'), React.createElement(Input, null)), React.createElement('div', { className: 'flex justify-end' }, React.createElement(Button, { type: 'submit' }, '保存执行策略')));
    }
    return React.createElement(PolicyView);
  });
}
