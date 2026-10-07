migrate(app => {
  const collections = {
    definitions: [{name: 'body', type: 'json'}, {name: 'version', type: 'number'}],
    revisions: [{name: 'body', type: 'json'}, {name: 'version', type: 'number'}, {name: 'label', type: 'text'}],
    records: [{name: 'object', type: 'text', required: true}, {name: 'data', type: 'json'}],
    links: ['relation', 'source', 'target'].map(name => ({name, type: 'text', required: true}))
  };
  Object.keys(collections).forEach(name => app.save(new Collection({name, type: 'base', fields: collections[name]})));
  const active = new Record(app.findCollectionByNameOrId('definitions'));
  active.set('body', {title: 'My workspace', objects: [], relations: [], queries: [], screens: []});
  active.set('version', 0);
  app.save(active);
}, app => {
  ['links', 'records', 'revisions', 'definitions'].forEach(name => app.delete(app.findCollectionByNameOrId(name)));
});
