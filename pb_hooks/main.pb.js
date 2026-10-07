routerUse(e => {
  const host = e.request.host, origin = e.request.header.get('Origin');
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || (origin && origin !== 'http://' + host)) throw new ForbiddenError('Local requests only');
  if (e.request.url.path.startsWith('/api/workspace/') && !['GET', 'HEAD', 'OPTIONS'].includes(e.request.method) && e.request.header.get('X-Workspace') !== '1') throw new ForbiddenError('Missing local request header');
  return e.next();
});
routerAdd('GET', '/vendor/{path...}', $apis.static(__hooks + '/../pb_public/vendor', false));
routerAdd('GET', '/api/workspace/{action}/{id...}', e => require(__hooks + '/engine.js').handle(e));
routerAdd('POST', '/api/workspace/{action}/{id...}', e => require(__hooks + '/engine.js').handle(e), $apis.bodyLimit(262144));
routerAdd('DELETE', '/api/workspace/{action}/{id...}', e => require(__hooks + '/engine.js').handle(e));
