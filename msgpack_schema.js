'use strict';

const msgpack = require('@msgpack/msgpack');
const validTypes = [
    'bool',
    'u8', 'u16', 'u32', 'u64',
    'i8', 'i16', 'i32', 'i64',
    'f32', 'f64',
    'str',
];

function readFile(mpsData, schemaData){
    let rawSchema = msgpack.decode(schemaData);
    //console.log(JSON.stringify(rawSchema, null, 2));

    let structureOfArrays = null;
    let schema = null;
    for(let root of rawSchema){
        if(Object.keys(root).length == 0) continue;
        schema = root;
        break;
    }
    for(let structName in schema){
        if(structName.endsWith('SoA')) structureOfArrays = structName;
    }
    /*
    console.log(schema);
    console.log(Object.keys(schema[structureOfArrays]));
    console.log(structureOfArrays);
    //console.log(msgpack.decode(mpsData))
    for(let object of msgpack.decodeMulti(mpsData)){
        console.log(object,',');
    }//*/
    //*
    let data = [];
    for(let object of msgpack.decodeMulti(mpsData)){
        data.push(object);
    }

    let output = {};
    let dataIndex = 0;
    for(let soaObj in schema[structureOfArrays]){
        let soaTypes = schema[structureOfArrays][soaObj];
        if(validTypes.includes(soaTypes[0])){
            output[soaObj] = data[dataIndex];
        }else{
            console.log("Unknown Type", soaTypes);
            console.log(data[dataIndex]);
        }
        dataIndex++;
    }
    console.log(output);
    //*/
}

exports.readFile = readFile;