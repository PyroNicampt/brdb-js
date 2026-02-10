'use strict';

const fs = require('fs');
const path = require('path');

const BrzRead = require('./brz').read;
const BrdbRead = require('./brdb').read;

let operations = ['stats'];
let targetFile = './world.brdb';

if(process.argv.length > 2){
    targetFile = process.argv[2];
    if(process.argv.length > 3){
        operations = process.argv.slice(3);
    }
}

if(!fs.existsSync(targetFile)){
    console.log(`File does not exist:\n'${targetFile}'`);
    process.exit();
}
const targetExtension = path.extname(targetFile);

let saveFile = null;
switch(targetExtension){
    case '.brdb':
        console.log('Reading BRDB...');
        saveFile = BrdbRead(targetFile);
        break;
    case '.brz':
        console.log('Reading BRZ...');
        saveFile = BrzRead(targetFile);
        break;
    default:
        console.log(`Incorrect filetype, must be .brdb or .brz:\n${targetFile}`);
        process.exit();
}

let revisionNumber = null;
let timestamp = saveFile.getTimestampFromRevision(null);

for(let operation of operations){
    switch(operation.split('=')[0]){
        case 'revision':
            revisionNumber = Number.parseInt(operation.split('=')[1]);
            timestamp = saveFile.getTimestampFromRevision(revisionNumber);
            break;
        case 'stats':
            console.log('Stats Dump:\n', saveFile.getStats());
            break;
        case 'dumpraw':
            (() => {
                console.log(`Dumping ${saveFile.name}'s raw filesystem...`);
                let outputFolder = `./dump/raw/${saveFile.name}`;

                if(fs.existsSync(outputFolder)) fs.rmSync(outputFolder, {recursive:true});
                for(let folder of saveFile.folders){
                    if(!folder) continue;
                    if(folder.deleted_at != null && folder.deleted_at <= timestamp) continue;
                    if(folder.created_at != null && folder.created_at > timestamp) continue;
                    fs.mkdirSync(outputFolder + '/' + saveFile.buildPath(folder.parent_id, folder.name), {recursive:true});
                }
                let dumpFiles = [];
                for(let file of saveFile.files){
                    if(!file) continue;
                    if(file.deleted_at != null && file.deleted_at <= timestamp) continue;
                    if(file.created_at != null && file.created_at > timestamp) continue;
                    dumpFiles.push(file);
                }
                saveFile.loadBlobs(dumpFiles);
                for(let file of dumpFiles){
                    let path = saveFile.buildPath(file.parent_id, file.name);
                    fs.writeFileSync(outputFolder + '/' + path, file.blob.content, {encoding:null, flag:'w'});
                }

                console.log(`Dumped filesystem to ${outputFolder}`);
            })();
            break;
        case 'dump':
            (() => {
                console.log(`Converting and Dumping ${saveFile.name}'s filesystem...`);
                let outputFolder = `./dump/converted/${saveFile.name}`;

                if(fs.existsSync(outputFolder)){
                    console.log('Cleaning existing files...');
                    fs.rmSync(outputFolder, {recursive:true});
                }
                console.log('Gathering files...');
                for(let folder of saveFile.folders){
                    if(!folder) continue;
                    if(folder.deleted_at != null && folder.deleted_at <= timestamp) continue;
                    if(folder.created_at != null && folder.created_at > timestamp) continue;
                    fs.mkdirSync(outputFolder + '/' + saveFile.buildPath(folder.parent_id, folder.name), {recursive:true});
                }
                let rawDumpFiles = [];
                let mpsDumpFiles = [];
                for(let file of saveFile.files){
                    if(!file) continue;
                    if(file.deleted_at != null && file.deleted_at <= timestamp) continue;
                    if(file.created_at != null && file.created_at > timestamp) continue;
                    if(file.name.endsWith('.mps'))
                        mpsDumpFiles.push(file);
                    else if(!file.name.endsWith('.schema'))
                        rawDumpFiles.push(file);
                }
                saveFile.loadBlobs(rawDumpFiles);
                let dumpCounter = 0;
                let totalCount = rawDumpFiles.length + mpsDumpFiles.length;
                let dumpProgressReport = () => {
                    dumpCounter++;
                    if(dumpCounter % 100 == 0){
                        console.log(`Converted ${dumpCounter}/${totalCount} > ${Math.floor(dumpCounter/totalCount * 1000)/10}%`);
                    }
                };

                for(let file of rawDumpFiles){
                    let path = saveFile.buildPath(file.parent_id, file.name);
                    fs.writeFileSync(outputFolder + '/' + path, file.blob.content, {encoding:null, flag:'w'});
                    dumpProgressReport();
                }
                for(let file of mpsDumpFiles){
                    let data = saveFile.readMpsAndSchema(file, timestamp, true);
                    fs.writeFileSync(
                        outputFolder + '/' + saveFile.buildPath(data.files.mps.parent_id, data.files.mps.name) + '.json',
                        stringifyPlus(data.data, null, 2),
                        {encoding:'utf8', flag:'w'}
                    );
                    /*let schemaPath = outputFolder + '/' + saveFile.buildPath(data.files.schema.parent_id, data.files.schema.name) + '_' + data.files.schema.created_at + '.json';
                    if(fs.existsSync(schemaPath)) continue;
                    fs.writeFileSync(
                        schemaPath,
                        stringifyPlus(data.schema, null, 2),
                        {encoding:'utf8', flag:'w'}
                    );*/
                    dumpProgressReport();
                }
                console.log(`Converted and Dumped filesystem to ${outputFolder}`);
            })();
            break;
        case 'owners':
            (() => {
                let ownerData = saveFile.readMps('World/0/Owners.mps', timestamp);
                let owners = [];
                for(let i=0; i<ownerData.UserIds.length; i++){
                    owners[i] = {
                        userId:
                            ownerData.UserIds[i].A.toString(16).padStart(8,'0') +
                            ownerData.UserIds[i].B.toString(16).padStart(8,'0') +
                            ownerData.UserIds[i].C.toString(16).padStart(8,'0') +
                            ownerData.UserIds[i].D.toString(16).padStart(8,'0'),
                        userName: ownerData.UserNames[i],
                        displayName: ownerData.DisplayNames[i],
                        entityCount: ownerData.EntityCounts[i],
                        brickCount: ownerData.BrickCounts[i],
                        componentCount: ownerData.ComponentCounts[i],
                        wireCount: ownerData.WireCounts[i],
                    };
                    owners[i].userId = owners[i].userId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/g, '$1-$2-$3-$4-$5');
                    owners[i].formattedName = `${owners[i].displayName} (${owners[i].userName}) [${owners[i].userId}]`;
                }
    
                let totals = {
                    entityCount:0,
                    brickCount:0,
                    componentCount:0,
                    wireCount:0
                };
                owners.sort((a,b) => b.entityCount - a.entityCount);
                console.log('\nMost Entities:')
                for(let user of owners){
                    totals.entityCount += user.entityCount;
                    //if(user.entityCount < 10) continue;
                    if(user.entityCount == 0) break;
                    console.log(`${user.entityCount} > ${user.formattedName}`);
                }
                owners.sort((a,b) => b.componentCount - a.componentCount);
                console.log('\nMost Components:')
                for(let user of owners){
                    totals.componentCount += user.componentCount;
                    //if(user.componentCount < 500) continue;
                    if(user.componentCount == 0) break;
                    console.log(`${user.componentCount} > ${user.formattedName}`);
                }
                owners.sort((a,b) => b.wireCount - a.wireCount);
                console.log('\nMost Wires:')
                for(let user of owners){
                    totals.wireCount += user.wireCount;
                    //if(user.wireCount < 500) continue;
                    if(user.wireCount == 0) break;
                    console.log(`${user.wireCount} > ${user.formattedName}`);
                }
                owners.sort((a,b) => b.brickCount - a.brickCount);
                console.log('\nMost Bricks:')
                for(let user of owners){
                    totals.brickCount += user.brickCount;
                    //if(user.brickCount < 1000) continue;
                    if(user.brickCount == 0) break;
                    console.log(`${user.brickCount} > ${user.formattedName}`);
                }
                console.log(`\nTotals for ${saveFile.name}:\n Entities: ${totals.entityCount}\n Components: ${totals.componentCount}\n Wires: ${totals.wireCount}\n Bricks: ${totals.brickCount}`);
            })();
            break;
        case 'bundle':
            (() => {
                const bundleFile = saveFile.findFile('Bundle.json', 'Meta', null);
                if(!bundleFile){
                    console.log('No Bundle Found!');
                    return;
                }
                const bundle = JSON.parse(bundleFile.blob.content.toString());
                console.log(bundle);
            })();
            break;
        case 'description':
            (() => {
                const bundleFile = saveFile.findFile('Bundle.json', 'Meta', null);
                if(!bundleFile){
                    console.log('No Bundle Found!');
                    return;
                }
                const bundle = JSON.parse(bundleFile.blob.content.toString());
                console.log('Name');
                console.log(bundle.name);
                console.log('Description:');
                console.log(bundle.description);
            })();
            break;
        case 'mps':
            (() => {
                let target = operation.split('=')[1];
                if(target) target = target.replaceAll(/(^"|"$)/g, '');
                if(!target) console.log('Target required');
                let data = saveFile.readMps(target, timestamp);
                let targetPath = `dump/converted/${saveFile.name}/${target}` + '.json';
                fs.mkdirSync(path.dirname(targetPath), {recursive:true});
                fs.writeFileSync(targetPath, stringifyPlus(data, null, 2));
                console.log('Wrote to ' + targetPath);
            })();
            break;
        case 'mpsschema':
            (() => {
                let target = operation.split('=')[1];
                if(target) target = target.replaceAll(/(^"|"$)/g, '');
                if(!target) console.log('Target required');
                let data = saveFile.readSchema(target, timestamp, true);
                let targetPath = `dump/converted/${saveFile.name}/${saveFile.buildPath(data.file.parent_id, data.file.name)}` + '_' + data.file.created_at + '.json';
                fs.mkdirSync(path.dirname(targetPath), {recursive:true});
                fs.writeFileSync(targetPath, stringifyPlus({schema: data.data}, null, 2));
                console.log('Wrote to ' + targetPath);
            })();
            break;
        case 'mapper':
            (() => {
                let unpackFlags = (flags, length) => {
                    let unpack = [];
                    for(let flag of flags){
                        for(let i=0; i<8; i++){
                            unpack.push(((flag >> i) & 1) == 1);
                            length--;
                            if(length == 0) return unpack;
                        }
                    }
                    for(let i=0; i<length; i++){
                        unpack.push(false);
                    }
                    return unpack;
                };
                let data = {
                    owners: saveFile.readMps('World/0/Owners.mps', timestamp),
                    entities: saveFile.readMps('World/0/Entities/Chunks/0_0_0.mps', timestamp),
                };
                let entCount = data.entities.PersistentIndices.length;
                data.entities.WeldParentFlags = unpackFlags(data.entities.WeldParentFlags.Flags, entCount);
                data.entities.PhysicsLockedFlags = unpackFlags(data.entities.PhysicsLockedFlags.Flags, entCount);
                data.entities.PhysicsSleepingFlags = unpackFlags(data.entities.PhysicsSleepingFlags.Flags, entCount);
                for(let i=0; i<data.owners.UserIds.length; i++){
                    data.owners.UserIds[i] = (
                        data.owners.UserIds[i].A.toString(16).padStart(8,'0') +
                        data.owners.UserIds[i].B.toString(16).padStart(8,'0') +
                        data.owners.UserIds[i].C.toString(16).padStart(8,'0') +
                        data.owners.UserIds[i].D.toString(16).padStart(8,'0'))
                        .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/g, '$1-$2-$3-$4-$5');
                }
                let tmp = 0;
                for(let i in data.entities.ColorsAndAlphas){ //Swizzle the colors, since brickadia labels them wrong.
                    for(let j in data.entities.ColorsAndAlphas[i]){
                        tmp = data.entities.ColorsAndAlphas[i][j].R;
                        data.entities.ColorsAndAlphas[i][j].R = data.entities.ColorsAndAlphas[i][j].B;
                        data.entities.ColorsAndAlphas[i][j].B = tmp;
                    }
                }
                data.chunks = [];
                const chunkCoordRegex = /([0-9-]+)_([0-9-]+)_([0-9-]+).mps/;
                for(let file of saveFile.files){
                    if(!file) continue;
                    let path = saveFile.buildPath(file.parent_id, file.name);
                    if(path.startsWith('World/0/Bricks/Grids/1/Chunks/')){
                        let coordMatch = chunkCoordRegex.exec(file.name);
                        data.chunks.push({
                            position:{
                                x: Number(coordMatch[1]),
                                y: Number(coordMatch[2]),
                                z: Number(coordMatch[3]),
                            }
                        });
                    }
                }
                fs.writeFileSync(`dump/${saveFile.name}_mapper.json`, stringifyPlus(data, null, 2));
                console.log(`wrote to dump/${saveFile.name}_mapper.json`);
            })();
    }
}

function stringifyPlus(data, replacer, space){
    const process = input => {
        switch(typeof(input)){
            case 'number':
                if(isNaN(input)) return 'NaN';
                if(input == Infinity) return 'Infinity';
                if(input == -Infinity) return '-Infinity';
                return input;
            case 'object':
                for(let key in input){
                    input[key] = process(input[key]);
                }
                return input;
            case 'function':
                return undefined;
            default:
                return input;
        }
    };

    return JSON.stringify(process(data), replacer, space);
}