'use strict';

import fs from 'node:fs';
import path from 'node:path';

import {read as BrzRead} from './brz.js';
import {read as BrdbRead} from './brdb.js';
import { withinTimestamp } from './virtual_filesystem.js';
import Profiler from './profiler.js';

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
                    if(!withinTimestamp(folder, timestamp)) continue;
                    fs.mkdirSync(outputFolder + '/' + saveFile.buildPath(folder.parent_id, folder.name), {recursive:true});
                }
                let dumpFiles = [];
                for(let file of saveFile.files){
                    if(!file) continue;
                    if(!withinTimestamp(file, timestamp)) continue;
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
                    if(!withinTimestamp(folder, timestamp)) continue;
                    fs.mkdirSync(outputFolder + '/' + saveFile.buildPath(folder.parent_id, folder.name), {recursive:true});
                }
                let rawDumpFiles = [];
                let mpsDumpFiles = [];
                for(let file of saveFile.files){
                    if(!file) continue;
                    if(!withinTimestamp(file, timestamp)) continue;
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
                console.log(`\nTotals for ${owners.length} players in ${saveFile.name}:\n Entities: ${totals.entityCount}\n Components: ${totals.componentCount}\n Wires: ${totals.wireCount}\n Bricks: ${totals.brickCount}`);
            })();
            break;
        case 'bundle':
            (() => {
                const bundleFile = saveFile.findFile('Meta/Bundle.json', 'Meta', null);
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
                const bundleFile = saveFile.findFile('Meta/Bundle.json', null);
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
                Profiler.start('mapper');
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
                let progressCurrent = 0;
                let progressTotal = 0;
                let progressReport = () => {
                    if(progressTotal <= 0) return;
                    progressCurrent++;
                    if(progressCurrent % 1000 == 0){
                        console.log(`${progressCurrent}/${progressTotal} > ${Math.floor(progressCurrent/progressTotal * 1000)/10}%`);
                    }
                };
                let resetProgress = total => {
                    progressTotal = total;
                    progressCurrent = 0;
                }

                console.log('Preloading revision blobs...');
                saveFile.loadBlobs(timestamp);
                console.log('Loading Owners and Entities...');

                let data = {
                    version: 1,
                    owners: saveFile.readMps('World/0/Owners.mps', timestamp),
                    entities: saveFile.readMps('World/0/Entities/Chunks/0_0_0.mps', timestamp),
                };
                for(let i=0; i<data.owners.UserIds.length; i++){
                    data.owners.UserIds[i] = (
                        data.owners.UserIds[i].A.toString(16).padStart(8,'0') +
                        data.owners.UserIds[i].B.toString(16).padStart(8,'0') +
                        data.owners.UserIds[i].C.toString(16).padStart(8,'0') +
                        data.owners.UserIds[i].D.toString(16).padStart(8,'0'))
                        .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/g, '$1-$2-$3-$4-$5');
                }
                if(data.entities){
                    console.log("Reading Entities...");
                    let entCount = data.entities.PersistentIndices.length;
                    data.entities.WeldParentFlags = unpackFlags(data.entities.WeldParentFlags.Flags, entCount);
                    data.entities.PhysicsLockedFlags = unpackFlags(data.entities.PhysicsLockedFlags.Flags, entCount);
                    data.entities.PhysicsSleepingFlags = unpackFlags(data.entities.PhysicsSleepingFlags.Flags, entCount);
                    let tmp = 0;
                    for(let i in data.entities.ColorsAndAlphas){ //Swizzle the colors, since brickadia labels them wrong.
                        for(let j in data.entities.ColorsAndAlphas[i]){
                            tmp = data.entities.ColorsAndAlphas[i][j].R;
                            data.entities.ColorsAndAlphas[i][j].R = data.entities.ColorsAndAlphas[i][j].B;
                            data.entities.ColorsAndAlphas[i][j].B = tmp;
                        }
                    }
                }
                data.chunks = [];
                data.components = [];

                const chunkIndexRegex = /World\/0\/Bricks\/Grids\/(?<grid>\d+)\/ChunkIndex\.mps/;
                let filteredComponents = ['BrickComponentType_WireGraphPseudo_BufferTicks', 'BrickComponentType_WireGraphPseudo_BufferSeconds'];
                
                let transformBrickCoords = (relativePosition, grid, chunkIndex, chunkOffset, chunkSize) => {
                    let pos = {
                        x: relativePosition.X + (chunkIndex.X) * chunkSize + 0.5*chunkSize + chunkOffset.X,
                        y: relativePosition.Y + (chunkIndex.Y) * chunkSize + 0.5*chunkSize + chunkOffset.Y,
                        z: relativePosition.Z + (chunkIndex.Z) * chunkSize + 0.5*chunkSize + chunkOffset.Z,
                    };
                    if(grid == 1){
                        return pos;
                    }
                    let entIndex = data.entities.PersistentIndices.findIndex(v => v == grid);
                    if(entIndex == -1) return null;

                    let rot = {
                        w: data.entities.Rotations[entIndex].W,
                        x: data.entities.Rotations[entIndex].X,
                        y: data.entities.Rotations[entIndex].Y,
                        z: data.entities.Rotations[entIndex].Z,
                    };
                    rot = Object.assign(rot, {
                        ww: rot.w * rot.w,
                        xx: rot.x * rot.x,
                        yy: rot.y * rot.y,
                        zz: rot.z * rot.z,
                        wx: rot.w * rot.x,
                        wy: rot.w * rot.y,
                        wz: rot.w * rot.z,
                        xy: rot.x * rot.y,
                        xz: rot.x * rot.z,
                        yz: rot.y * rot.z,
                    });

                    pos = {
                        x:
                            rot.ww*pos.x
                            + 2*rot.wy*pos.z
                            - 2*rot.wz*pos.y
                            + rot.xx*pos.x
                            + 2*rot.xy*pos.y
                            + 2*rot.xz*pos.z
                            - rot.zz*pos.x
                            - rot.yy*pos.x,
                        y:
                            2*rot.xy*pos.x
                            + rot.yy*pos.y
                            + 2*rot.yz*pos.z
                            + 2*rot.wz*pos.x
                            - rot.zz*pos.y
                            + rot.ww*pos.y
                            - 2*rot.wx*pos.z
                            - rot.xx*pos.y,
                        z:
                            2*rot.xz*pos.x
                            + 2*rot.yz*pos.y
                            + rot.zz*pos.z
                            - 2*rot.wy*pos.x
                            - rot.yy*pos.z
                            + 2*rot.wx*pos.y
                            - rot.xx*pos.z
                            + rot.ww*pos.z
                    };

                    pos.x += data.entities.Locations[entIndex].X;
                    pos.y += data.entities.Locations[entIndex].Y;
                    pos.z += data.entities.Locations[entIndex].Z;

                    return pos;
                };

                console.log('Parsing through files...');
                resetProgress(saveFile.files.length);
                for(let file of saveFile.files){
                    progressReport();
                    if(!file) continue;
                    if(!withinTimestamp(file, timestamp)) continue;
                    let path = saveFile.buildPath(file.parent_id, file.name);
                    let matchData = chunkIndexRegex.exec(path);
                    if(matchData){
                        let grid = Number(matchData.groups.grid);
                        let chunkIndex = saveFile.readMps(path);
                        for(let cIndex=0; cIndex<chunkIndex.Chunk3DIndices.length; cIndex++){
                            if(grid == 1){
                                data.chunks.push({
                                    position:{
                                        x: chunkIndex.Chunk3DIndices[cIndex].X,
                                        y: chunkIndex.Chunk3DIndices[cIndex].Y,
                                        z: chunkIndex.Chunk3DIndices[cIndex].Z,
                                    },
                                    offset:{
                                        x: chunkIndex.ChunkOffsets[cIndex].X,
                                        y: chunkIndex.ChunkOffsets[cIndex].Y,
                                        z: chunkIndex.ChunkOffsets[cIndex].Z,
                                    },
                                    size: chunkIndex.ChunkSizes[cIndex],
                                    brickCount: chunkIndex.NumBricks[cIndex],
                                    componentCount: chunkIndex.NumComponents[cIndex],
                                    wireCount: chunkIndex.NumWires[cIndex],
                                });
                            }

                            if(chunkIndex.NumComponents[cIndex] > 0){
                                let componentPath = `World/0/Bricks/Grids/${grid}/Components/${chunkIndex.Chunk3DIndices[cIndex].X}_${chunkIndex.Chunk3DIndices[cIndex].Y}_${chunkIndex.Chunk3DIndices[cIndex].Z}.mps`;
                                let components = saveFile.readMps(componentPath);
                                let bricks = saveFile.readMps(componentPath.replaceAll('/Components/', '/Chunks/'));
                                if(!components){
                                    //console.log(`Grid ${grid} has no corresponding component data at ${cIndex}: ${componentPath}`);
                                    continue;
                                }
                                if(!bricks){
                                    //console.log(`Grid ${grid} has no corresponding component data at ${cIndex}: ${componentPath.replaceAll('/Components/', '/Chunks/')}`);
                                    continue;
                                }
                                if(!components.instances) throw new Error(`Grid ${grid} has no instance array initialized at ${cIndex}: ${componentPath}`);

                                for(let inst=0; inst<components.instances.length; inst++){
                                    if(!components.instances[inst]) continue;
                                    if(filteredComponents.includes(components.instances[inst].name)){
                                        let brickIndex = components.ComponentBrickIndices[inst];
                                        components.instances[inst].position = transformBrickCoords(
                                            bricks.RelativePositions[brickIndex],
                                            grid,
                                            chunkIndex.Chunk3DIndices[cIndex],
                                            chunkIndex.ChunkOffsets[cIndex],
                                            chunkIndex.ChunkSizes[cIndex]
                                        );
                                        if(!components.instances[inst].position){
                                            console.log(`No component data for grid ${grid}`);
                                            continue;
                                        }
                                        components.instances[inst].owner = bricks.OwnerIndices[brickIndex];
                                        components.instances[inst].grid = grid;
                                        data.components.push(components.instances[inst]);
                                    }
                                }
                            }
                        }
                    }
                }
                Profiler.end('mapper', 1, 's');
                console.log('Writing...');
                fs.mkdirSync('./dump', {recursive:true});
                fs.writeFileSync(`dump/${saveFile.name}_mapper.json`, stringifyPlus(data, null, 2));
                console.log(`Wrote to dump/${saveFile.name}_mapper.json`);
            })();
    }
}

function stringifyPlus(data, replacer, space){
    const process = input => {
        switch(typeof(input)){
            case 'number':
                if(isNaN(input)) return 'splus_NaN';
                if(input == Infinity) return 'splus_Infinity';
                if(input == -Infinity) return 'splus_-Infinity';
                return input;
            case 'bigint':
                return 'splus_'+input.toString()+'n';
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