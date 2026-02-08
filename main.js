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
let timestamp = null;

for(let operation of operations){
    switch(operation.split('=')[0]){
        case 'revision':
            revisionNumber = Number.parseInt(operation.split('=')[1]);
            timestamp = saveFile.getTimestampFromRevision(revisionNumber);
            break;
        case 'stats':
            console.log('Stats Dump:\n', saveFile.getStats());
            break;
        case 'dump':
            console.log('Dumping filesystem...');
            saveFile.dump(null, timestamp);
            console.log('Dumped filesystem');
            break;
        case 'owners':
            let ownerData = saveFile.readMps('World/0/Owners.mps', timestamp);
            let owners = [];
            for(let i=0; i<ownerData.UserIds.length; i++){
                owners[i] = {
                    userId:
                        ownerData.UserIds[i].A.toString(16).padStart(2,'0') +
                        ownerData.UserIds[i].B.toString(16).padStart(2,'0') +
                        ownerData.UserIds[i].C.toString(16).padStart(2,'0') +
                        ownerData.UserIds[i].D.toString(16).padStart(2,'0'),
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
            console.log(`\nTotals:\n Entities: ${totals.entityCount}\n Components: ${totals.componentCount}\n Wires: ${totals.wireCount}\n Bricks: ${totals.brickCount}`);
            break;
        case 'bundle':
            const bundleFile = saveFile.findFile('Bundle.json', 'Meta', null);
            if(!bundleFile){
                console.log('No Bundle Found!');
                break;
            }
            const bundle = JSON.parse(bundleFile.blob.content.toString());
            console.log(bundle);
            break;
        case 'description':
            const bundleFile2 = saveFile.findFile('Bundle.json', 'Meta', null);
            if(!bundleFile2){
                console.log('No Bundle Found!');
                break;
            }
            const bundle2 = JSON.parse(bundleFile2.blob.content.toString());
            console.log('Name');
            console.log(bundle2.name);
            console.log('Description:');
            console.log(bundle2.description);
            break;
        case 'mps':
            let targetMps = operation.split('=')[1];
            if(targetMps) targetMps = targetMps.replaceAll(/(^"|"$)/g, '');
            if(!targetMps) console.log('Target required');
            let mpsData = saveFile.readMps(targetMps, timestamp);
            let mpsTargetPath = `dump/${saveFile.name}/${targetMps}`.replaceAll(/.mps$/g,'.json');
            fs.mkdirSync(path.dirname(mpsTargetPath), {recursive:true})
            fs.writeFileSync(mpsTargetPath, JSON.stringify(mpsData, null, 2));
            console.log('Wrote to ' + mpsTargetPath);
            break;
        case 'mpsschema':
            let targetSchema = operation.split('=')[1];
            if(targetSchema) targetSchema = targetSchema.replaceAll(/(^"|"$)/g, '');
            if(!targetSchema) console.log('Target required');
            let schemaData = saveFile.readSchema(targetSchema, timestamp);
            let schemaTargetPath = `dump/${saveFile.name}/${targetSchema}`.replaceAll(/.mps$/g,'.schema.json');
            fs.mkdirSync(path.dirname(schemaTargetPath), {recursive:true});
            fs.writeFileSync(schemaTargetPath, JSON.stringify({schema: schemaData}, null, 2));
            console.log('Wrote to ' + schemaTargetPath);
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
                    data.owners.UserIds[i] = (data.owners.UserIds[i].A.toString(16).padStart(2,'0') +
                        data.owners.UserIds[i].B.toString(16).padStart(2,'0') +
                        data.owners.UserIds[i].C.toString(16).padStart(2,'0') +
                        data.owners.UserIds[i].D.toString(16).padStart(2,'0'))
                        .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/g, '$1-$2-$3-$4-$5');
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
                fs.writeFileSync(`dump/${saveFile.name}_mapper.json`, JSON.stringify(data, null, 2));
                console.log(`wrote to dump/${saveFile.name}_mapper.json`);
            })();
    }
}