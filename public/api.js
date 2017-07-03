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

window.api = {
   fetch_info
};