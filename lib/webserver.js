const config = require('chen.js').config;
const nico = require('./nico');
const querystring = require("querystring");
const express = require('express');
const stream = require('stream');
const Youtube = require('youtube-video-api');
const YoutubeAPI = require('youtube-video-api').youtube;

const youtube = Youtube({
    video: {
        part: 'status,snippet'
    },
    email: config.get('youtube.login'),
    password: config.get('youtube.password')
});

youtube.authenticate(config.get('youtube.client_id'), config.get('youtube.client_secret'));

// Small queue-based cache; Use push to add new entity;
const cache = new Proxy(new Array(5), {
    get(target, prop){
        if(prop === 'push'){
            target.shift();
        }
        return Reflect.get(target, prop);
    }
});

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

    app.listen(config.get('webserver.port'), () => console.log("Nicobot on ", config.get('webserver.port')));
}).catch(() => {
    throw new Error("Auth failed")
});
