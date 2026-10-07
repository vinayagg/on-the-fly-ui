const $ = id => document.getElementById(id);
let workspace, selection, mounted, editingVersion, draft;
const clone = value => structuredClone(value);
const path = (action, id = '') => `/api/workspace/${action}/${id}`;
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
function notify(message, error = false) { $('notice').textContent = message; $('notice').className = error ? 'error' : 'success'; }
async function api(action, id = '', method = 'GET', data) {
  const response = await fetch(path(action, id), {method, headers: {'Content-Type': 'application/json', 'X-Workspace': '1'}, body: data === undefined ? undefined : JSON.stringify(data)});
  const result = await response.json();
  if (!response.ok || result.status) throw Error(result.message || result.msg || 'Request failed');
  return result.data;
}
const objectById = id => workspace.config.objects.find(object => object.id === id);
function formFor(object, editing) {
  const data = Object.fromEntries(object.fields.map(f => [f.id, '${' + f.id + '}']));
  return {type: 'form', title: '', initApi: editing ? path('record', '${id}') : undefined,
    api: {method: 'post', url: path('record', editing ? '${id}' : ''), data: {object: object.id, data}},
    body: object.fields.map(field => ({type: {text: 'input-text', number: 'input-number', date: 'input-date', boolean: 'switch', select: 'select'}[field.type],
      name: field.id, label: field.label, required: !!field.required, options: field.options, format: field.type === 'date' ? 'YYYY-MM-DD' : undefined,
      value: !editing && field.type === 'boolean' ? false : undefined, precision: field.type === 'number' ? 2 : undefined}))};
}
function table(queryId, object, fields) {
  const dialog = editing => ({label: editing ? 'Edit' : '+ Add record', type: 'button', actionType: 'dialog', level: editing ? 'link' : 'primary', dialog: {title: `${editing ? 'Edit' : 'New'} ${object.label}`, body: formFor(object, editing)}});
  return {type: 'crud', api: path('query', queryId), syncLocation: false, perPage: 10, keepItemSelectionOnPageChange: false,
    filter: {title: '', mode: 'inline', actions: [], body: [
      {type: 'input-text', name: 'search', placeholder: `Search ${object.label.toLowerCase()}…`, clearable: true},
      {type: 'submit', label: 'Search'}]},
    headerToolbar: [dialog(false), 'reload'], footerToolbar: ['statistics', 'pagination'],
    columns: [...fields.map(id => {const f = object.fields.find(field => field.id === id); return {name: id, label: f.label, type: 'text', sortable: true};}),
      {type: 'operation', label: '', width: 120, buttons: [dialog(true), {type: 'button', label: 'Delete', level: 'link', actionType: 'ajax', confirmText: 'Delete this record and its links?', api: {method: 'delete', url: path('record', '${id}')}}]}]};
}
function widgetSchema(widget) {
  const q = workspace.config.queries.find(query => query.id === widget.query), object = objectById(q.object);
  if (widget.type === 'table') return table(q.id, object, q.fields);
  if (widget.type === 'metric') return {type: 'service', api: path('query', q.id), body: {type: 'tpl', tpl: '<div class="metric-value">${value|number}</div><div class="metric-caption">${count} matching records</div>'}};
  return {type: 'chart', api: path('query', q.id), height: 260, config: {
    tooltip: {trigger: 'axis', renderMode: 'richText'}, grid: {left: 45, right: 18, top: 20, bottom: 35},
    xAxis: {type: 'category', data: '${items|pick:label}'}, yAxis: {type: 'value'},
    series: [{type: 'bar', data: '${items|pick:value}', barMaxWidth: 36, itemStyle: {color: '#476b55', borderRadius: [4, 4, 0, 0]}}]}};
}
function relationshipSchema(relation) {
  const picker = (name, object) => ({type: 'select', name, label: objectById(object).label, source: path('options', object), required: true});
  return {type: 'crud', api: path('links', relation.id), syncLocation: false,
    headerToolbar: [{type: 'button', label: '+ Link records', level: 'primary', actionType: 'dialog', dialog: {title: relation.label, body: {type: 'form', api: {method: 'post', url: path('links', relation.id)}, body: [picker('source', relation.from), picker('target', relation.to)]}}}, 'reload'],
    columns: [{name: 'sourceName', label: objectById(relation.from).label, type: 'text'}, {name: 'targetName', label: objectById(relation.to).label, type: 'text'}, {type: 'operation', label: '', buttons: [{type: 'button', label: 'Unlink', actionType: 'ajax', confirmText: 'Remove this link?', api: {method: 'delete', url: path('links', '${id}')}}]}]};
}
function render() {
  if (mounted) {mounted.unmount(); mounted = null;}
  $('canvas').replaceChildren();
  const config = workspace.config, screen = config.screens.find(s => selection === 'screen:' + s.id);
  const object = config.objects.find(o => selection === 'object:' + o.id), relation = config.relations.find(r => selection === 'relation:' + r.id);
  $('empty').hidden = !!(screen || object || relation); $('customize').hidden = !screen;
  $('page-title').textContent = screen?.title || object?.label || relation?.label || 'Start with an idea.';
  $('view-note').textContent = screen ? 'A saved view, with live data. Make it yours.' : object ? 'A virtual object. Add and edit records here.' : relation ? `${relation.cardinality} · ${relation.label}` : 'Your objects, queries and screens are saved as metadata.';
  if (!screen && !object && !relation) return;
  const widgets = screen ? screen.widgets.map(widget => ({type: 'container', className: `widget span-${widget.width}`, body: [{type: 'tpl', tpl: `<h2 class="widget-title">${escapeHTML(widget.title)}</h2>`}, widgetSchema(widget)]})) : [{type: 'container', className: 'widget span-12', body: object ? table('_object_' + object.id, object, object.fields.map(f => f.id)) : relationshipSchema(relation)}];
  mounted = amisRequire('amis/embed').embed('#canvas', {type: 'page', body: {type: 'container', className: 'widget-grid', body: widgets}}, {locale: 'en-US', theme: 'cxd'}, {
    fetcher: async ({url, method, data, config: options}) => {
      const target = new URL(url, location.origin);
      if (target.origin !== location.origin || !target.pathname.startsWith('/api/workspace/')) throw Error('Only workspace APIs are allowed');
      method = (method || 'get').toUpperCase();
      if (method === 'GET' && data) Object.entries(data).forEach(([key, value]) => {if (value !== undefined) target.searchParams.set(key, String(value));});
      const response = await fetch(target, {method, headers: {'Content-Type': 'application/json', 'X-Workspace': '1'}, body: method === 'GET' ? undefined : JSON.stringify(data)});
      const result = await response.json();
      return {status: response.status, headers: response.headers, data: response.ok ? result : {status: 1, msg: result.message || 'Request failed'}};
    }, notify: (type, message) => notify(message, type === 'error')
  });
}
async function reload() {
  workspace = await api('workspace');
  const c = workspace.config, entries = [...c.screens.map(s => ['screen:' + s.id, s.title, 'VIEWS']), ...c.objects.map(o => ['object:' + o.id, o.label, 'OBJECTS']), ...c.relations.map(r => ['relation:' + r.id, r.label, 'RELATIONSHIPS'])];
  if (!entries.some(([id]) => id === selection)) selection = entries[0]?.[0];
  $('workspace-name').textContent = c.title; $('revision').textContent = 'v' + workspace.version;
  $('model-status').textContent = workspace.modelReady ? 'Model connected' : 'Model not configured';
  $('proof').textContent = `${workspace.modelCalls} model call${workspace.modelCalls === 1 ? '' : 's'} since server start`;
  $('navigation').replaceChildren(); let group;
  entries.forEach(([id, label, section]) => {
    if (group !== section) {const heading = document.createElement('div');
      heading.className = 'nav-heading';
      heading.textContent = section;
      $('navigation').append(heading);
      group = section;}
    const button = document.createElement('button'); button.textContent = label; button.className = id === selection ? 'selected' : '';
    button.onclick = () => {selection = id; reload().catch(error => notify(error.message, true));}; $('navigation').append(button);
  });
  render();
}
function openEditor(config, version) {
  editingVersion = version; $('metadata').value = JSON.stringify(config, null, 2); $('editor-error').textContent = '';
  $('history').replaceChildren(new Option('Current / proposed metadata', ''));
  workspace.revisions.forEach(r => $('history').add(new Option(`v${r.version} · ${r.label}`, r.version)));
  $('editor').showModal();
}
$('edit').onclick = () => openEditor(workspace.config, workspace.version);
$('history').onchange = async () => {try {if ($('history').value) $('metadata').value = JSON.stringify(await api('revision', $('history').value), null, 2);} catch (e) {$('editor-error').textContent = e.message;}};
$('save').onclick = async () => {
  try {await api('workspace', '', 'POST', {config: JSON.parse($('metadata').value), version: editingVersion});
    $('editor').close();
    await reload();
    notify('Saved. This version runs without AI.');}
  catch (error) {$('editor-error').textContent = error.message;}
};
$('prompt-form').onsubmit = async event => {
  event.preventDefault(); $('build').disabled = true; $('build').textContent = 'Building…'; notify('Creating metadata. Existing views keep working.');
  try {
    const result = await api('generate', '', 'POST', {prompt: $('prompt').value});
    await api('workspace', '', 'POST', {config: result.config, version: result.version, label: $('prompt').value});
    const added = result.config.screens.find(s => !workspace.config.screens.some(old => old.id === s.id));
    if (added) selection = 'screen:' + added.id;
    await reload(); notify('Built and saved. This app now runs without AI.');
  }
  catch (error) {notify(error.message, true); await reload();}
  finally {$('build').disabled = false; $('build').textContent = 'Build with AI ↗';}
};
document.querySelectorAll('[data-prompt]').forEach(button => {button.onclick = () => {$('prompt').value = button.dataset.prompt; $('prompt').focus();};});
$('example').onclick = async () => {try {await api('example', '', 'POST', {});
  await reload();
  notify('Sales example loaded from metadata. Zero model calls.');} catch (error) {notify(error.message, true);}};
$('refresh').onclick = () => reload().catch(error => notify(error.message, true));
$('customize').onclick = () => {
  draft = clone(workspace.config); editingVersion = workspace.version; $('layout-error').textContent = '';
  drawLayout(); $('layout').showModal();
};
function drawLayout() {
  const screen = draft.screens.find(s => selection === 'screen:' + s.id); $('layout-controls').replaceChildren();
  screen.widgets.forEach((widget, index) => {
    const box = document.createElement('div'); box.className = 'layout-row';
    const title = document.createElement('strong'); title.textContent = widget.title; box.append(title);
    const width = document.createElement('select'); width.setAttribute('aria-label', 'Width of ' + widget.title);
    [3, 4, 6, 8, 12].forEach(n => width.add(new Option(`${n}/12 width`, n))); width.value = widget.width;
    width.onchange = () => {widget.width = Number(width.value);}; box.append(width);
    const up = document.createElement('button'); up.textContent = '↑'; up.setAttribute('aria-label', 'Move ' + widget.title + ' up'); up.disabled = index === 0;
    up.onclick = () => {[screen.widgets[index - 1], screen.widgets[index]] = [screen.widgets[index], screen.widgets[index - 1]]; drawLayout();}; box.append(up);
    const label = document.createElement('label'); label.textContent = 'Query: fields, filters, sort and aggregation';
    const query = draft.queries.find(q => q.id === widget.query), editor = document.createElement('textarea'); editor.value = JSON.stringify(query, null, 2); editor.rows = 7;
    editor.oninput = () => {try {const value = JSON.parse(editor.value);
      if (value.id !== query.id) throw Error('Keep the query ID unchanged');
      Object.keys(query).forEach(key => delete query[key]);
      Object.assign(query, value);
      editor.setCustomValidity('');} catch (e) {editor.setCustomValidity(e.message);}};
    label.append(editor); box.append(label); $('layout-controls').append(box);
  });
}
$('save-layout').onclick = async () => {
  if (![...$('layout-controls').querySelectorAll('textarea')].every(input => input.reportValidity())) return;
  try {await api('workspace', '', 'POST', {config: draft, version: editingVersion, label: 'Layout and query customization'});
    $('layout').close();
    await reload();
    notify('View updated. No model call.');}
  catch (error) {$('layout-error').textContent = error.message;}
};
reload().catch(error => notify(error.message, true));
