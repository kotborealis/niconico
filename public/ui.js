const handler = {
    get(target, prop){
        switch(prop){
            case 'id':
                const value = document.querySelector('.nico-input').value;
                const match = value && value.match(/sm(\d+)/i);
                return match && match[1];
            case 'action':
                return [...document.querySelectorAll('.nico-action-group')].reduce((action, i) => i.checked ? i.value : action, null);
            default:
                return undefined;
        }
    },
    set(target, prop, value){
        switch(prop){
            case 'status':{
                const status = document.querySelector('.status');
                status.innerHTML = value;
                status.classList.remove('status--error');
                return value;
            }
            case 'error':{
                const status = document.querySelector('.status');
                status.innerHTML = value;
                status.classList.add('status--error');
                return value;
            }
            case 'onsubmit':{
                document.querySelector('#nico').addEventListener('submit', (event) => {
                   event.preventDefault();
                   value(event);
                });
                return value;
            }
            case 'disabled':{
                const disabled = !!value;
                document.querySelector('.nico-input').disabled = disabled;
                const submit = document.querySelector('.nico-submit');
                if(disabled){
                    submit.classList.add('nico-submit--disabled');
                }
                else{
                    submit.classList.remove('nico-submit--disabled');
                }
                return disabled;
            }
        }
    }
};

window.UI = function(){return new Proxy({}, handler);};