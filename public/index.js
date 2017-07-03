const nico_url = (id) => `http://nicovideo.jp/watch/sm${id}`;
const ui = new UI;

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
            document.querySelector('#invisible_iframe').src = '/api/download/' + id;
            ui.status = `Downloading: <a href='${nico_url(localStorage['id'])}' target="_blank">${localStorage['title']}</a>`;
            ui.disabled = false;
        })
        .catch((e) => {
            ui.error = 'Something went wrong; Try again; ' + e;
            ui.disabled = false;
        });
    }
};