const nico_url = (id) => `http://nicovideo.jp/watch/sm${id}`;
const youtube_url = (id) => `https://www.youtube.com/watch?v=${id}`;

const ui = new UI;

const updateUploadStatus = (progress) => {
    let payload = `Uploading: <a href='${nico_url(localStorage['id'])}' target="_blank">${localStorage['title']}</a>`;
    if(progress){
        payload += ` ${Math.floor(progress.progress/progress.size * 100)}%`;
    }
    ui.status = payload;
};

const sse_handler = {
    progress_cb(progress){
        updateUploadStatus(progress);
    },
    error_cb(){
        ui.error = 'Something went wrong; Try again;';
        ui.disabled = false;
    },
    video_cb(data){
        const url = youtube_url(data.video.id);
        ui.status = `Upload finished: <a href='${url}' target="_blank">${localStorage['title']} — ${url}</a>`;
        ui.disabled = false;
    }
};

if(localStorage['id']){
    ui.disabled = true;
    api.sse(localStorage['id'], sse_handler);
}

ui.onsubmit = () => {
    ui.disabled = true;
    const id = localStorage['id'] = ui.id;
    const action = ui.action;
    if(!id){
        ui.error = 'Invalid link;';
        ui.disabled = false;
    }
    else{
        ui.status = 'Grabbing video info...';
        api.fetch_info(id)
            .then(info => {
            const title = localStorage['title'] = info.title;

            updateUploadStatus();

            if(action === 'download'){
                document.querySelector('#invisible_iframe').src = '/api/download/' + id;
                ui.status = `Downloading: <a href='${nico_url(localStorage['id'])}' target="_blank">${localStorage['title']}</a>`;
                ui.disabled = false;
            }
            else if(action === 'reupload'){
                api.fetch_youtube(id).then(data => {
                    if(data.video){
                        const url = youtube_url(data.video.id);
                        ui.status = `Upload finished: <a href='${url}' target="_blank">${title} — ${url}</a>`;
                        ui.disabled = false;
                    }
                    if(data.task){
                        api.sse(id, sse_handler);
                    }
                });
            }
        })
        .catch((e) => {
            ui.error = 'Something went wrong; Try again; ' + e;
            ui.disabled = false;
        });
    }
};