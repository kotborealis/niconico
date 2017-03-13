const config = require('chen.js').config;

const path = require('path');
const fs = require('fs');
const querystring = require("querystring");
const express = require('express');
const EventEmitter = require('events');
const mime = require('mime');

const Queue = require('./Queue');
const nico = require('./nico');
const VideoStream = require('./VideoStream');

const google = require('googleapis');
const youtube = google.youtube('v3');
const OAuth2Client = google.auth.OAuth2;

const oauth2client = new OAuth2Client(config.get('youtube.web.client_id'), config.get('youtube.web.client_secret'), config.get('youtube.web.redirect_uris')[0]);

/**
 * Utility functions
 */

const requestUserUploadsPlaylist = () => new Promise((resolve, reject) => {
    youtube.channels.list(Object.assign({
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
    youtube.playlistItems.list(Object.assign({
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
        console.log("Authenticated nico");
    }
}).catch(() => {
    console.log("NicoNico auth failed");
    process.exit(1);
});

/**
 * Google auth
 */

const google_tokens = (() => {
    try{
        const str = fs.readFileSync(path.join(__dirname, '.google-tokens.json'));
        return JSON.parse(str);
    }
    catch(e){
        return null;
    }
})();
if(google_tokens){
    oauth2client.setCredentials(google_tokens);
    google.options({auth: oauth2client});
    console.log("Authenticated google");
}

/**
 * Express app
 */

const app = express();
app.use(express.static('./public/'));

app.get('/oauth2', (req, res) => {
    const url = oauth2client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/youtube',
            'https://www.googleapis.com/auth/youtube.upload']
    });

    res.redirect(url);
});

app.get('/oauth2callback', (req, res) => {
    const code = req.query.code;

    oauth2client.getToken(code, (err, tokens) => {
        if(!err){
            oauth2client.setCredentials(tokens);
            google.options({auth: oauth2client});
            console.log("Authenticated google");
            fs.writeFileSync(path.join(__dirname, '.google-tokens.json'), JSON.stringify(tokens));
        }
        else{
            res.send('Error while getting tokens');
        }
    });
});

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
                youtube.videos.insert({
                    part: 'status,snippet',
                    media: {
                        body: s
                    },
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
                        finished_tasks.push({id: task_id, error: err});
                        tasks.emit(`${task_id}:error`, err);
                    }
                    else{
                        finished_tasks.push({id: task_id, video});
                        tasks.emit(`${task_id}:video`, video);
                    }
                    active_tasks.delete(task_id);
                });
                //youtube.upload(s, {
                //    resource: {
                //        snippet: {
                //            title: video.title,
                //            description: `http://nicovideo.jp/watch/sm${req.params.id}`
                //        },
                //        status: {
                //            privacyStatus: 'public'
                //        }
                //    }
                //}, (err, video) => {
                //    if(err){
                //        finished_tasks.push({id: task_id, error: err});
                //        tasks.emit(`${task_id}:error`, err);
                //    }
                //    else{
                //        finished_tasks.push({id: task_id, video});
                //        tasks.emit(`${task_id}:video`, video);
                //    }
                //    active_tasks.delete(task_id);
                //});
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
