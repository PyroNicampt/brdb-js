'use strict';

const msgpack = require('@msgpack/msgpack');

const Errors = {
    Mismatch: (offset, extraInfo) => {
        return new Error(`Mismatch between schema and data at 0x${offset.toString(16)}: ` + extraInfo);
    },
    Unimplemented: () => {
        return new Error('Not Implemented');
    },
    NumMismatch: (offset, dataType, schemaType) => {
        return new Error(`Mismatch between schema and data at 0x${offset.toString(16)}: ${dataType} is incompatible with schema ${schemaType}`);
    },
    NotFound: (schemaType) => {
        return new Error(`No Struct of name ${schemaType} found in schema`);
    }
}

/**
 * 
 * @param {Buffer} mpsData 
 * @param {Buffer} schemaData 
 */
function readFile(mpsData, schemaData){
    let rawSchema = msgpack.decode(schemaData);
    console.log('SCHEMA:\n', JSON.stringify(rawSchema, null, 2));

    let enums = rawSchema[0];
    let structs = rawSchema[1];

    let soaKey = Object.keys(structs)[Object.keys(structs).length-1];
    
    let output = [];
    let ptr = 0; // Data Pointer, where in the .mps file we're currently reading from.

    const readData = data => {
        let result = [];
        for(let entry in data){
            console.log(data[entry]);
            if(Array.isArray(data[entry])){
                if(data[entry].length > 1){ // Flat array, binary blob, little endian
                    
                }else{ // Standard Array

                }
            }else{ // Simple Types
                
            }
        }
    }

    readData(soaKey);

    console.log('OUTPUT:\n', output);
}

function readFileRaw(mpsData, schemaData){
    let rawSchema = msgpack.decode(schemaData);
    //console.log('SCHEMA:\n', JSON.stringify(rawSchema, null, 2));

    let data = [];
    for(let object of msgpack.decodeMulti(mpsData)){
        data.push(object);
    }
    
    //console.log('DATA:\n', JSON.stringify(data));
    return {schema:rawSchema, data:data};
}

exports.readFile = readFile;
exports.readFileRaw = readFileRaw;