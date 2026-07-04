'use strict';

import msgpack from '@msgpack/msgpack';

const utfEncoder = new TextEncoder();

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
        return new Error(`No Struct/Enum of name ${schemaType} found in schema`);
    },
    BadSchema: (keyName, schemaData) => {
        return new Error(`Bad schema data at "${keyName}":\n${JSON.stringify(schemaData, null, 4)}`);
    },
    Invalid: (msgpackType) => {
        return new Error(`${msgpack} is invalid for mps`);
    },
    OutOfBounds: (value, type) => {
        return new Error(`Value is too big for ${type}: 0x${value.toString(16)}`);
    },
    WriteOOB: (type, data) => {
        return new Error(`Value out of bounds for ${type}: ${data}`);
    },
    WrongType: (type, data) => {
        return new Error(`Data is not valid for ${type}: ${data}`);
    },
}

// mpack, the library brickadia uses for serializing/deserializing msgpack doesn't check lower bounds on
// unsigned integer types and writes *whatever* type it wants to. This is cursed and I hate it.
// This goes against the point of having a standard.
// To "support" this behavior, I've removed the lower bounds checks,
// and just allow any msgpack integer to work with any integer type because fuckit.
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
    'anyinteger': ['positive fixint', 'negative fixint', 'int 8', 'uint 8', 'int 16', 'uint 16', 'int 32', 'uint 32', 'int 64', 'uint 64'],
    'f32': ['positive fixint', 'negative fixint', 'int 8', 'uint 8', 'int 16', 'uint 16', 'float 32'],
    'f64': ['positive fixint', 'negative fixint', 'int 8', 'uint 8', 'int 16', 'uint 16', 'int 32', 'uint 32', 'float 32', 'float 64'],
    'str': ['fixstr', 'str 8', 'str 16', 'str 32'],
    
    'array': ['fixarray', 'array 16', 'array 32'],
    'flat array': ['bin 8', 'bin 16', 'bin 32'],
};
const trueTypeCompat = {}; //This will hold the *actual* type compatibilities, regardless of mpack's weird behavior
for(let type in typeCompat){
    trueTypeCompat[type] = typeCompat[type];
}
for(let type of ['u8', 'u16', 'u32', 'u64', 'i8', 'i16', 'i32', 'i64']){ //Thank you, mpack.
    typeCompat[type] = typeCompat['anyinteger'];
}
typeCompat['object'] = typeCompat['i32'];
typeCompat['class'] = typeCompat['i32'];

export const extraDataModes = {
    'Entity': {schemaTest:/World\/\d\/Entities\/ChunksShared\.schema/},
    'Component': {schemaTest:/World\/\d\/Bricks\/ComponentsShared\.schema/}
}

const FLOAT_MAX_VALUE = 340282346638528859811704183484516925440.0;
const boundsCheckFunctions = {
    'i8': v => v >= -128 && v <= 127,
    'u8': v => v <= 255,
    'i16': v => v >= -32768 && v <= 32767,
    'u16': v => v <= 65535,
    'i32': v => v >= -2147483648 && v <= 2147483647,
    'u32': v => v <= 4294967295,
    'i64': v => v >= -0x8000000000000000n && v <= 0x7fffffffffffffffn,
    'u64': v => v <= 0xffffffffffffffffn,
    'f32': v => v >= -FLOAT_MAX_VALUE && v <= FLOAT_MAX_VALUE,
    'f64': v => v >= -Number.MAX_VALUE && v <= Number.MAX_VALUE,
}
const trueBoundsCheckFunctions = {
    'i8': v => v >= -128 && v <= 127,
    'u8': v => v <= 255 && v >= 0,
    'i16': v => v >= -32768 && v <= 32767,
    'u16': v => v <= 65535 && v >= 0,
    'i32': v => v >= -2147483648 && v <= 2147483647,
    'u32': v => v <= 4294967295 && v >= 0,
    'i64': v => v >= -0x8000000000000000n && v <= 0x7fffffffffffffffn,
    'u64': v => v <= 0xffffffffffffffffn && v >= 0,
    'f32': v => v >= -FLOAT_MAX_VALUE && v <= FLOAT_MAX_VALUE,
    'f64': v => v >= -Number.MAX_VALUE && v <= Number.MAX_VALUE,
}
boundsCheckFunctions['object'] = boundsCheckFunctions['i32'];
boundsCheckFunctions['class'] = boundsCheckFunctions['i32'];

/**
 * 
 * @param {Buffer} mpsData Raw bytes of mps file. If null, will only return converted schema data.
 * @param {Buffer} schemaData Raw bytes of schema file.
 * @param {Object} globalData Converted GlobalData.
 * @param {String} dataMode If defined, used for reading instance data out of files.
 * @param {String} structOverride If defined, will use this struct from the schema instead of the SoA.
 */
export function readFile(mpsData, schemaData, globalData, dataMode, structOverride){
    if(!schemaData) throw new Error('No schema data provided for Mps Decode');
    let rawSchema = msgpack.decode(schemaData);
    if(!mpsData) return {schema: rawSchema};
    
    //console.log('SCHEMA:\n', JSON.stringify(rawSchema, null, 2));

    let enums;
    let variants;
    let structs;
    if(rawSchema.length == 2){
        enums = rawSchema[0];
        variants = {};
        structs = rawSchema[1];
    }else if(rawSchema.length == 3){
        enums = rawSchema[0];
        variants = rawSchema[1];
        structs = rawSchema[2];
    }else{
        throw new Error(`Invalid array count in schema: ${rawSchema.length}\nDid the format update?`);
    }

    let soaKey;
    if(structOverride){
        if(structs[structOverride]) soaKey = structOverride;
        else throw new Error(`Struct Override Error: No struct named ${structOverride} in schema`);
    }else{
        for(let key in structs){
            if(key.endsWith('SoA')){
                soaKey = key;
                break;
            }
        }
        if(!soaKey) throw new Error('No Structure of Arrays key found');
    }

    let output = {};
    let ptr = 0; // Data Pointer, where in the .mps file we're currently reading from.
    
    const typecheck = (schemaType, mpsType) => {
        if(schemaType && !typeCompat[schemaType].includes(mpsType)) throw Errors.Mismatch(ptr-1, schemaType, mpsType);
    };
    const boundcheck = (value, schemaType) => {
        if(!boundsCheckFunctions[schemaType]) throw Errors.Unimplemented(`Bound check for ${schemaType}`);
        if(!boundsCheckFunctions[schemaType](value)) throw Errors.OutOfBounds(value, schemaType);
        return value;
    };

    const readSimpleType = type => {
        //console.log('0x'+ptr.toString(16).padStart(2,'0'), type);
        if(type && !typeCompat[type]) throw new Error(`Unknown schema type ${type}`);
        const mpsType = mpsData.at(ptr++);
        let result;
        let size = 0;
        if(mpsType <= 0x7f){
            typecheck(type, 'positive fixint');
            result = boundcheck(mpsType, type);
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
            result = boundcheck(mpsData.readUInt8(ptr), type);
        }else if(mpsType == 0xcd){
            typecheck(type, 'uint 16');
            size = 2;
            result = boundcheck(mpsData.readUInt16BE(ptr), type);
        }else if(mpsType == 0xce){
            typecheck(type, 'uint 32');
            size = 4;
            result = boundcheck(mpsData.readUInt32BE(ptr), type);
        }else if(mpsType == 0xcf){
            typecheck(type, 'uint 64');
            size = 8;
            result = boundcheck(mpsData.readBigUInt64BE(ptr), type);
        }else if(mpsType == 0xd0){
            typecheck(type, 'int 8');
            size = 1;
            result = boundcheck(mpsData.readInt8(ptr), type);
        }else if(mpsType == 0xd1){
            typecheck(type, 'int 16');
            size = 2;
            result = boundcheck(mpsData.readInt16BE(ptr), type);
        }else if(mpsType == 0xd2){
            typecheck(type, 'int 32');
            size = 4;
            result = boundcheck(mpsData.readInt32BE(ptr), type);
        }else if(mpsType == 0xd3){
            typecheck(type, 'int 64');
            size = 8;
            result = boundcheck(mpsData.readBigInt64BE(ptr), type);
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
            size = 2 + mpsData.readUInt16BE(ptr);
            result = mpsData.toString('utf8', ptr + 2, ptr + size);
        }else if(mpsType == 0xdb){
            typecheck(type, 'str 32');
            size = 4 + mpsData.readUInt32BE(ptr);
            result = mpsData.toString('utf8', ptr + 4, ptr + size);
        }else if(mpsType == 0xdc){
            typecheck(type, 'array 16');
            //Result is length of array, as array is handled in readData.
            size = 2;
            result = mpsData.readUInt16BE(ptr);
        }else if(mpsType == 0xdd){
            typecheck(type, 'array 32');
            //Result is length of array, as array is handled in readData.
            size = 4;
            result = mpsData.readUInt32BE(ptr);
        }else if(mpsType == 0xde){
            throw Errors.Unimplemented('read map 16');
        }else if(mpsType == 0xdf){
            throw Errors.Unimplemented('read map 32');
        }else{
            typecheck(type, 'negative fixint');
            //result = boundcheck(-(mpsType & 0x1f), type);
            result = boundcheck(mpsData.readInt8(ptr-1), type);
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
                if(data == 'object'){
                    result = globalData.ExternalAssetReferences[result];
                }else if(data == 'class'){
                    //Classes not fully implemented.
                    result = 'class #'+result;
                }
            }else if(enums[data]){
                let enumValue = readSimpleType('u64');
                for(let enumOption in enums[data]){
                    if(enums[data][enumOption] == enumValue){
                        result = enumOption.replaceAll(/^.+::(.+)$/g, '$1');
                        enumValue = null;
                        break;
                    }
                }
                if(enumValue != null) throw new Error(`Value ${enumValue} invalid for enum ${data}`);
            }else if(structs[data]){
                result = readData(structs[data]);
            }else if(data == 'wire_graph_variant'){ //TODO: Find proper documentation of this
                let variantType = readData('u64');
                switch(variantType){
                    case 0:
                        result = readData('f64');
                        break;
                    case 1:
                        result = readData('i64');
                        break;
                    case 2:
                        result = readData('bool');
                        break;
                    case 3:
                        result = 'unknown';
                        //console.log('found unknown wiregraph variant'); //why is this unknown in the rust library?
                        break;
                    case 4:
                        result = 'Exec';
                        //console.log('found exec wiregraph variant');
                        break;
                    default:
                        console.log('0x'+ptr.toString(16))
                        throw Errors.Unimplemented(`wire_graph_variant=${variantType}`);
                }
            }else if(data == 'wire_graph_prim_math_variant'){
                let variantType = readData('u64');
                switch(variantType){
                    case 0:
                        result = readData('f64');
                        break;
                    case 1:
                        result = readData('i64');
                        break;
                    default:
                        console.log('0x'+ptr.toString(16))
                        throw Errors.Unimplemented(`wire_graph_prim_math_variant=${variantType}`);
                }
            }else if(data == 'bundle_path_ref'){
                result = readData('str');
            }else if(variants[data]){
                let variantType = variants[data][readSimpleType('i32')];
                result = readData(variantType);
            }else{
                console.log('0x'+ptr.toString(16))
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

    output = {schema: rawSchema, data:readData(structs[soaKey])};

    if(globalData && dataMode){
        switch(dataMode){
            case 'Entity':
                output.data.instances = [];
                for(let typeCounter of output.data.TypeCounters){
                    for(let i=0; i<typeCounter.NumEntities; i++){
                        let instance = readData(structs[globalData.EntityDataClassNames[typeCounter.TypeIndex]]);
                        instance.name = globalData.EntityTypeNames[typeCounter.TypeIndex];
                        instance.class = globalData.EntityDataClassNames[typeCounter.TypeIndex];
                        output.data.instances.push(instance);
                    }
                }
                break;
            case 'Component':
                output.data.instances = [];
                for(let typeCounter of output.data.ComponentTypeCounters){
                    for(let i=0; i<typeCounter.NumInstances; i++){
                        if(globalData.ComponentDataStructNames[typeCounter.TypeIndex] == 'None'){
                            output.data.instances.push(null);
                            continue;
                        }
                        let instance = readData(structs[globalData.ComponentDataStructNames[typeCounter.TypeIndex]]);
                        instance.name = globalData.ComponentTypeNames[typeCounter.TypeIndex];
                        instance.class = globalData.ComponentDataStructNames[typeCounter.TypeIndex];
                        output.data.instances.push(instance);
                    }
                }
                break;
            default:
                console.log(`Unhandled data mode ${dataMode}`);
                break;
        }
    }

    if(ptr < mpsData.length) console.log(`WARNING: Read incomplete in ${soaKey}, read ${ptr-1}/${mpsData.length} - 0x${ptr.toString(16)}`);//out of',mpsData.length, 'in',soaKey);
    return output;

    //console.log('OUTPUT:\n', output);
}

export function readFileRaw(mpsData, schemaData){
    let rawSchema = msgpack.decode(schemaData);
    //console.log('SCHEMA:\n', JSON.stringify(rawSchema, null, 2));

    let data = [];
    for(let object of msgpack.decodeMulti(mpsData)){
        data.push(object);
    }
    
    //console.log('DATA:\n', JSON.stringify(data));
    return {schema:rawSchema, data:data};
}

export function writeFile(mpsData, schema){
    let soaKey;
    for(let key in schema[1]){
        if(key.endsWith('SoA')){
            soaKey = key;
            break;
        }
    }
    if(!soaKey) throw new Error('No Structure of Arrays key found');

    let outputBuff = Buffer.alloc(128);
    let ptr = 0;
    const checkBufferSpace = () => {
        if(ptr >= outputBuff.length * 0.5){
            let newBuff = Buffer.alloc(outputBuff.length * 2);
            outputBuff.copy(newBuff);
            outputBuff = newBuff;
            //console.log(`Reallocating buffer: ${outputBuff.length}`);
        }
    };

    let isSigned = false;
    let compat;
    let strLength = 0;
    const writeNumeric = (type, data) => {
        if(typeof(data) != 'bigint' && typeof(data) != 'number') throw Errors.WrongType(type, data);
        if(typeof(data) == 'bigint' && data < Number.MAX_SAFE_INTEGER && data > Number.MIN_SAFE_INTEGER)
            data = Number(data);
        isSigned = type.startsWith('i') || type.startsWith('f');
        compat = trueTypeCompat[type];
        if(typeof(data) == 'number' && data % 1 != 0){
            if(data >= -FLOAT_MAX_VALUE && data <= FLOAT_MAX_VALUE && compat.includes('float 32')){
                ptr = outputBuff.writeUInt8(0xca, ptr);
                ptr = outputBuff.writeFloatBE(data, ptr);
                return;
            }else if(compat.includes('float 64')){
                ptr = outputBuff.writeUInt8(0xcb, ptr);
                ptr = outputBuff.writeDoubleBE(data, ptr+1);
                return;
            }
            throw Errors.WrongType(type, data);
        }else if(data >= 0){
            if(data <= 127){ // 'positive fixint' is compatible with everything
                ptr = outputBuff.writeUInt8(data, ptr);
                return;
            }
            if(data <= 255 && compat.includes('uint 8')){
                ptr = outputBuff.writeUInt8(0xcc, ptr);
                ptr = outputBuff.writeUInt8(data, ptr);
                return;
            }
            if(isSigned && data <= 32767 && compat.includes('int 16')){
                ptr = outputBuff.writeUInt8(0xd1, ptr);
                ptr = outputBuff.writeInt16BE(data, ptr);
                return;
            }
            if(data <= 65535 && compat.includes('uint 16')){
                ptr = outputBuff.writeUInt8(0xcd, ptr);
                ptr = outputBuff.writeUInt16BE(data, ptr);
                return;
            }
            if(isSigned && data <= 2147483647 && compat.includes('int 32')){
                ptr = outputBuff.writeUInt8(0xd2, ptr);
                ptr = outputBuff.writeInt32BE(data, ptr);
                return;
            }
            if(data <= 4294967295 && compat.includes('uint 32')){
                ptr = outputBuff.writeUInt8(0xce, ptr);
                ptr = outputBuff.writeUInt32BE(data, ptr);
                return;
            }
            if(isSigned && data <= 0x7fffffffffffffffn && compat.includes('int 64')){
                ptr = outputBuff.writeUInt8(0xd3, ptr);
                ptr = outputBuff.writeBigInt64BE(data, ptr);
                return;
            }
            if(data <= 0xffffffffffffffffn && compat.includes('uint 64')){
                ptr = outputBuff.writeUInt8(0xcf, ptr);
                ptr = outputBuff.writeBigUInt64BE(data, ptr);
                return;
            }
            throw Errors.WrongType(type, data);
        }else if(isSigned){
            if(data >= -32 && compat.includes('negative fixint')){
                ptr = outputBuff.writeUInt8(data, ptr);
                return;
            }
            if(data >= -128 && compat.includes('int 8')){
                ptr = outputBuff.writeUInt8(0xd0, ptr);
                ptr = outputBuff.writeInt8(data, ptr);
                return;
            }
            if(data >= -32768 && compat.includes('int 16')){
                ptr = outputBuff.writeUInt8(0xd1, ptr);
                ptr = outputBuff.writeInt16BE(data, ptr);
                return;
            }
            if(data >= -2147483648 && compat.includes('int 32')){
                ptr = outputBuff.writeUInt8(0xd2, ptr);
                ptr = outputBuff.writeInt32BE(data, ptr);
                return;
            }
            if(data >= -0x8000000000000000n && compat.includes('int 64')){
                ptr = outputBuff.writeUInt8(0xd3, ptr);
                ptr = outputBuff.writeBigInt64BE(data, ptr);
                return;
            }
            throw Errors.WrongType(type, data);
        }else{
            throw new Error(`Value ${data} is negative but ${type} is unsigned`);
        }
    };
    const writeType = (type, data) => {
        checkBufferSpace();
        //console.log(`Writing ${data} (${type}) : ${ptr} / 0x${ptr.toString(16)}`);
        switch(type){
            case 'bool':
                if(data) ptr = outputBuff.writeUInt8(0xc3);
                else ptr = outputBuff.writeUInt8(0xc2);
                break;
            case 'str':
                if(typeof(data) != 'string') throw Errors.WrongType(type, data);
                strLength = utfEncoder.encode(data).byteLength;
                if(strLength < 31){
                    ptr = outputBuff.writeUInt8(0xa0 | strLength, ptr);
                    ptr += outputBuff.write(data, ptr, 'utf8');
                }else if(strLength < 255){
                    ptr = outputBuff.writeUInt8(0xd9, ptr);
                    ptr = outputBuff.writeUInt8(strLength, ptr);
                    ptr += outputBuff.write(data, ptr, 'utf8');
                }else if(strLength < 65535){
                    ptr = outputBuff.writeUInt8(0xda, ptr);
                    ptr = outputBuff.writeUInt16BE(strLength, ptr);
                    ptr += outputBuff.write(data, ptr, 'utf8');
                }else if(strLength < 4294967295){
                    ptr = outputBuff.writeUInt8(0xdb, ptr);
                    ptr = outputBuff.writeUInt32BE(strLength, ptr);
                    ptr += outputBuff.write(data, ptr, 'utf8');
                }else{
                    throw new Error('String too large!');
                }
                break;
            case 'array':
                if(data < 15){
                    ptr = outputBuff.writeUInt8(0x90 | data, ptr);
                }else if(data < 65535){
                    ptr = outputBuff.writeUInt8(0xdc, ptr);
                    ptr = outputBuff.writeUInt16BE(data, ptr);
                }else if(data < 4294967295){
                    ptr = outputBuff.writeUInt8(0xdd, ptr);
                    ptr = outputBuff.writeUInt32BE(data, ptr);
                }else{
                    throw new Error('Array too large!');
                }
                break;
            case 'flat array':
                if(data < 255){
                    ptr = outputBuff.writeUInt8(0xc4, ptr);
                    ptr = outputBuff.writeUInt8(data, ptr);
                }else if(data < 65535){
                    ptr = outputBuff.writeUInt8(0xc5, ptr);
                    ptr = outputBuff.writeUInt16BE(data, ptr);
                }else if(data < 4294967295){
                    ptr = outputBuff.writeUInt8(0xc6, ptr);
                    ptr = outputBuff.writeUInt32BE(data, ptr);
                }else{
                    throw new Error(`Flat array too large! (${data})`);
                }
                break;
            case 'object':
            case 'class':
                writeNumeric('i32', data);
                break;
            default:
                if(type.startsWith('u') || type.startsWith('i') || type.startsWith('f')){
                    writeNumeric(type, data);
                }else{
                    throw Errors.Unimplemented(`Type of ${type}: ${data}`);
                }
        }
        //console.log(outputBuff);
    };
    const getRawTypeSize = (type) => {
        switch(type){
            case 'bool':
            case 'str':
            case 'object':
            case 'class':
                console.log('Cannot get size for raw type: ' + type);
                return 0;
            case 'u8':
            case 'i8':
                return 1;
            case 'u16':
            case 'i16':
                return 2;
            case 'u32':
            case 'i32':
            case 'f32':
                return 4;
            case 'u64':
            case 'i64':
            case 'f64':
                return 8;
            default:
                if(schema[0][type]){
                    console.log('Cannot get raw size for enum: ' + type);
                    return 0;
                }else if(schema[1][type]){
                    let size = 0;
                    for(let key in schema[1][type]){
                        size += getRawTypeSize(schema[1][type][key]);
                    }
                    return size;
                }else{
                    throw Errors.NotFound(type);
                }
        }
    };
    const writeRawType = (type, data) => {
        checkBufferSpace();
        //console.log(`Writing ${data} (${type}) : ${ptr} / 0x${ptr.toString(16)}`);
        if(boundsCheckFunctions[type] && !boundsCheckFunctions[type](data)) throw Errors.WriteOOB(type, data);
        switch(type){
            case 'bool':
            case 'str':
            case 'object':
            case 'class':
                throw Errors.Unimplemented('Write Raw '+type);
            case 'u8':
                ptr = outputBuff.writeUInt8(data, ptr);
                break;
            case 'u16':
                ptr = outputBuff.writeUInt16LE(data, ptr);
                break;
            case 'u32':
                ptr = outputBuff.writeUInt32LE(data, ptr);
                break;
            case 'u64':
                ptr = outputBuff.writeBigUInt64LE(data, ptr);
                break;
            case 'i8':
                ptr = outputBuff.writeInt8(data, ptr);
                break;
            case 'i16':
                ptr = outputBuff.writeInt16LE(data, ptr);
                break;
            case 'i32':
                ptr = outputBuff.writeInt32LE(data, ptr);
                break;
            case 'i64':
                ptr = outputBuff.writeBigInt64LE(data, ptr);
                break;
            case 'f32':
                ptr = outputBuff.writeFloatLE(data, ptr);
                break;
            case 'f64':
                ptr = outputBuff.writeDoubleLE(data, ptr);
                break;
            default:
                if(schema[0][type]){
                    throw Errors.Unimplemented('Write Raw Enums');
                }else if(schema[1][type]){
                    for(let key in schema[1][type]){
                        writeRawType(schema[1][type][key], data[key]);
                    }
                }else{
                    throw Errors.NotFound(type);
                }
        }
        //console.log(outputBuff);
    };

    const writeData = (data, structure) => {
        //console.log(data);
        //console.log(structure);
        if(typeof(structure) == 'object'){
            for(let entry in structure){
                if(Array.isArray(structure[entry])){
                    if(structure[entry].length > 2){
                        throw Errors.BadSchema(entry, structure[entry]);
                    }else if(structure[entry].length == 2){ // Flat Array
                        writeType('flat array', getRawTypeSize(structure[entry][0]) * data[entry].length);
                        for(let i=0; i<data[entry].length; i++){
                            writeRawType(structure[entry][0], data[entry][i]);
                        }
                    }else{ // Array
                        writeType('array', data[entry].length);
                        for(let i=0; i<data[entry].length; i++){
                            writeType(structure[entry][0], data[entry][i]);
                        }
                    }
                }else{
                    throw Errors.Unimplemented('Non-Array Structure Value');
                }
                checkBufferSpace();
            }
        }
    };

    writeData(mpsData, schema[1][soaKey]);

    return outputBuff.subarray(0, ptr);
}