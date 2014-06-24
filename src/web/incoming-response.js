var util = require('../util');
var helpers = require('./helpers.js');
var httpHeaders = require('./http-headers.js');
var contentTypes = require('./content-types.js');

// IncomingResponse
// ================
// EXPORTED
// Interface for receiving responses
function IncomingResponse() {
	util.EventEmitter.call(this);
	var this2 = this;
	var hidden = function(k, v) { Object.defineProperty(this2, k, { value: v, writable: true }); };

	// Set attributes
	this.status = 0;
	this.reason = undefined;
	hidden('latency', undefined);

	// Stream state
	hidden('isConnOpen', true);
	hidden('isStarted', true);
	hidden('isEnded', false);
	this.on('end', function() { this2.isEnded = true; });
}
IncomingResponse.prototype = Object.create(util.EventEmitter.prototype);
module.exports = IncomingResponse;

// Simple response-summary helper
IncomingResponse.prototype.summary = function() {
	return helpers.escape(this.status + ((this.reason) ? ' '+this.reason : ''));
};

// Parses headers, makes sure response header links are absolute
IncomingResponse.prototype.processHeaders = function(baseUrl, headers) {
	this.status = headers.status;
	this.reason = headers.reason;

	// Parse headers
	for (var k in headers) {
		if (helpers.isHeaderKey(k)) {
			// Is a header, save
			this[k] = headers[k];

			// Try to parse
			var parsedHeader = httpHeaders.deserialize(k, headers[k]);
			if (parsedHeader && typeof parsedHeader != 'string') {
				this[k.toLowerCase()] = parsedHeader;
			}
		}
	}

	// Process links
	this.links = require('./links').processLinks(this.link || [], baseUrl);
	delete this.link;
};


// Stream buffering
// stores the incoming stream and attempts to parse on end
IncomingResponse.prototype.buffer = function(cb) {
	// setup buffering
	if (typeof this._buffer == 'undefined') {
		var this2 = this;
		this._buffer = '';
		this.body = null;
		this.on('data', function(data) {
			if (typeof data == 'string') {
				this2._buffer += data;
			} else {
				this2._buffer = data; // Assume it is an array buffer or some such
			}
		});
		this.on('end', function() {
			if (this2.ContentType)
				this2.body = contentTypes.deserialize(this2.ContentType, this2._buffer);
			else
				this2.body = this2._buffer;
		});
	}
	this.on('end', cb);
};

// Pipe helper
// streams the incoming resposne into an outgoing request or response
// - doesnt overwrite any previously-set headers
// - params:
//   - `target`: the incoming request or response to pull data from
//   - `headersCb`: (optional) takes `(k, v)` from source and responds updated header for target
//   - `bodyCb`: (optional) takes `(body)` from source and responds updated body for target
IncomingResponse.prototype.pipe = function(target, headersCB, bodyCb) {
	headersCB = headersCB || function(k, v) { return v; };
	bodyCb = bodyCb || function(v) { return v; };
	if (target.autoEnd) {
		target.autoEnd(false); // disable auto-ending, we are now streaming
	}
	if (target instanceof require('./response')) {
		if (!target.headers.status) {
			target.status(this.status, this.reason);
		}
		for (var k in this) {
			if (helpers.isHeaderKey(k)) {
				target.header(k, headersCB(k, this[k]));
			}
		}
	} else if (target instanceof require('./request')) {
		if (this.status < 200 || this.status >= 400) {
			// We're a failed response, abort the request
			target.close();
			return target;
		}
		if (!target.headers.ContentType && this.ContentType) {
			target.contentType(this.ContentType);
		}
	}
	if (this.isEnded) {
		// send body (if it was buffered)
		target.end(bodyCb(this.body));
	} else {
		// wire up the stream
		this.on('data', function(chunk) { target.write(bodyCb(chunk)); });
		this.on('end', function() { target.end(); });
	}
	return target;
};