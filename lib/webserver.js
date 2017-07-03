const config = require('chen.js').config;

const debug = require('debug')('nico-web');

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const querystring = require("querystring");
const express = require('express');

const Queue = require('./Queue');
const nico = require('./nico');
const VideoStream = require('./VideoStream');

const sse = require('./sse');

const youtube = new (require('./YoutubeUtils'));

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

const login = () =>
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
    const _ = youtube.getOAuth2Url();
    console.log(_);
    res.redirect(_);
});

app.get('/oauth2callback', (req, res) => {
    debug('oauth2callback');
    youtube.oauth2callback(req.query.code)
        .then(() => res.redirect('/'))
        .catch(() => res.send("Error"));
});

app.get('/api/info/:id', (req, res) => {
    debug('api/info/', req.params.id);
    login().then(() => getVideo(req.params.id).then(video => res.json(video)).catch(e => res.json({error: e})));
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

app.get('/api/host/:id', (req, res) => {
    debug('api/host/', req.params.id);
    getVideo(req.params.id).then(video => {
        const filename = `${video.title}.${req.params.id}.${video.movieType}`;
        const filepath = path.join(__dirname, '..', 'public', 'files', filename);

        if(fs.existsSync(filepath)){
            const video_hosted = {url: 'files/' + filename};
            res.json({video: video_hosted});
            return;
        }

        const file_stream = fs.createWriteStream(filepath);

        let last_progress_update = 0;
        const task_id = req.params.id;
        const stream = nico.requestVideo(video, () => undefined, (progress) => {
            let now = Date.now();
            if(now > last_progress_update + 500){
                tasks.emit(`${task_id}:progress`, progress);
                last_progress_update = now;
            }
        });

        stream.on('end', () => {
            const video_hosted = {url: 'files/' + filename};
            finished_tasks.push({id: task_id, video: video_hosted});
            tasks.emit(`${task_id}:video`, video_hosted);
            active_tasks.delete(task_id);
        }).on('error', (err) => {
            finished_tasks.push({id: task_id, error: err});
            tasks.emit(`${task_id}:error`, err);
            active_tasks.delete(task_id);
        });
        stream.pipe(file_stream);

        active_tasks.add(task_id);
        res.json({task: {id: task_id}});
    }).catch(e => res.json({error: e}));
});

app.get('/api/reupload/:id', (req, res) => {
    debug('api/reupload/', req.params.id);
        youtube.findExistingVideo(req.params.id).then(({snippet: {resourceId: {videoId}}}) => {
            const video_hosted = {url: `https://www.youtube.com/watch?v=${videoId}`};
            res.json({video: video_hosted});
        })
        .catch(() => {
            getVideo(req.params.id).then(video => {
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
                }).then(video => {
                    const video_hosted = {url: `https://www.youtube.com/watch?v=${video.id}`};
                    finished_tasks.push({id: task_id, video: video_hosted});
                    tasks.emit(`${task_id}:video`, video_hosted);
                }).catch(err => {
                    finished_tasks.push({id: task_id, error: err});
                    tasks.emit(`${task_id}:error`, err);
                    active_tasks.delete(task_id);
                });

                active_tasks.add(task_id);
                res.json({task: {id: task_id}});
            }).catch(e => res.json({error: e}));
        });
});

app.get('/api/host/sse/:id', sse, (req, res) => {
    debug('/api/host/sse', req.params.id);
    const id = req.params.id;

    let data = null;
    finished_tasks.forEach(i => {
        if(i.id === id){
            data = i;
        }
    });

    if(data){
        if(data.error){
            res.sse('error', {error: data.error}, true);
            res.end();
        }
        else{
            res.sse('video', {video: data.video}, true);
            res.end();
        }
    }
    else if(active_tasks.has(id)){
        res.sse('active', id);
        const _progress = (progress) => {
            res.sse('progress', progress);
        };
        const _error = (error) => {
            res.sse('error', {error});
            removeListeners();
            res.end();
        };
        const _video = (video) => {
            res.sse('video', {video});
            removeListeners();
            res.end();
        };

        function removeListeners(){
            tasks.removeAllListeners(`${id}:progress`);
            tasks.removeAllListeners(`${id}:error`);
            tasks.removeAllListeners(`${id}:video`);
        }

        tasks.on(`${id}:progress`, _progress);
        tasks.on(`${id}:error`, _error);
        tasks.on(`${id}:video`, _video);
    }
    else{
        res.sse('not_found', {});
        res.end();
    }
});

app.listen(config.get('webserver.port'), () => console.log("Nicobot on ", config.get('webserver.port')));
