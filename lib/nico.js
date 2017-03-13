const debug = require('debug')('nico');
const debug_v = require('debug')('nico_v');
const Request = require('request');
const jar = Request.jar()
const request = Request.defaults({jar: jar});
const decodeHtmlEntities = (new (require('html-entities').AllHtmlEntities)).decode;

const LOGIN_URL = 'https://account.nicovideo.jp/api/v1/login?site=niconico';
const VIDEO_URL = id => `http://www.nicovideo.jp/watch/sm${id}`;
const VIDEO_API_DATA_RE = /data-api-data="(.+)"/i;
const VIDEO_ID_RE = /\/watch\/sm(\d+)/i;

const login = (login, password) => new Promise((resolve, reject) => {
    debug('login');
    request.post(LOGIN_URL, {
        form: {
            mail_tel: login,
            password: password
        }
    }, (err, res, body) => {
        if(err){
            debug('login error %s', err);
            reject(err);
            return;
        }

        resolve(res.headers['location'].indexOf('cant_login') < 0);
    });
});

const getVideo = id => new Promise((resolve, reject) => {
    debug('getVideo %s', id);
    jar.setCookie('watch_html5=1', VIDEO_URL(id));
    request.get(VIDEO_URL(id), (err, res, body) => {
        if(err){
            debug('getVideo error %s', err);
            reject(err);
            return;
        }

        const video_api_data = body.match(VIDEO_API_DATA_RE);
        if(!video_api_data){
            debug('getVideo no api data');
            reject(new Error("No api data"));
        }

        try{
            const _ = JSON.parse(decodeHtmlEntities(video_api_data[1])).video;
            resolve(_);
        }
        catch(e){
            debug('getVideo bad api-data json');
            reject(e);
        }
    });
});

const requestVideo = (video, onResponse = () => undefined, onProgress = () => undefined) => {
    debug('requestVideo', video.smileInfo);
    const start = Date.now();

    let size = 0;
    let progress = 0;
    let bps = 0;

    return request({
        url: video.smileInfo.url,
        headers: {
            'Connection': 'keep-alive'
        }
    }).on('response', response => {
        size = response.headers['content-length'];
        onResponse(response);
    }).on('data', data => {
        progress += data.length;
        bps = progress / ((Date.now() - start) / 1000);
        debug_v('progress', size, progress, bps);
        onProgress({
            size, progress, bps
        });
        return true;
    });
};

module.exports = {
    login, getVideo, requestVideo
};
