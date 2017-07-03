const debug = require('debug')('sse');

const sse_handler = function(req, res, next){
	res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

	res.sse = (event, data) => {
		if(event !== undefined && data !== undefined){
			debug('sse', event, data);
            try{
			res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            }
            catch(e){}
		}
		else if(event !== undefined){
			debug('sse', event);
			res.write(`${event}\n\n`);
		}
		else throw new TypeError("Invalid arguments");
	};

	res.sse(`retry 2000`);

	const keepAlive = setInterval(() => {
			res.sse(':keepAlive');
	}, 1000 * 5);

	res.on('close', () => clearInterval(keepAlive));
	res.on('error', (err) => {
        clearInterval(keepAlive);
	});

	next();
};

module.exports = sse_handler;