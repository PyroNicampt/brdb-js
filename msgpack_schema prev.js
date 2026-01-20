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

    let readNumeric = typeId => {
        const schemaType = typeId.charAt(0);
        const schemaAccuracy = Number(typeId.substring(1));
        let outputNum = 0;
        const typeByte = mpsData.at(ptr++);

        if((typeByte & 0x80) === 0x00){ //positive fixint
            outputNum = typeByte & 0x7f;
        }else if((typeByte & 0xe0) === 0xe0){ //negative fixint
            if(schemaType == 'u') throw Errors.NumMismatch(ptr-1, 'negative fixint', typeId);
            outputNum = typeByte & 0b11111;
        }else if(typeByte === 0xcc){ //uint8
            outputNum = mpsData.at(ptr++);
        }else if(typeByte === 0xcd){ //uint16
            if((schemaType == 'u' && schemaAccuracy < 16) || (schemaType == 'i' && schemaAccuracy < 32)) throw Errors.NumMismatch(ptr-1, 'uint16', typeId);
            outputNum = mpsData.readUInt16BE(ptr);
            ptr += 2;
        }else if(typeByte === 0xce){ //uint32
            if((schemaType == 'u' && schemaAccuracy < 32) || (schemaType == 'i' && schemaAccuracy < 64) || (schemaType == 'f' && schemaAccuracy < 64)) throw Errors.NumMismatch(ptr-1, 'uint32', typeId);
            outputNum = mpsData.readUInt32BE(ptr);
            ptr += 4;
        }else if(typeByte === 0xcf){ //uint64
            if((schemaType == 'u' && schemaAccuracy < 64) || schemaType == 'i' || schemaType == 'f') throw Errors.NumMismatch(ptr-1, 'uint64', typeId);
            outputNum = mpsData.readBigUint64BE(ptr);
            ptr += 8;
        }else if(typeByte === 0xd0){ //int8
            if(schemaType == 'u') throw Errors.NumMismatch(ptr-1, 'int8', typeId);
            outputNum = mpsData.readInt8(ptr++);
        }else if(typeByte === 0xd1){ //int16
            if(schemaType == 'u' || (schemaType == 'i' && schemaAccuracy < 16)) throw Errors.NumMismatch(ptr-1, 'int16', typeId);
            outputNum = mpsData.readInt16BE(ptr);
            ptr += 2;
        }else if(typeByte === 0xd2){ //int32
            if(schemaType == 'u' || (schemaType == 'i' && schemaAccuracy < 32) || (schemaType == 'f' && schemaAccuracy < 64)) throw Errors.NumMismatch(ptr-1, 'int32', typeId);
            outputNum = mpsData.readInt32BE(ptr);
            ptr += 4;
        }else if(typeByte === 0xd3){ //int64
            if(schemaType == 'u' || (schemaType == 'i' && schemaAccuracy < 64) || schemaType == 'f') throw Errors.NumMismatch(ptr-1, 'int64', typeId);
            outputNum = mpsData.readBigInt64BE(ptr);
            ptr += 8;
        }else if(typeByte == 0xca){ //float32
            if(schemaType != 'f') throw Errors.NumMismatch(ptr-1, 'float32', typeId);
            outputNum = mpsData.readFloatBE(ptr);
            ptr += 4;
        }else if(typeByte == 0xcb){ //float64
            if(schemaType != 'f' || schemaAccuracy < 64) throw Errors.NumMismatch(ptr-1, 'float64', typeId);
            outputNum = mpsData.readDoubleBE(ptr);
            ptr += 8;
        }else{
            throw Errors.NumMismatch(ptr-1, '0x'+typeByte.toString(16), typeId);
        }
        return outputNum;
    }

    let readData = typeId => {
        let result = null;
        console.log(typeId)
        switch(typeId){
            case 'bool':
                if(mpsData.at(ptr) === 0xc2){
                    result = false;
                }else if(mpsData.at(ptr) === 0xc3){
                    result = true;
                }else{
                    throw(Errors.Mismatch(ptr, 'Data not a bool'));
                }
                break;
            case 'u8':
            case 'u16':
            case 'u32':
            case 'u64':
            case 'i8':
            case 'i16':
            case 'i32':
            case 'i64':
            case 'f32':
            case 'f64':
                result = readNumeric(typeId);
                break;
            case 'object':
            case 'class':
                result = readNumeric('i32');
                break;
            case 'str':
                let strLength = 0;
                ptr++;
                if((mpsData.at(ptr-1) & 0xe0) === 0xa0){ //fixstr
                    strLength = mpsData.at(ptr-1) & 0b11111;
                }else if(mpsData.at(ptr-1) === 0xd9){ //str8
                    strLength = mpsData.at(ptr);
                    ptr ++;
                }else if(mpsData.at(ptr-1) === 0xda){ //str16
                    strLength = mpsData.readUInt16BE(ptr);
                    ptr += 2;
                }else if(mpsData.at(ptr-1) === 0xdb){ //str32
                    strLength = mpsData.readUInt32BE(ptr);
                    ptr += 4;
                }else{
                    throw(Errors.Mismatch(ptr-1, 'Data not a string (fixstr, str8, str16, str32)'));
                }
                
                result = mpsData.toString('utf8', ptr, ptr+strLength);
                ptr += strLength;
                break;
            default:
                if(enums[typeId]) throw(Errors.Unimplemented());
                
                const thisStruct = structs[typeId];
                if(!thisStruct) throw(Errors.NotFound(typeId));
                result = {};
                
                for(let property in thisStruct){
                    result[property] = readData(thisStruct[property]);
                }

                break;
        }
        return result;
    };

    let readStruct = structData => {
        //Basically, turn the array and type check shit into its own function, then call that when reading a new struct in the readData function.
        let structOutput = []; 
        for(let entry in structData){
            if(Array.isArray(structData[entry])){
                if(structData[entry].length > 1){ //Flat array, binary blob, little endian.
                    //output[entry] = `Flat Array of ${soa[entry][0]}`;
                    if(mpsData.at(ptr) === 0xc4 || mpsData.at(ptr) === 0xc5 || mpsData.at(ptr) === 0xc6){
                        ptr++;
                        let binLength = 0;
                        if(mpsData.at(ptr-1) === 0xc5){ //bin16
                            binLength = mpsData.readUint16BE(ptr);
                            ptr += 2;
                        }else if(mpsData.at(ptr-1) === 0xc6){ //bin32
                            binLength = mpsData.readUint32BE(ptr);
                            ptr += 4;
                        }else{ //bin8
                            binLength = mpsData.at(ptr);
                            ptr ++;
                        }
                        output[entry] = mpsData.subarray(ptr, ptr + binLength);
                        ptr += binLength;
                    }else{
                        throw(Errors.Mismatch(ptr, 'Data not a byte array (bin8, bin16, bin32)'));
                    }
                }else{ //Array Element Type.
                    //output[entry] = `Array of ${soa[entry][0]}`;
                    console.log('0x'+mpsData.at(ptr).toString(16).padStart(2, '0'));
                    if((mpsData.at(ptr) & 0xf0) === 0x90 || mpsData.at(ptr) === 0xdc || mpsData.at(ptr) === 0xdd){
                        ptr++;
                        let arrLength = 0;
                        if(mpsData.at(ptr-1) === 0xdc){ //array16
                            arrLength = mpsData.readUint16BE(ptr);
                            ptr += 2;
                        }else if(mpsData.at(ptr-1) === 0xdd){ //array32
                            arrLength = mpsData.readUint32BE(ptr);
                            ptr += 4;
                        }else{ //fixarray
                            arrLength = mpsData.at(ptr-1) & 0b1111;
                        }
                        output[entry] = [];
                        for(let i=0; i<arrLength; i++){
                            output[entry].push(readData(soa[entry][0]));
                        }
                    }else{
                        throw(Errors.Mismatch(ptr, 'Data not an array (fixarray, array16, array32)'));
                    }
                }
            }else{ //Simple Type.
                //output[entry] = soa[entry];
                output[entry] = readData(soa[entry]);
            }
        }
    }

    /*const soa = structs[soaKey];
    for(let entry in soa){
        if(Array.isArray(soa[entry])){
            if(soa[entry].length > 1){ //Flat array, binary blob, little endian.
                //output[entry] = `Flat Array of ${soa[entry][0]}`;
                if(mpsData.at(ptr) === 0xc4 || mpsData.at(ptr) === 0xc5 || mpsData.at(ptr) === 0xc6){
                    ptr++;
                    let binLength = 0;
                    if(mpsData.at(ptr-1) === 0xc5){ //bin16
                        binLength = mpsData.readUint16BE(ptr);
                        ptr += 2;
                    }else if(mpsData.at(ptr-1) === 0xc6){ //bin32
                        binLength = mpsData.readUint32BE(ptr);
                        ptr += 4;
                    }else{ //bin8
                        binLength = mpsData.at(ptr);
                        ptr ++;
                    }
                    output[entry] = mpsData.subarray(ptr, ptr + binLength);
                    ptr += binLength;
                }else{
                    throw(Errors.Mismatch(ptr, 'Data not a byte array (bin8, bin16, bin32)'));
                }
            }else{ //Array Element Type.
                //output[entry] = `Array of ${soa[entry][0]}`;
                console.log('0x'+mpsData.at(ptr).toString(16).padStart(2, '0'));
                if((mpsData.at(ptr) & 0xf0) === 0x90 || mpsData.at(ptr) === 0xdc || mpsData.at(ptr) === 0xdd){
                    ptr++;
                    let arrLength = 0;
                    if(mpsData.at(ptr-1) === 0xdc){ //array16
                        arrLength = mpsData.readUint16BE(ptr);
                        ptr += 2;
                    }else if(mpsData.at(ptr-1) === 0xdd){ //array32
                        arrLength = mpsData.readUint32BE(ptr);
                        ptr += 4;
                    }else{ //fixarray
                        arrLength = mpsData.at(ptr-1) & 0b1111;
                    }
                    output[entry] = [];
                    for(let i=0; i<arrLength; i++){
                        output[entry].push(readData(soa[entry][0]));
                    }
                }else{
                    throw(Errors.Mismatch(ptr, 'Data not an array (fixarray, array16, array32)'));
                }
            }
        }else{ //Simple Type.
            //output[entry] = soa[entry];
            output[entry] = readData(soa[entry]);
        }
        //console.log(output);
    }*/
    
    console.log('OUTPUT:\n', output);

    /*
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
        
    }*/
    
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

function readFileRaw(mpsData, schemaData){
    let rawSchema = msgpack.decode(schemaData);
    console.log('SCHEMA:\n', JSON.stringify(rawSchema, null, 2));

    let data = [];
    for(let object of msgpack.decodeMulti(mpsData)){
        data.push(object);
    }
    
    console.log('DATA:\n\n', JSON.stringify(data));
}

exports.readFile = readFileRaw;