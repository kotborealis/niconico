const fetch_info = (id) => new Promise((resolve, reject) => {
    fetch('/api/info/' + id)
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

const fetch_youtube = (id) => new Promise((resolve, reject) => {
    fetch('/api/v2/youtube/' + id)
    .then(res => res.json())
     .then(data => {
        if(data.error){
            reject(data);
        }
        else{
            resolve(data);
        }
    });
});

const sse = (id, {progress_cb, error_cb, video_cb}) => {
    const sse = new EventSource('/api/v2/youtube/sse/' + id);
    sse.addEventListener('progress', (data) => {
        data = JSON.parse(data.data);
        progress_cb(data);
    });
    sse.addEventListener('error', () => {
        sse.close();
        localStorage.setItem('task', null);
        error_cb();
    });
    sse.addEventListener('video', (data) => {
        sse.close();
        localStorage.setItem('task', null);
        data = JSON.parse(data.data);
        video_cb(data);
    });
};

window.api = {
    sse, fetch_info, fetch_youtube
};