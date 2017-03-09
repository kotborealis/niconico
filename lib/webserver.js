const config = require('chen.js').config;
const nico = require('./nico');
const querystring = require("querystring");
const express = require('express');
const stream = require('stream');
const Youtube = require('youtube-video-api');
const YoutubeAPI = require('youtube-video-api').youtube;
const EventEmitter = require('events');

const youtube = Youtube({
    video: {
        part: 'status,snippet'
    },
    email: config.get('youtube.login'),
    password: config.get('youtube.password')
});

youtube.authenticate(config.get('youtube.client_id'), config.get('youtube.client_secret'));

const Queue = (n) => new Proxy(new Array(n), {
    get(target, prop){
        if(prop === 'push'){
            target.shift();
        }
        return Reflect.get(target, prop);
    }
});
// Small Queue-based cache; Use push to add new entity;
const cache = Queue(10);

class VideoStream extends stream.Transform {
    constructor(source, options) {
        super(options);
    }

    _transform(data, encoding, callback) {
        callback(null, data, encoding);
    }
}

const requestUserUploadsPlaylist = () => new Promise((resolve, reject) => {
    YoutubeAPI.channels.list(Object.assign({
        mine: true,
        part: 'contentDetails',
    }, {auth: youtube.oauth}), (err, data) => {
        if(err || data.error){
            reject(err || data.error);
        }
        else{
            resolve(data.items[0].contentDetails.relatedPlaylists.uploads);
        }
    });
});

const requestVideoPlaylist = (id, pageToken) => new Promise((resolve, reject) => {
    YoutubeAPI.playlistItems.list(Object.assign({
        playlistId: id,
        part: 'id,snippet',
        maxResults: 50
    }, {auth: youtube.oauth}), (err, data) => {
        if(err || data.error){
            reject(err || data.error);
        }
        else{
            resolve(data);
        }
    });
});

const findExistingVideo = (id) => new Promise(async (resolve, reject) => {
    const playlistId = await requestUserUploadsPlaylist();

    let nextPageToken = null;
    for(;;){
        try{
            const playlist = await requestVideoPlaylist(playlistId, nextPageToken);
            let res = null;
            playlist.items.forEach(video => {
                if(video.snippet.description.indexOf(`sm${id}`) >= 0){
                    res = video;
                }
            });

            if(res){
                resolve(res);
                break;
            }
            if(!playlist.nextPageToken){
                reject();
                break;
            }

            nextPageToken = playlist.nextPageToken;
        }
        catch(e){
            reject();
        }
    }
});

const getVideo = (id) => new Promise((resolve, reject) => {
    let cache_entity = null;
    cache.forEach(i => {
        if(i.id === id){
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

const tasks = new EventEmitter();
const active_tasks = new Set;
const finished_tasks = new Map;

const app = express();
app.use(express.static('./public/'));
nico.login(config.get('niconico.login'), config.get('niconico.password')).then(auth => {
    if(!auth) throw new Error("Auth failed");

    app.get('/api/info/:id', (req, res) => {
        getVideo(req.params.id).then(video => res.json(video)).catch(e => res.json({error: e}));
    });

    app.get('/api/download/:id', (req, res) => {
        getVideo(req.params.id).then(video => {
            nico.requestVideo(video, (response) => {
                response.headers['content-disposition'] =
                    `attachment; filename="${querystring.escape(video.title)}.${video.movieType}"`;
            }).pipe(res);
        }).catch(e => res.json({error: e}));
    });

    app.get('/api/youtube/:id', (req, res) => {
        getVideo(req.params.id).then(video => {
            findExistingVideo(req.params.id)
            .then(({snippet: {resourceId: {videoId}}}) => {
                res.json({id: videoId});
            })
             .catch(() => {
                res.set('connection', 'keep-alive');
                const s = new VideoStream;
                nico.requestVideo(video).pipe(s);
                youtube.upload(s, {
                    resource: {
                        snippet: {
                            title: video.title,
                            description: `http://nicovideo.jp/watch/sm${req.params.id}`
                        },
                        status: {
                            privacyStatus: 'public'
                        }
                    }
                }, (err, video) => err ? res.send(err) : res.send(video));
            });
        }).catch(e => res.json({error: e}));
    });

    app.get('/api/v2/youtube/:id', (req, res) => {
        getVideo(req.params.id).then(video => {
            findExistingVideo(req.params.id)
            .then(({snippet: {resourceId: {videoId}}}) => {
                res.json({video: {id: videoId}});
            })
            .catch(() => {
                let last_progress_update = 0;
                const task_id = req.params.id;
                const s = new VideoStream;
                nico.requestVideo(video, () => undefined, (progress) => {
                    let now = Date.now();
                    if(now > last_progress_update + 500){
                        tasks.emit(`${task_id}:progress`, progress);
                        last_progress_update = now;
                    }
                }).pipe(s);
                youtube.upload(s, {
                    resource: {
                        snippet: {
                            title: video.title,
                            description: `http://nicovideo.jp/watch/sm${req.params.id}`
                        },
                        status: {
                            privacyStatus: 'public'
                        }
                    }
                }, (err, video) => {
                    if(err){
                        finished_tasks.set(task_id, {error: err});
                        tasks.emit(`${task_id}:error`, err);
                    }
                    else{
                        finished_tasks.set(task_id, {video});
                        tasks.emit(`${task_id}:video`, video);
                    }
                    active_tasks.delete(task_id);
                });
                active_tasks.add(task_id);
                res.json({task: {id: task_id}});
            });
        }).catch(e => res.json({error: e}));
    });

    app.get('/api/v2/youtube/sse/:id', (req, res) => {
        const id = req.params.id;
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        const sse_send = (event, data, close = false) => {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            if(close){
                res.end();
            }
        };

        if(finished_tasks.has(id)){
            const data = finished_tasks.get(id);
            if(data.error){
                sse_send('error', data.error, true);
            }
            else{
                sse_send('video', data.video, true);
            }
            finished_tasks.delete(id);
        }
        else if(active_tasks.has(id)){
            tasks.on(`${id}:progress`, (progress) => {
                sse_send('progress', progress);
            });
            tasks.on(`${id}:error`, (error) => {
                finished_tasks.delete(id);
                sse_send('error', {error}, true);
            });
            tasks.on(`${id}:video`, (video) => {
                finished_tasks.delete(id);
                sse_send('video', {video}, true);
            });
        }
        else{
            sse_send('error', {}, true);
        }
    });

    app.listen(config.get('webserver.port'), () => console.log("Nicobot on ", config.get('webserver.port')));
}).catch(() => {
    throw new Error("Auth failed")
});
