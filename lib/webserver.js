const config = require('chen.js').config;
const nico = require('./nico');
const querystring = require("querystring");
const express = require('express');
const stream = require('stream');
const Youtube = require('youtube-video-api');

const youtube = Youtube({
  video: {
    part: 'status,snippet'
  },
  email: config.get('youtube.login'),
  password: config.get('youtube.password')
});

youtube.authenticate(config.get('youtube.client_id'), config.get('youtube.client_secret'));

class VideoStream extends stream.Transform {
  constructor(source, options){
    super(options);
  }

  _transform(data, encoding, callback){
    callback(null, data);
  }
}

const app = express();
nico.login(config.get('niconico.login'), config.get('niconico.password')).then(auth => {
  if(!auth) throw new Error("Auth failed");
  app.get('/:id', (req, res) => {
    nico.getVideo(req.params.id)
    .then(video => {
      nico.requestVideo(video, (response) => {
        response.headers['content-disposition'] =
        `attachment; filename="${querystring.escape(video.title)}.${video.movieType}"`;
      })
      .pipe(res);
    })
    .catch(e => void console.log(e) && res.send(e));
  });

  app.get('/u/:id', (req, res) => {
    nico.getVideo(req.params.id)
    .then(video => {
      res.set('connection', 'keep-alive');
      const s = new VideoStream;
      nico.requestVideo(video).pipe(s);
      youtube.upload(s, {
        resource: {
          snippet: {
            title: video.title,
            description: `nicovideo.jp/watch/sm${req.params.id}`
          },
          status: {
            privacyStatus: 'public'
          }
        }
      }, (err, video) => err ? res.send(err) : res.send(video));
    })
    .catch(e => void console.log(e) && res.send(e));
  });

  app.listen(config.get('webserver.port'), () => console.log("Nicobot on ", config.get('webserver.port')));
}).catch(() => {throw new Error("Auth failed")});
