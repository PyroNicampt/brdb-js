'use strict';

import { Encoder, Decoder } from '@toondepauw/node-zstd';
import fs from 'node:fs';
import path, { dirname } from 'node:path';
//const zstdEncoder = new Encoder(3);
const zstdDecoder = new Decoder();
import { readFile as mpsReader, extraDataModes} from './msgpack_schema.js';

// .mps files in these folders usually are named by coordinates, and their .schema are named after the folder.
const sharedSchemaFolderNames = [
    'Chunks',
    'Components',
    'Wires',
];

export class VirtualFilesystem{
    name = '';
    folders = [];
    files = [];
    revisions = [];
    latestRevision = 0;

    globalData = [];

    cachedSchemas = {};
    cachedFindmaps = {};

    // Is overridden by file loaders to load blob data into the file objects.
    // When implementing a new filetype, at the very least overwrite with a noop function.
    // Can take in:
    // - a single file object
    // - a list of file objects,
    // - a timestamp (will load all blobs that match the timestamp)
    // - null (will load all blobs)
    loadBlobs = () => {throw new Error('loadBlobs not implemented for filetype')};

    addFile(fileData){
        this.files[fileData.file_id] = fileData;
    }
    addFolder(folderData){
        this.folders[folderData.folder_id] = folderData;
    }
    addRevision(revisionData){
        this.revisions[revisionData.revision_id] = revisionData;
        if(this.latestRevision == 0 || this.revisions[this.latestRevision].created_at < revisionData.created_at)
            this.latestRevision = revisionData.revision_id;
    }
    findFile(query, timestamp){
        if(!this.cachedFindmaps[timestamp]){
            this.cachedFindmaps[timestamp] = {};
            for(let i=0; i<this.files.length; i++){
                if(!this.files[i]) continue;
                if(!withinTimestamp(this.files[i], timestamp)) continue;
                this.cachedFindmaps[timestamp][this.buildPath(this.files[i].parent_id, this.files[i].name)] = this.files[i];
            }
        }
        return this.cachedFindmaps[timestamp][query];
    }
    findFiles(query, path){
        let results = [];
        let commonSkipConditions = file => {
            if(!file) return true;
            if(path === '' && file.parent_id != null) return true;
            if(path && this.buildPath(file.parent_id) !== path) return true;
        }
        switch(typeof(query)){
            case 'string':
                for(let file of this.files){
                    if(commonSkipConditions(file)) continue;
                    if(file.name == query) results.push(file);
                }
                break;
            case 'number':
                for(let file of this.files){
                    if(commonSkipConditions(file)) continue;
                    if(file.file_id == query) results.push(file);
                }
                break;
            case 'object':
                if(!query.test) break;
                for(let file of this.files){
                    if(commonSkipConditions(file)) continue;
                    if(query.test(file.name)) results.push(file);
                }
                break;
        }
        return results;
    }
    processBlob(blob){
        if(blob.processed) return blob;
        blob.processed = true;
        if(blob.compression == 0) return blob;
        blob.content = zstdDecoder.decodeSync(blob.content);
        return blob;
    }
    getStats(){
        return {
            fileName: this.name,
            fileCount: this.files.length-1,
            folderCount: this.folders.length-1,
            revisions: this.revisions.length-1,
        };
    }
    buildPath(startIndex, startFile = ''){
        let finalPath = startFile;
        let parent = startIndex;
        let iterations = 0;
        while(parent){
            if(finalPath == '') finalPath = this.folders[parent].name;
            else finalPath = this.folders[parent].name + '/' + finalPath;
            parent = this.folders[parent].parent_id;
            iterations++;
            if(iterations > 255) throw new Error(`Too many levels deep in folder id ${startIndex}`);
        }
        return finalPath;
    }

    readMps(mpsFile, timestamp, returnFile){
        let result = grabMpsSchema(this, mpsFile, timestamp, true, returnFile);
        if(!result) return;
        if(returnFile) return {
            file: result.files.mps,
            data: result.data
        };
        return result.data;
    }

    readSchema(mpsFile, timestamp, returnFile){
        let result = grabMpsSchema(this, mpsFile, timestamp, false, returnFile);
        if(!result) return;
        if(returnFile) return {
            file: result.files.schema,
            data: result.schema
        };
        return result.schema;
    }

    readMpsAndSchema(mpsFile, timestamp, returnFiles){
        return grabMpsSchema(this, mpsFile, timestamp, true, returnFiles);
    }

    getTimestampFromRevision(revision){
        return this.revisions[validateRevision(this, revision)].created_at;
    }

    getGlobalData = revision => getGlobalData(this, revision);
}

const gridRegex = /^World\/0\/Bricks\/Grids\/\d+\/(Chunks|Components|Wires|ChunkIndex)/;
function grabMpsSchema(vfs, mpsFile, timestamp, getMps, returnFiles = false){
    if(!timestamp) timestamp = vfs.revisions[vfs.latestRevision].created_at;
    let targetMps;
    let dirName;
    let fileName;
    let combinedName;
    if(typeof(mpsFile) == 'string'){
        if(!mpsFile.endsWith('.mps'))
            throw new Error(`${mpsFile} is not an .mps file`);
        dirName = path.dirname(mpsFile);
        fileName = path.basename(mpsFile, '.mps');
        combinedName = dirName + '/' + fileName;
        targetMps = vfs.findFile(combinedName + '.mps', timestamp);
    }else if(typeof(mpsFile) == 'object'){
        targetMps = mpsFile;
        dirName = vfs.buildPath(targetMps.parent_id, '');
        fileName = targetMps.name.replaceAll(/\.mps$/g, '');
        combinedName = dirName + '/' + fileName;
    }

    if(targetMps){
        //TODO: For some reason, the correct version of schema isn't being loaded
        let targetSchema;
        let gridMatch = gridRegex.exec(combinedName);
        if(gridMatch){
            if(vfs.cachedSchemas[targetMps.created_at] && vfs.cachedSchemas[targetMps.created_at][gridMatch[1]]){
                targetSchema = vfs.cachedSchemas[targetMps.created_at][gridMatch[1]];
            }else{
                if(!vfs.cachedSchemas[targetMps.created_at]) vfs.cachedSchemas[targetMps.created_at] = {};
                switch(gridMatch[1]){
                    case 'Chunks':
                    case 'Components':
                    case 'Wires':
                    case 'ChunkIndex':
                        vfs.cachedSchemas[targetMps.created_at][gridMatch[1]] = vfs.findFile(`World/0/Bricks/${gridMatch[1]}Shared.schema`, targetMps.created_at);
                        targetSchema = vfs.findFile(`World/0/Bricks/${gridMatch[1]}Shared.schema`, targetMps.created_at);
                        break;
                }
            }
        }
        if(!targetSchema){
            if(dirName == 'World/0/Entities/Chunks'){
                targetSchema = vfs.findFile('World/0/Entities/ChunksShared.schema', targetMps.created_at);
            }else{
                targetSchema = vfs.findFile(combinedName + '.schema', targetMps.created_at);
            }
        }
        //console.log(`Mps Ver: ${targetMps.created_at}, Schema Ver: ${targetSchema.created_at}\n\n`, vfs.cachedSchemas)
        if(!targetSchema) throw new Error(`No suitable .schema found for .mps: ${combinedName}`);
        //console.log(`Found ${vfs.buildPath(targetMps.parent_id, targetMps.name)} and ${vfs.buildPath(targetSchema.parent_id, targetSchema.name)}\nReading...`);
        
        let globalData;
        let dataMode;
        if(dirName+'/'+fileName != 'World/0/GlobalData'){
            let schemaPath = vfs.buildPath(targetSchema.parent_id, targetSchema.name);
            for(let dataModeCheck in extraDataModes){
                if(extraDataModes[dataModeCheck].schemaTest.test(schemaPath)){
                    dataMode = dataModeCheck;
                    globalData = getGlobalData(vfs, timestamp);
                    break;
                }
            }
        }

        try{
            let result;
            if(getMps){
                vfs.loadBlobs([targetMps, targetSchema]);
                try{
                result = mpsReader(targetMps.blob.content, targetSchema.blob.content, globalData, dataMode);
                }catch(e){
                    fs.writeFileSync('dump/broken.mps', targetMps.blob.content, {encoding:null, flag:'w'});
                    fs.writeFileSync('dump/broken.schema', JSON.stringify(mpsReader(null, targetSchema.blob.content).schema, null, 4), {encoding:'utf8'});
                    throw e;
                }
                if(returnFiles) result.files = {mps:targetMps, schema:targetSchema};
            }else{
                vfs.loadBlobs([targetSchema]);
                result = mpsReader(null, targetSchema.blob.content, globalData, dataMode);
                if(returnFiles) result.files = {schema:targetSchema};
            }
            return result;
        }catch(e){
            console.warn(`Failed to read ${dirName + '/' + fileName}`);
            throw e;
        }
    }
    return null;
}

function getGlobalData(vfs, timestamp){
    if(vfs.globalData.length == 0){
        vfs.globalData = vfs.findFiles('GlobalData.mps', 'World/0');
        if(!vfs.globalData) throw new Error('GlobalData.mps not found!');
        vfs.globalData.sort((a, b) => {
            a.created_at - b.created_at;
        });
    }
    for(let gData of vfs.globalData){
        if(withinTimestamp(gData, timestamp)){
            vfs.loadBlobs(gData);
            if(!gData.blob.converted)
                gData.blob.converted = vfs.readMps(gData);
            return gData.blob.converted;
        }
    }
}

function validateRevision(vfs, revision){
    if(revision == null || revision <= 0 || revision > vfs.revisions.length)
        return vfs.latestRevision;
    return revision;
}

function rotateSoA(mpsData){
    let newArray = [];
    for(let key in mpsData){
        let newKeyName = key.replaceAll(/s$/g, '');
        for(let i=0; i<mpsData[key].length; i++){
            if(newArray[i] == null) newArray[i] = {};
            newArray[i][newKeyName] = mpsData[key][i];
        }
    }
    return newArray;
}

export function withinTimestamp(item, timestamp){
    return (item.created_at == null || item.created_at <= timestamp) && (item.deleted_at == null || item.deleted_at > timestamp);
}