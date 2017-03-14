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
			res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
		}
		else if(event !== undefined){
			debug('sse', event);
			res.write(`${event}\n\n`);
		}
		else throw new TypeError("Invalid arguments");
	};

	res.sse(`retry 2000`);

	const keepAlive = setInterval(() => {
		try{
			res.sse(':keepAlive');
		}
		catch(e){
			clearInterval(keepAlive);			
		}
	}, 1000);

	res.on('close', () => clearInterval(keepAlive));

	next();
};

module.exports = sse_handler;