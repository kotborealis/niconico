const config = require('chen.js').config;

const debug = require('debug')('nico-web');

const path = require('path');
const fs = require('fs');
const querystring = require("querystring");
const express = require('express');

const Queue = require('./Queue');
const nico = require('./nico');
const VideoStream = require('./VideoStream');

const sse = require('./sse');

/**
 * Utility functions
 */

const getVideo = (id) => new Promise((resolve, reject) => {
    let cache_entity = null;
    cache.forEach(i => {
        if(i.id === id){
            debug('Video info cache hit');
            cache_entity = i.info;
        }
    });

    if(cache_entity){
        resolve(cache_entity);
        return;
    }

    nico.getVideo(id).then(info => {
        cache.push({id, info});
        resolve(info);
    }).catch(reject);
});

/**
 * App vars
 */
const cache = Queue(10);

/**
 * Login to niconico
 */

nico.login(config.get('niconico.login'), config.get('niconico.password')).then(auth => {
    if(!auth){
        console.log("NicoNico auth failed");
        process.exit(1);
    }
    else{
        debug('Logged in to niconico');
    }
}).catch(() => {
    console.log("NicoNico auth failed");
    process.exit(1);
});

/**
 * Express app
 */

const app = express();
app.use(express.static('./public/'));

app.get('/api/info/:id', (req, res) => {
    debug('api/info/', req.params.id);
    getVideo(req.params.id).then(video => res.json(video)).catch(e => res.json({error: e}));
});

app.get('/api/download/:id', (req, res) => {
    debug('api/download/', req.params.id);
    getVideo(req.params.id).then(video => {
        nico.requestVideo(video, (response) => {
            response.headers['content-disposition'] =
                `attachment; filename="${querystring.escape(video.title)}.${video.movieType}"`;
        }).pipe(res);
    }).catch(e => res.json({error: e}));
});

app.listen(config.get('webserver.port'), () => console.log("Nicobot on ", config.get('webserver.port')));
