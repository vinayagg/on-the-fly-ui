const schema = JSON.parse(toString($os.readFile(__hooks + '/../schema/workspace.json')));
const Ajv = require('ajv');
const copy = value => JSON.parse(JSON.stringify(value));
const body = record => JSON.parse(record.getString('body'));
const fail = message => {throw new BadRequestError(message);};
const insist = (condition, message) => {if (!condition) fail(message);};
const find = (items, id) => items.find(item => item.id === id) || fail('Unknown reference: ' + id);
const all = (app, table) => Array.from(app.findAllRecords(table));
const row = record => Object.assign(JSON.parse(record.getString('data')), {id: record.id});
const active = app => all(app, 'definitions')[0];
const records = (app, object) => Array.from(app.findRecordsByFilter('records', 'object = {:o}', '', 0, 0, {o: object}));
function insert(app, table, values) {
  const record = new Record(app.findCollectionByNameOrId(table));
  Object.keys(values).forEach(key => record.set(key, values[key]));
  app.save(record);
  return record;
}
function shape(config) {
  const validator = new Ajv({allErrors: true, strict: false});
  const valid = validator.validate(schema, config);
  insist(valid, validator.errorsText(validator.errors).slice(0, 1500));
  function unique(items) {insist(new Set(items.map(item => item.id)).size === items.length, 'Duplicate ID');}
  [config.objects, config.relations, config.queries, config.screens].forEach(unique);
  config.objects.forEach(object => {
    unique(object.fields);
    object.fields.forEach(field => insist(field.type !== 'select' || field.options, 'Select fields need options'));
  });
  config.relations.forEach(relation => {find(config.objects, relation.from); find(config.objects, relation.to);});
  config.queries.forEach(query => {
    const object = find(config.objects, query.object);
    const field = id => find(object.fields, id);
    query.fields.forEach(field);
    if (query.sort) {field(query.sort); insist(query.fields.includes(query.sort), 'Include the sort field in query fields');}
    if (query.groupBy) {field(query.groupBy); insist(query.aggregate !== 'rows', 'Grouping needs an aggregate');}
    if (query.aggregate === 'sum') insist(field(query.measure).type === 'number', 'Sum needs a numeric measure');
    query.filters.forEach(filter => {
      const type = field(filter.field).type;
      if (filter.op === 'last_days') insist(type === 'date' && Number.isInteger(filter.value) && filter.value > 0 && filter.value <= 36500, 'last_days needs a date and positive day count');
      else if (filter.op === 'contains') insist(type === 'text' && typeof filter.value === 'string', 'contains needs text');
      else {validateValue(field(filter.field), filter.value);
        if (['gte', 'lte'].includes(filter.op)) insist(['number', 'date'].includes(type), 'Range filters need numbers or dates');}
    });
    if (query.related) {
      const relation = find(config.relations, query.related.relation);
      insist([relation.from, relation.to].includes(query.object), 'Relation must connect the queried object');
    }
  });
  config.screens.forEach(screen => screen.widgets.forEach(widget => {
    const query = find(config.queries, widget.query);
    insist(widget.type === 'table' ? query.aggregate === 'rows' : query.aggregate !== 'rows', 'Widget and query are incompatible');
    insist(widget.type === 'bar' ? !!query.groupBy : !query.groupBy, 'Bar charts need grouping; other widgets cannot group');
  }));
}
function validateValue(field, value) {
  const empty = value === undefined || value === null || value === '';
  insist(!field.required || !empty, field.label + ' is required');
  if (empty) return;
  const types = {text: 'string', date: 'string', select: 'string', number: 'number', boolean: 'boolean'};
  insist(typeof value === types[field.type], field.label + ' has the wrong type');
  if (typeof value === 'string') insist(value.length <= 4000, field.label + ' is too long');
  if (field.type === 'number') insist(Number.isFinite(value), 'Number must be finite');
  if (field.type === 'date') insist(/^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, 'Use a valid YYYY-MM-DD date');
  if (field.type === 'select') insist(field.options.includes(value), 'Unknown option for ' + field.label);
}
function validateRecord(app, config, objectId, data, id) {
  const object = find(config.objects, objectId);
  insist(data && typeof data === 'object' && !Array.isArray(data), 'Record must be an object');
  Object.keys(data).forEach(key => find(object.fields, key));
  object.fields.forEach(field => {
    validateValue(field, data[field.id]);
    if (field.unique && data[field.id] !== undefined && data[field.id] !== null && data[field.id] !== '')
      insist(!records(app, objectId).some(r => r.id !== id && row(r)[field.id] === data[field.id]), field.label + ' must be unique');
  });
}
function validateLink(app, config, relationId, source, target, id) {
  const relation = find(config.relations, relationId);
  const from = app.findRecordById('records', source), to = app.findRecordById('records', target);
  insist(from.getString('object') === relation.from && to.getString('object') === relation.to, 'Wrong relationship endpoints');
  all(app, 'links').filter(link => link.id !== id && link.getString('relation') === relationId).forEach(link => {
    insist(link.getString('source') !== source || link.getString('target') !== target, 'This link already exists');
    insist(relation.cardinality !== 'one-to-many' || link.getString('target') !== target, 'This record already has a parent');
  });
}
function compatible(app, config) {
  shape(config);
  all(app, 'records').forEach(record => validateRecord(app, config, record.getString('object'), JSON.parse(record.getString('data')), record.id));
  all(app, 'links').forEach(link => validateLink(app, config, link.getString('relation'), link.getString('source'), link.getString('target'), link.id));
  config.queries.filter(q => q.related).forEach(q => {
    const relation = find(config.relations, q.related.relation);
    const other = relation.from === q.object ? relation.to : relation.from;
    insist(app.findRecordById('records', q.related.record).getString('object') === other, 'Related record has the wrong object type');
  });
}
function save(app, config, version, label) {
  const current = active(app);
  if (version !== current.getInt('version')) throw new ApiError(409, 'Workspace changed. Reload before saving.');
  compatible(app, config);
  const next = version + 1;
  insert(app, 'revisions', {body: config, version: next, label: String(label || 'Metadata edit').slice(0, 150)});
  current.set('body', config); current.set('version', next); app.save(current);
  return {config, version: next};
}
function query(app, config, queryId, params) {
  const spec = queryId.startsWith('_object_') ? {object: queryId.slice(8), filters: [], aggregate: 'rows'} : find(config.queries, queryId);
  const object = find(config.objects, spec.object), fields = spec.fields || object.fields.map(f => f.id);
  // ponytail: scan at most 5,000 records per object; push predicates into indexed SQLite for larger datasets.
  let items = records(app, object.id).map(row);
  insist(items.length <= 5000, 'Demo limit: 5,000 records per object');
  if (spec.related) {
    const relation = find(config.relations, spec.related.relation), outgoing = relation.from === object.id;
    const ids = all(app, 'links').filter(l => l.getString('relation') === relation.id && l.getString(outgoing ? 'target' : 'source') === spec.related.record).map(l => l.getString(outgoing ? 'source' : 'target'));
    items = items.filter(item => ids.includes(item.id));
  }
  items = items.filter(item => spec.filters.every(f => {
    const value = item[f.field], expected = f.value;
    if (f.op === 'eq') return value === expected;
    if (f.op === 'ne') return value !== expected;
    if (value === undefined || value === null || value === '') return false;
    if (f.op === 'contains') return String(value).toLowerCase().includes(expected.toLowerCase());
    if (f.op === 'gte') return value >= expected;
    if (f.op === 'lte') return value <= expected;
    const today = new Date().toISOString().slice(0, 10), start = new Date();
    start.setUTCDate(start.getUTCDate() - expected + 1);
    return value >= start.toISOString().slice(0, 10) && value <= today;
  }));
  if (spec.aggregate !== 'rows') {
    const total = list => spec.aggregate === 'count' ? list.length : list.reduce((sum, item) => sum + (item[spec.measure] || 0), 0);
    if (!spec.groupBy) return {value: total(items), count: items.length};
    const groups = Array.from(new Set(items.map(item => item[spec.groupBy] == null ? '(empty)' : String(item[spec.groupBy]))));
    return {items: groups.map(label => ({label, value: total(items.filter(item => String(item[spec.groupBy] == null ? '(empty)' : item[spec.groupBy]) === label))}))};
  }
  if (params.search) items = items.filter(item => fields.some(f => String(item[f] ?? '').toLowerCase().includes(String(params.search).toLowerCase())));
  const sort = params.orderBy || spec.sort;
  if (sort) {
    insist(fields.includes(sort), 'Cannot sort by a hidden field');
    const desc = params.orderDir ? params.orderDir === 'desc' : spec.descending;
    items.sort((a, b) => (a[sort] < b[sort] ? -1 : a[sort] > b[sort] ? 1 : 0) * (desc ? -1 : 1));
  }
  const page = Math.max(1, parseInt(params.page, 10) || 1), size = Math.min(100, Math.max(1, parseInt(params.perPage, 10) || 10));
  return {total: items.length, items: items.slice((page - 1) * size, page * size).map(item => {
    const projected = {id: item.id}; fields.forEach(field => {projected[field] = item[field];}); return projected;
  })};
}
function generate(app, prompt, config) {
  insist(typeof prompt === 'string' && prompt.trim() && prompt.length <= 4000, 'Enter a prompt (up to 4,000 characters)');
  const base = $os.getenv('LLM_BASE_URL'), model = $os.getenv('LLM_MODEL');
  insist(base && model, 'Configure LLM_BASE_URL and LLM_MODEL in .env, then restart. You can load the example or edit metadata now.');
  app.store().set('modelCalls', (app.store().get('modelCalls') || 0) + 1);
  const response = $http.send({url: base.replace(/\/$/, '') + '/chat/completions', method: 'POST', timeout: 90,
    headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + ($os.getenv('LLM_API_KEY') || 'local')},
    body: JSON.stringify({model, messages: [
      {role: 'system', content: 'Return only a JSON workspace matching this JSON Schema: ' + JSON.stringify(schema) + '\nPreserve existing objects, stable IDs, fields, relations, queries and screens unless the user asks to change them. Add requested capabilities. Never output code, SQL, HTML, URLs or sample records. Use existing widgets only. Recent means last 30 calendar days including today. Monetary values use numbers. For table queries include the sort field in fields. For bar charts group an aggregate query. Current workspace: ' + JSON.stringify(config)},
      {role: 'user', content: prompt}
    ]})});
  if (response.statusCode !== 200) throw new ApiError(502, 'Model provider returned HTTP ' + response.statusCode + '. Check server configuration.');
  let candidate;
  try {candidate = JSON.parse(response.json.choices[0].message.content.replace(/^```(?:json)?\s*|\s*```$/g, ''));}
  catch (_) {throw new ApiError(502, 'The model did not return valid JSON. No changes were saved.');}
  compatible(app, candidate);
  return candidate;
}
function handle(e) {
  const app = e.app, action = e.request.pathValue('action'), id = e.request.pathValue('id');
  const method = e.request.method, request = copy(e.requestInfo().body || {}), params = copy(e.requestInfo().query || {});
  const current = active(app), config = body(current);
  let result;
  if (method === 'GET') {
    if (action === 'workspace') result = {config, version: current.getInt('version'), modelCalls: app.store().get('modelCalls') || 0, modelReady: !!($os.getenv('LLM_BASE_URL') && $os.getenv('LLM_MODEL')), revisions: all(app, 'revisions').map(r => ({version: r.getInt('version'), label: r.getString('label')})).reverse()};
    else if (action === 'query') result = query(app, config, id, params);
    else if (action === 'record') result = row(app.findRecordById('records', id));
    else if (action === 'revision') result = body(app.findFirstRecordByData('revisions', 'version', Number(id)));
    else if (action === 'options') {find(config.objects, id);
      result = {options: records(app, id).map(r => ({value: r.id, label: String(row(r)[find(config.objects, id).fields[0].id] || r.id)}))};}
    else if (action === 'links') {
      const relation = find(config.relations, id);
      const label = (recordId, object) => String(row(app.findRecordById('records', recordId))[find(config.objects, object).fields[0].id] || recordId);
      result = {items: all(app, 'links').filter(l => l.getString('relation') === id).map(l => ({id: l.id, source: l.getString('source'), target: l.getString('target'), sourceName: label(l.getString('source'), relation.from), targetName: label(l.getString('target'), relation.to)}))};
    }
    else throw new NotFoundError();
  } else if (method === 'POST' && action === 'generate') {
    result = {config: generate(app, request.prompt, config), version: current.getInt('version')};
  } else app.runInTransaction(tx => {
    const fresh = body(active(tx));
    if (method === 'POST' && action === 'workspace') result = save(tx, request.config, request.version, request.label);
    else if (method === 'POST' && action === 'record') {
      const object = request.object, data = request.data;
      validateRecord(tx, fresh, object, data, id);
      insist(records(tx, object).length < 5000 || !!id, 'Demo limit: 5,000 records per object');
      if (id) {
        const record = tx.findRecordById('records', id);
        insist(record.getString('object') === object, 'Cannot change a record object');
        record.set('data', data); tx.save(record); result = row(record);
      } else result = row(insert(tx, 'records', {object, data}));
    } else if (method === 'DELETE' && action === 'record') {
      insist(!fresh.queries.some(q => q.related && q.related.record === id), 'Remove saved queries referencing this record first');
      all(tx, 'links').filter(l => l.getString('source') === id || l.getString('target') === id).forEach(l => tx.delete(l));
      tx.delete(tx.findRecordById('records', id)); result = {};
    } else if (method === 'POST' && action === 'links') {
      validateLink(tx, fresh, id, request.source, request.target);
      result = {id: insert(tx, 'links', {relation: id, source: request.source, target: request.target}).id};
    } else if (method === 'DELETE' && action === 'links') {tx.delete(tx.findRecordById('links', id)); result = {};}
    else if (method === 'POST' && action === 'example') {
      insist(active(tx).getInt('version') === 0 && !all(tx, 'records').length, 'Load the example only into an empty workspace');
      const example = JSON.parse(toString($os.readFile(__hooks + '/../examples/sales.json')));
      result = save(tx, example.config, 0, 'Sales example (metadata, not AI)');
      const ids = {};
      example.records.forEach(item => {
        Object.keys(item.data).forEach(key => {if (/^@today-\d+$/.test(String(item.data[key]))) {const date = new Date();
          date.setUTCDate(date.getUTCDate() - Number(item.data[key].slice(7)));
          item.data[key] = date.toISOString().slice(0, 10);}});
        validateRecord(tx, example.config, item.object, item.data);
        ids[item.key] = insert(tx, 'records', {object: item.object, data: item.data}).id;
      });
      example.links.forEach(l => {validateLink(tx, example.config, l.relation, ids[l.source], ids[l.target]);
        insert(tx, 'links', {relation: l.relation, source: ids[l.source], target: ids[l.target]});});
    } else throw new NotFoundError();
  });
  return e.json(200, {status: 0, data: result});
}
module.exports = {handle};
