'use strict';

const msgpack = require('@msgpack/msgpack');

const Errors = {
    Mismatch: (offset, expectedData, recievedData, extraInfo) => {
        return new Error(`Mismatch between schema(${expectedData}) and data(${recievedData}) at 0x${offset.toString(16)}` + (extraInfo ? ': '+ extraInfo : ''));
    },
    Unimplemented: (extraInfo) => {
        return new Error('Not Implemented' + (extraInfo ? ': '+ extraInfo : ''));
    },
    NumMismatch: (offset, dataType, schemaType) => {
        return new Error(`Mismatch between schema and data at 0x${offset.toString(16)}: ${dataType} is incompatible with schema ${schemaType}`);
    },
    NotFound: (schemaType) => {
        return new Error(`No Struct of name ${schemaType} found in schema`);
    },
    BadSchema: (keyName, schemaData) => {
        return new Error(`Bad schema data at "${keyName}":\n${JSON.stringify(schemaData, null, 4)}`);
    },
    Invalid: (msgpackType) => {
        return new Error(`${msgpack} is invalid for mps`);
    }
}

const typeCompat = {
    'bool': ['true', 'false'],
    'u8': ['positive fixint', 'uint 8'],
    'u16': ['positive fixint', 'uint 8', 'uint 16'],
    'u32': ['positive fixint', 'uint 8', 'uint 16', 'uint 32'],
    'u64': ['positive fixint', 'uint 8', 'uint 16', 'uint 32', 'uint 64'],
    'i8': ['positive fixint', 'negative fixint', 'int 8'],
    'i16': ['positive fixint', 'negative fixint', 'int 8', 'uint 8', 'int 16'],
    'i32': ['positive fixint', 'negative fixint', 'int 8', 'uint 8', 'int 16', 'uint 16', 'int 32'],
    'i64': ['positive fixint', 'negative fixint', 'int 8', 'uint 8', 'int 16', 'uint 16', 'int 32', 'uint 32', 'int 64'],
    'f32': ['positive fixint', 'negative fixint', 'int 8', 'uint 8', 'int 16', 'uint 16', 'float 32'],
    'f64': ['positive fixint', 'negative fixint', 'int 8', 'uint 8', 'int 16', 'uint 16', 'int 32', 'uint 32', 'float 32', 'float 64'],
    'str': ['fixstr', 'str 8', 'str 16', 'str 32'],
    'object': ['i32'],
    'class': ['i32'],
    
    'array': ['fixarray', 'array 16', 'array 32'],
    'flat array': ['bin 8', 'bin 16', 'bin 32'],
};

/**
 * 
 * @param {Buffer} mpsData 
 * @param {Buffer} schemaData 
 */
function readFile(mpsData, schemaData){
    if(!schemaData) throw new Error('No schema data provided for Mps Decode');
    let rawSchema = msgpack.decode(schemaData);
    if(!mpsData) return {schema: rawSchema};
    
    //console.log('SCHEMA:\n', JSON.stringify(rawSchema, null, 2));

    let enums = rawSchema[0];
    let structs = rawSchema[1];

    let soaKey = Object.keys(structs)[Object.keys(structs).length-1];

    let output = {};
    let ptr = 0; // Data Pointer, where in the .mps file we're currently reading from.
    
    const typecheck = (schemaType, mpsType) => {
        if(schemaType && !typeCompat[schemaType].includes(mpsType)) throw Errors.Mismatch(ptr-1, schemaType, mpsType);
    };
    const readSimpleType = type => {
        //console.log('0x'+ptr.toString(16).padStart(2,'0'), type);
        if(type && !typeCompat[type]) throw new Error(`Unknown schema type ${type}`);
        const mpsType = mpsData.at(ptr++);
        let result;
        let size = 0;
        if(mpsType <= 0x7f){
            typecheck(type, 'positive fixint');
            result = mpsType;
        }else if(mpsType <= 0x8f){
            throw Errors.Unimplemented('read fixmap');
        }else if(mpsType <= 0x9f){
            typecheck(type, 'fixarray');
            //Result is length of array, as array is handled in readData.
            result = mpsType & 0x0f;
        }else if(mpsType <= 0xbf){
            typecheck(type, 'fixstr');
            size = mpsType & 0x1f;
            result = mpsData.toString('utf8', ptr, ptr + size);
        }else if(mpsType == 0xc0){
            throw Errors.Unimplemented('read nil');
        }else if(mpsType == 0xc1){
            throw Errors.Invalid('(never used)');
        }else if(mpsType == 0xc2){
            typecheck(type, 'false');
            result = false;
        }else if(mpsType == 0xc3){
            typecheck(type, 'true');
            result = true;
        }else if(mpsType == 0xc4){
            typecheck(type, 'bin 8');
            //Result is length of flat array, as flat array is handled in readData.
            size = 1;
            result = mpsData.readUInt8(ptr);
        }else if(mpsType == 0xc5){
            typecheck(type, 'bin 16');
            //Result is length of flat array, as flat array is handled in readData.
            size = 2;
            result = mpsData.readUInt16BE(ptr);
        }else if(mpsType == 0xc6){
            typecheck(type, 'bin 32');
            //Result is length of flat array, as flat array is handled in readData.
            size = 4;
            result = mpsData.readUInt32BE(ptr);
        }else if(mpsType == 0xc7){
            throw Errors.Invalid('ext 8');
        }else if(mpsType == 0xc8){
            throw Errors.Invalid('ext 16');
        }else if(mpsType == 0xc9){
            throw Errors.Invalid('ext 32');
        }else if(mpsType == 0xca){
            typecheck(type, 'float 32');
            size = 4;
            result = mpsData.readFloatBE(ptr);
        }else if(mpsType == 0xcb){
            typecheck(type, 'float 64');
            size = 8;
            result = mpsData.readDoubleBE(ptr);
        }else if(mpsType == 0xcc){
            typecheck(type, 'uint 8');
            size = 1;
            result = mpsData.readUInt8(ptr);
        }else if(mpsType == 0xcd){
            typecheck(type, 'uint 16');
            size = 2;
            result = mpsData.readUInt16BE(ptr);
        }else if(mpsType == 0xce){
            typecheck(type, 'uint 32');
            size = 4;
            result = mpsData.readUInt32BE(ptr);
        }else if(mpsType == 0xcf){
            typecheck(type, 'uint 64');
            size = 8;
            result = mpsData.readBigUInt64BE(ptr);
        }else if(mpsType == 0xd0){
            typecheck(type, 'int 8');
            size = 1;
            result = mpsData.readInt8(ptr);
        }else if(mpsType == 0xd1){
            typecheck(type, 'int 16');
            size = 2;
            result = mpsData.readInt16BE(ptr);
        }else if(mpsType == 0xd2){
            typecheck(type, 'int 32');
            size = 4;
            result = mpsData.readInt32BE(ptr);
        }else if(mpsType == 0xd3){
            typecheck(type, 'int 64');
            size = 8;
            result = mpsData.readBigInt64BE(ptr);
        }else if(mpsType == 0xd4){
            throw Errors.Invalid('fixext 1');
        }else if(mpsType == 0xd5){
            throw Errors.Invalid('fixext 2');
        }else if(mpsType == 0xd6){
            throw Errors.Invalid('fixext 4');
        }else if(mpsType == 0xd7){
            throw Errors.Invalid('fixext 8');
        }else if(mpsType == 0xd8){
            throw Errors.Invalid('fixext 16');
        }else if(mpsType == 0xd9){
            typecheck(type, 'str 8');
            size = 1 + mpsData.readUInt8(ptr);
            result = mpsData.toString('utf8', ptr + 1, ptr + size);
        }else if(mpsType == 0xda){
            typecheck(type, 'str 16');
            size = 2 + mpsData.readUInt16(ptr);
            result = mpsData.toString('utf8', ptr + 2, ptr + size);
        }else if(mpsType == 0xdb){
            typecheck(type, 'str 32');
            size = 4 + mpsData.readUInt32(ptr);
            result = mpsData.toString('utf8', ptr + 4, ptr + size);
        }else if(mpsType == 0xdc){
            typecheck(type, 'array 16');
            //Result is length of array, as array is handled in readData.
            size = 2;
            result = mpsData.readUint16BE(ptr);
        }else if(mpsType == 0xdd){
            typecheck(type, 'array 32');
            //Result is length of array, as array is handled in readData.
            size = 4;
            result = mpsData.readUint32BE(ptr);
        }else if(mpsType == 0xde){
            throw Errors.Unimplemented('read map 16');
        }else if(mpsType == 0xdf){
            throw Errors.Unimplemented('read map 32');
        }else{
            typecheck(type, 'negative fixint');
            result = -(mpsType & 0x1f);
        }
        ptr += size;
        return result;
    }
    const readRawType = type => {
        if(typeof(type) != 'string') throw Errors.Unimplemented(`Type of ${type}`);
        let result;
        let size = 0;
        // I'm not familiar enough with C to know how "A direct memory dump of the contents using standard C struct alignment" would look for some of these.
        // This needs to be fleshed out more in the future.
        switch(type){
            case 'bool': //I'd assume bools to be 0x00 meaning false and 0x01 to mean true, but I don't know for sure.
            case 'str': //How are string lengths stored? Are they null terminated?
            case 'object': //Objects and classes are said to serialize to i32 compatible, but nothing on if that works with flat arrays.
            case 'class':
                throw Errors.Unimplemented('Raw '+type);
            case 'u8':
                size = 1;
                result = mpsData.readUInt8(ptr);
                break;
            case 'u16':
                size = 2;
                result = mpsData.readUInt16LE(ptr);
                break;
            case 'u32':
                size = 4;
                result = mpsData.readUInt32LE(ptr);
                break;
            case 'u64':
                size = 8;
                result = mpsData.readBigUInt64LE(ptr);
                break;
            case 'i8':
                size = 1;
                result = mpsData.readInt8(ptr);
                break;
            case 'i16':
                size = 2;
                result = mpsData.readInt16LE(ptr);
                break;
            case 'i32':
                size = 4;
                result = mpsData.readInt32LE(ptr);
                break;
            case 'i64':
                size = 8;
                result = mpsData.readBigInt64LE(ptr);
                break;
            case 'f32':
                size = 4;
                result = mpsData.readFloatLE(ptr);
                break;
            case 'f64':
                size = 8;
                result = mpsData.readDoubleLE(ptr);
                break;
            default:
                if(enums[type]){
                    //Would enums be stored in a flat array???
                    throw Errors.Unimplemented('Raw Enums');
                }else if(structs[type]){
                    result = {};
                    for(let key in structs[type]){
                        result[key] = readRawType(structs[type][key]);
                    }
                }
                break;
        }
        ptr += size;
        return result;
    }

    let indx = 0;
    const readData = data => {
        let result = {};
        if(typeof(data) == 'string'){
            if(typeCompat[data]){
                result = readSimpleType(data);
            }else if(enums[data]){
                throw Errors.Unimplemented('enum');
            }else if(structs[data]){
                //console.log(structs[data]);
                result = readData(structs[data]);
                /*for(let key in structs[data]){
                    result[key] = readData(structs[data][key]);
                }*/
            }else{
                throw Errors.NotFound(data);
            }
        }else if(typeof(data) == 'object'){
            for(let entry in data){
                if(Array.isArray(data[entry])){
                    if(data[entry].length > 2){
                        throw Errors.BadSchema(entry, data[entry]);
                    }else if(data[entry].length == 2){
                        let arrayLength = readSimpleType('flat array');
                        //let arrayStructure = data[entry][0];
                        result[entry] = [];
                        let ptrStart = ptr;
                        while(ptr < ptrStart + arrayLength){
                            result[entry].push(readRawType(data[entry][0]));
                        }
                    }else{
                        let arrayLength = readSimpleType('array');
                        result[entry] = [];
                        for(let i=0; i<arrayLength; i++){
                            result[entry].push(readData(data[entry][0]));
                        }
                    }
                }else{
                    result[entry] = readData(data[entry]);
                    //console.log(data[entry]);
                    //throw Errors.Unimplemented('Maps?'); //I think this would be a map?
                }
            }
        }else{
            throw new Error('Tried to read unknown type: '+typeof(data));
        }
        return result;
    }

    return {schema: rawSchema, data:readData(structs[soaKey])};

    //console.log('OUTPUT:\n', output);
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