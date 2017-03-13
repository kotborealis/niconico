module.exports = (n) => new Proxy(new Array(n), {
    get(target, prop){
        if(prop === 'push'){
            target.shift();
        }
        return Reflect.get(target, prop);
    }
});