// Helpers
// =======

// EXPORTED
// breaks a link header into a javascript object
var linkHeaderRE1 = /<(.*?)>(?:;[\s]*([^,]*))/g;
var linkHeaderRE2 = /([\-a-z0-9\.]+)=?(?:(?:"([^"]+)")|([^;\s]+))?/g;
local.web.parseLinkHeader = function parseLinkHeader(headerStr) {
	if (typeof headerStr !== 'string') {
		return headerStr;
	}
	var links = [], linkParse1, linkParse2, link;
	// '</foo/bar>; rel="baz"; id="blah", </foo/bar>; rel="baz"; id="blah", </foo/bar>; rel="baz"; id="blah"'
	// Extract individual links
	while ((linkParse1 = linkHeaderRE1.exec(headerStr))) { // Splits into href [1] and params [2]
		link = { href: linkParse1[1] };
		// 'rel="baz"; id="blah"'
		// Extract individual params
		while ((linkParse2 = linkHeaderRE2.exec(linkParse1[2]))) { // Splits into key [1] and value [2]/[3]
			link[linkParse2[1]] = linkParse2[2] || linkParse2[3] || true; // if no parameter value is given, just set to true
		}
		links.push(link);
	}
	return links;
};

// EXPORTED
// takes parsed a link header and a query object, produces an array of matching links
// - `links`: [object]/object, either the parsed array of links or the request/response object
local.web.queryLinks = function queryLinks(links, query) {
	if (!links) return [];
	if (links.headers) links = links.headers.link; // actually a request or response object
	if (!Array.isArray(links)) return [];
	return links.filter(function(link) { return local.web.queryLink(link, query); });
};

// EXPORTED
// gives the first result from queryLinks
local.web.queryLinks1 = function queryLinks1(links, query) {
	var matches = local.web.queryLinks(links, query);
	return matches[0];
};

// EXPORTED
// takes parsed link and a query object, produces a boolean `isMatch`
// - `query`: object, keys are attributes to test, values are values to test against (strings)
//            eg { rel: 'foo bar', id: 'x' }
// - Query rules
//   - rel: can take multiple values, space-separated, which are ANDed logically
//   - rel: will ignore the preceding scheme and trailing slash on URI values
//   - rel: items preceded by an exclamation-point will invert (logical NOT)
local.web.queryLink = function queryLink(link, query) {
	for (var attr in query) {
		if (attr == 'rel') {
			var terms = query.rel.split(/\s+/);
			for (var i=0; i < terms.length; i++) {
				var desiredBool = true;
				if (terms[i].charAt(0) == '!') {
					terms[i] = terms[i].slice(1);
					desiredBool = false;
				}
				if (RegExp('(\\s|^)(.*//)?'+terms[i]+'(\\s|$)', 'i').test(link.rel) !== desiredBool)
					return false;
			}
		}
		else {
			if (link[attr] != query[attr])
				return false;
		}
	}
	return true;
};

// <https://github.com/federomero/negotiator>
// for to ^ for the content negotation helpers below

// EXPORTED
// breaks an accept header into a javascript object
// - `accept`: string, the accept header
local.web.parseAcceptHeader = function parseAcceptHeader(accept) {
	return accept.split(',')
		.map(function(e) { return parseMediaType(e.trim()); })
		.filter(function(e) { return e && e.q > 0; });
};

// INTERNAL
function parseMediaType(s) {
	var match = s.match(/\s*(\S+)\/([^;\s]+)\s*(?:;(.*))?/);
	if (!match) return null;

	var type = match[1];
	var subtype = match[2];
	var full = "" + type + "/" + subtype;
	var params = {}, q = 1;

	if (match[3]) {
		params = match[3].split(';')
			.map(function(s) { return s.trim().split('='); })
			.reduce(function (set, p) { set[p[0]] = p[1]; return set; }, params);

		if (params.q !== null) {
			q = parseFloat(params.q);
			delete params.q;
		}
	}

	return {
		type: type,
		subtype: subtype,
		params: params,
		q: q,
		full: full
	};
}

// INTERNAL
function getMediaTypePriority(type, accepted) {
	var matches = accepted
		.filter(function(a) { return specify(type, a); })
		.sort(function (a, b) { return a.q > b.q ? -1 : 1; }); // revsort
	return matches[0] ? matches[0].q : 0;
}

// INTERNAL
function specifies(spec, type) {
	return spec === '*' || spec === type;
}

// INTERNAL
function specify(type, spec) {
	var p = parseMediaType(type);

	if (spec.params) {
		var keys = Object.keys(spec.params);
		if (keys.some(function (k) { return !specifies(spec.params[k], p.params[k]); })) {
			// some didn't specify.
			return null;
		}
	}

	if (specifies(spec.type, p.type) && specifies(spec.subtype, p.subtype)) {
		return spec;
	}
}

// EXPORTED
// returns an array of preferred media types ordered by priority from a list of available media types
// - `accept`: string/object, given accept header or request object
// - `provided`: optional [string], allowed media types
local.web.preferredTypes = function preferredTypes(accept, provided) {
	if (typeof accept == 'object') {
		accept = accept.headers.accept;
	}
	accept = local.web.parseAcceptHeader(accept || '');
	if (provided) {
		if (!Array.isArray(provided)) {
			provided = [provided];
		}
		return provided
			.map(function(type) { return [type, getMediaTypePriority(type, accept)]; })
			.filter(function(pair) { return pair[1] > 0; })
			.sort(function(a, b) { return a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1; }) // revsort
			.map(function(pair) { return pair[0]; });
	}
	return accept.map(function(type) { return type.full; });
};

// EXPORTED
// returns the top preferred media type from a list of available media types
// - `accept`: string/object, given accept header or request object
// - `provided`: optional [string], allowed media types
local.web.preferredType = function preferredType(accept, provided) {
	return local.web.preferredTypes(accept, provided)[0];
};
// </https://github.com/federomero/negotiator>

// EXPORTED
// correctly joins together all url segments given in the arguments
// eg joinUrl('/foo/', '/bar', '/baz/') -> '/foo/bar/baz/'
local.web.joinUrl = function joinUrl() {
	var parts = Array.prototype.map.call(arguments, function(arg, i) {
		arg = ''+arg;
		var lo = 0, hi = arg.length;
		if (arg == '/') return '';
		if (i !== 0 && arg.charAt(0) === '/') { lo += 1; }
		if (arg.charAt(hi - 1) === '/') { hi -= 1; }
		return arg.substring(lo, hi);
	});
	return parts.join('/');
};

// EXPORTED
// tests to see if a URL is absolute
// - "absolute" means that the URL can reach something without additional context
// - eg http://foo.com, //foo.com, httpl://bar.app, rel:http://foo.com, rel:foo.com
var isAbsUriRE = /^(http(s|l)?:)|(rel:[^|])|(\/\/)/;
local.web.isAbsUri = function(v) {
	return isAbsUriRE.test(v);
};

// EXPORTED
// tests to see if a URL is using the rel scheme
var isRelSchemeUriRE = /\|\||rel:/;
local.web.isRelSchemeUri = function(v) {
	return isRelSchemeUriRE.test(v);
};


// EXPORTED
// takes a context url and a relative path and forms a new valid url
// eg joinRelPath('http://grimwire.com/foo/bar', '../fuz/bar') -> 'http://grimwire.com/foo/fuz/bar'
local.web.joinRelPath = function(urld, relpath) {
	if (typeof urld == 'string')
		urld = local.web.parseUri(urld);
	if (relpath.charAt(0) == '/')
		// "absolute" relative, easy stuff
		return urld.protocol + '://' + urld.authority + relpath;
	// totally relative, oh god
	// (thanks to geoff parker for this)
	var hostpath = urld.path;
	var hostpathParts = hostpath.split('/');
	var relpathParts = relpath.split('/');
	for (var i=0, ii=relpathParts.length; i < ii; i++) {
		if (relpathParts[i] == '.')
			continue; // noop
		if (relpathParts[i] == '..')
			hostpathParts.pop();
		else
			hostpathParts.push(relpathParts[i]);
	}
	return local.web.joinUrl(urld.protocol + '://' + urld.authority, hostpathParts.join('/'));
};

// EXPORTED
// parseUri 1.2.2, (c) Steven Levithan <stevenlevithan.com>, MIT License
local.web.parseUri = function parseUri(str) {
	if (typeof str === 'object') {
		if (str.url) { str = str.url; }
		else if (str.host || str.path) { str = local.web.joinUrl(req.host, req.path); }
	}

	// handle data-uris specially - performance characteristics are much different
	if (str.slice(0,5) == 'data:') {
		return { protocol: 'data', source: str };
	}

	var	o   = local.web.parseUri.options,
		m   = o.parser[o.strictMode ? "strict" : "loose"].exec(str),
		uri = {},
		i   = 14;

	while (i--) uri[o.key[i]] = m[i] || "";

	uri[o.q.name] = {};
	uri[o.key[12]].replace(o.q.parser, function ($0, $1, $2) {
		if ($1) uri[o.q.name][$1] = $2;
	});

	return uri;
};

local.web.parseUri.options = {
	strictMode: false,
	key: ["source","protocol","authority","userInfo","user","password","host","port","relative","path","directory","file","query","anchor"],
	q:   {
		name:   "queryKey",
		parser: /(?:^|&)([^&=]*)=?([^&]*)/g
	},
	parser: {
		strict: /^(?:([^:\/?#]+):)?(?:\/\/((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?))?((((?:[^?#\/]*\/)*)([^?#]*))(?:\?([^#]*))?(?:#(.*))?)/,
		loose:  /^(?:(?![^:@]+:[^:@\/]*@)([^:\/?#.]+):)?(?:\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/
	}
};

// EXPORTED
// Converts a 'rel:' URI into an array of http/s/l URIs and link query objects
local.web.parseRelUri = function(str) {
	if (!str) return [];

	// Split into navigations
	var parts = str.split('||');

	// First entry - starting URL
	// eg rel:http://foo.com||...
	if (parts[0]) {
		// Drop the scheme
		if (parts[0].indexOf('rel:') === 0)
			parts[0] = parts[0].slice(4);
	}

	// Remaining entries - queries
	// eg ...||rel=id,attr1=value1,attr2=value2||...
	for (var i=1; i < parts.length; i++) {
		var query = {};
		var attrs = parts[i].split(',');
		for (var j=0; j < attrs.length; j++) {
			var kv = attrs[j].split('=');
			if (j === 0) {
				query.rel = kv[0].replace(/\+/, ' ');
				if (kv[1])
					query.id = kv[1];
			} else
				query[kv[0]] = decodeURIComponent(kv[1]).replace(/\+/, ' ');
		}
		parts[i] = query;
	}

	// Drop first entry if empty
	if (!parts[0])
		parts.shift();

	return parts;
};

// sends the given response back verbatim
// - if `writeHead` has been previously called, it will not change
// - params:
//   - `target`: the response to populate
//   - `source`: the response to pull data from
//   - `headersCb`: (optional) takes `(headers)` from source and responds updated headers for target
//   - `bodyCb`: (optional) takes `(body)` from source and responds updated body for target
local.web.pipe = function(target, source, headersCB, bodyCb) {
	headersCB = headersCB || function(v) { return v; };
	bodyCb = bodyCb || function(v) { return v; };
	return local.promise(source)
		.succeed(function(source) {
			if (!target.status) {
				// copy the header if we don't have one yet
				target.writeHead(source.status, source.reason, headersCB(source.headers));
			}
			if (source.body !== null && typeof source.body != 'undefined') { // already have the body?
				target.write(bodyCb(source.body));
			}
			if (source.on && source.isConnOpen) {
				// wire up the stream
				source.on('data', function(data) {
					target.write(bodyCb(data));
				});
				source.on('end', function() {
					target.end();
				});
			} else {
				target.end();
			}
			return target;
		})
		.fail(function(source) {
			var ctype = source.headers['content-type'] || 'text/plain';
			var body = (ctype && source.body) ? source.body : '';
			target.writeHead(502, 'bad gateway', {'content-type':ctype});
			target.end(body);
			throw source;
		});
};