const fetch_ = (endpoint, id) => new Promise((resolve, reject) => {
    fetch(endpoint + id)
        .then(res => res.json())
        .then(info => {
            if(info.error){
                reject(info);
            }
            else{
                resolve(info);
            }
        });
});
const fetch_info = fetch_.bind(null, '/api/info/');
const fetch_download = fetch_.bind(null, '/api/download/');
const fetch_host = fetch_.bind(null, '/api/host/');

const sse = (id, {progress_cb, error_cb, video_cb}) => {
    const sse = new EventSource('/api/host/sse/' + id);
    sse.addEventListener('progress', (data) => {
        data = JSON.parse(data.data);
        progress_cb(data);
    });
    sse.addEventListener('error', () => {
        sse.close();
        delete localStorage['id'];
        error_cb();
    });
    sse.addEventListener('video', (data) => {
        sse.close();
        delete localStorage['id'];
        data = JSON.parse(data.data);
        video_cb(data);
    });
    sse.addEventListener('not_found', () => {
        sse.close();
        delete localStorage['id'];
        error_cb();
    });
};

window.api = {
   fetch_info, fetch_host, fetch_download, sse
};