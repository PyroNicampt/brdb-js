
let averagingWindow = 250;
let averagingDelay = 10;
let defaultLoggingFrequency = 0;

let profilers = {
    0:{timer:0, average:null, saturation:0, log:0},
};
let profileValue = 0;
let enable = true;

let profileUnits = {
    'ns':{a:1n, b:1},
    'ms':{a:1000n, b:1000},
    "s":{a:1000000n, b:1000},
    "m":{a:60000000n, b:1000},
}

class ProfilerClass{
    start(id){
        if(!enable) return;
        id ??= 0;
        if(profilers[id] == null) this.reset(id);
        profilers[id].timer = process.hrtime.bigint();
    }

    startMany(ids){
        if(!enable) return;
        for(let id of ids)
            this.start(id);
    }

    reset(id){
        if(!enable) return;
        profilers[id ?? 0] = {
            timer: null,
            average: null,
            saturation: 0,
            log: 0,
        };
    }

    end(id, logFrequency, unit){
        if(!enable) return;
        id ??= 0;
        if(!profilers[id]) throw new Error('No profiler started with id ' + id);
        profilers[id].timer = process.hrtime.bigint() - profilers[id].timer;
        unit ??= 'ms';
        logFrequency ??= defaultLoggingFrequency;
        if(!profileUnits[unit]) throw new Error('Unknown profiling unit '+unit);

        profileValue = Number(profilers[id].timer / profileUnits[unit].a) / profileUnits[unit].b;
        profilers[id].log = (profilers[id].log + 1) % logFrequency;
        if(logFrequency <= 0 || profilers[id].log == 0){
            if(profilers[id].saturation < averagingWindow + averagingDelay){
                console.log(`Profiler "${id}" took ${profileValue}${unit}`);
                avg(profileValue, id);
            }else
                console.log(`Profiler "${id}" took ${profileValue}${unit}, average of ${Math.floor(avg(profileValue, id)*profileUnits[unit].b)/profileUnits[unit].b}${unit}`);
        }else{
            avg(profileValue, id);
        }
        profilers[id].timer = process.hrtime.bigint();
    }

    setDefaultLoggingFrequency(frequency){
        defaultLoggingFrequency = frequency;
    }
}

function avg(newValue, id){
    if(profilers[id].saturation >= averagingDelay){
        if(!profilers[id].average) profilers[id].average = newValue;
        else{
            profilers[id].average -= profilers[id].average / averagingWindow;
            profilers[id].average += newValue / averagingWindow;
        }
    }
    profilers[id].saturation++;
    return profilers[id].average;
}

const Profiler = new ProfilerClass();
export default Profiler;