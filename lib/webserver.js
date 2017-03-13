const config = require('chen.js').config;

const debug = require('debug')('nico-web');

const path = require('path');
const fs = require('fs');
const querystring = require("querystring");
const express = require('express');
const EventEmitter = require('events');

const Queue = require('./Queue');
const nico = require('./nico');
const VideoStream = require('./VideoStream');

const youtube = new (require('./YoutubeUtil'));

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
const tasks = new EventEmitter();
const active_tasks = new Set;
const finished_tasks = Queue(100);

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

app.get('/oauth2', (req, res) => {
    debug('oauth2');
    res.redirect(youtube.getOAuth2Url());
});

app.get('/oauth2callback', (req, res) => {
    debug('oauth2callback');
    youtube.oauth2callback(req.query.code)
        .then(() => res.redirect('/'))
        .catch(() => res.send("Error"));
});

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

app.get('/api/v2/youtube/:id', (req, res) => {
    debug('api/v2/youtube/', req.params.id);
    getVideo(req.params.id).then(video => {
        youtube.findExistingVideo(req.params.id)
            .then(({snippet: {resourceId: {videoId}}}) => {
                res.json({video: {id: videoId}});
            })
            .catch(() => {
                let last_progress_update = 0;
                const task_id = req.params.id;
                const stream = nico.requestVideo(video, () => undefined, (progress) => {
                    let now = Date.now();
                    if(now > last_progress_update + 500){
                        tasks.emit(`${task_id}:progress`, progress);
                        last_progress_update = now;
                    }
                });

                youtube.upload(stream, {
                    title: video.title,
                    description: `http://nicovideo.jp/watch/sm${req.params.id}`,
                })
                .then(video => {
                    finished_tasks.push({id: task_id, video});
                    tasks.emit(`${task_id}:video`, video);
                    active_tasks.delete(task_id);
                })
                .catch(err => {
                    finished_tasks.push({id: task_id, error: err});
                    tasks.emit(`${task_id}:error`, err);
                    active_tasks.delete(task_id);
                });

                active_tasks.add(task_id);
                res.json({task: {id: task_id}});
            });
    }).catch(e => res.json({error: e}));
});

app.get('/api/v2/youtube/sse/:id', (req, res) => {
    debug('api/v2/youtube/sse', req.params.id);
    const id = req.params.id;
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    const sse_send = (event, data, close = false) => {
        debug('sse', event, data, close);
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        if(close){
            res.end();
        }
    };

    sse_send('hello', '0');

    let data = null;
    finished_tasks.forEach(i => {
        if(i.id === id){
            data = i;
        }
    });

    if(data){
        if(data.error){
            sse_send('error', {error: data.error}, true);
        }
        else{
            sse_send('video', {video: data.video}, true);
        }
    }
    else if(active_tasks.has(id)){
        sse_send('active', id);
        tasks.on(`${id}:progress`, (progress) => {
            sse_send('progress', progress);
        });
        tasks.on(`${id}:error`, (error) => {
            sse_send('error', {error}, true);
        });
        tasks.on(`${id}:video`, (video) => {
            sse_send('video', {video}, true);
        });
    }
    else{
        sse_send('not_found', {}, true);
    }
});

app.listen(config.get('webserver.port'), () => console.log("Nicobot on ", config.get('webserver.port')));
