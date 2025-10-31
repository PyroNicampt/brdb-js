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
    console.log('SCHEMA:\n\n', JSON.stringify(rawSchema, null, 2));


    let enums = rawSchema[0];
    let structs = rawSchema[1];

    let soaKey = Object.keys(structs)[Object.keys(structs).length-1];
    
    let data = [];
    for(let object of msgpack.decodeMulti(mpsData)){
        data.push(object);
    }
    
    console.log('DATA:\n\n', data);

    let output = [];
    let dataIndex = 0;
    let buildData = (schemaInput) => {
        switch(typeof(schemaInput)){
            case 'string':
                
                break;
            case 'object':
                if(Array.isArray(schemaInput)){
                    
                }else{
                    
                }
                break;
            default:
                console.log(`unhandled datatype ${typeof(schemaInput)} for ${schemaInput}`);
        }
    };
    for(let soaObj in structs[soaKey]){
        
    }
    
    /*
    console.log(schema);
    console.log(Object.keys(schema[structureOfArrays]));
    console.log(structureOfArrays);
    //console.log(msgpack.decode(mpsData))
    for(let object of msgpack.decodeMulti(mpsData)){
        console.log(object,',');
    }//*/
    /*
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
    return output;
    //*/
}

exports.readFile = readFile;