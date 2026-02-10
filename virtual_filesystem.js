'use strict';

import { Encoder, Decoder } from '@toondepauw/node-zstd';
import fs from 'node:fs';
import path from 'node:path';
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

    //Override with a function to take in a single file object or a list of them and give them their blobs.
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
    findFile(query, path, timestamp){
        let results = this.findFiles(query, path);
        if(!results) return null;
        results.sort((a, b) => {
            a.created_at - b.created_at;
        });
        if(!timestamp) timestamp = this.revisions[this.latestRevision].created_at;

        for(let i=results.length-1; i>=0; i--){
            if(withinTimestamp(results[i], timestamp)){
                return results[i];
            }
        }
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
        if(returnFile) return {
            file: result.files.mps,
            data: result.data
        };
        return result.data;
    }

    readSchema(mpsFile, timestamp, returnFile){
        let result = grabMpsSchema(this, mpsFile, timestamp, false, returnFile);
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
}

function grabMpsSchema(vfs, mpsFile, timestamp, getMps, returnFiles = false){
    let targetMps;
    let dirName;
    let fileName;
    if(typeof(mpsFile) == 'string'){
        if(!mpsFile.endsWith('.mps'))
            throw new Error(`${mpsFile} is not an .mps file`);
        dirName = path.dirname(mpsFile);
        fileName = path.basename(mpsFile, '.mps');
    
        targetMps = vfs.findFile(fileName+'.mps', dirName, timestamp);
    }else if(typeof(mpsFile) == 'object'){
        targetMps = mpsFile;
        dirName = vfs.buildPath(targetMps.parent_id, '');
        fileName = targetMps.name.replaceAll(/\.mps$/g, '');
    }

    if(targetMps){
        let targetSchema = vfs.findFile(fileName+'.schema', dirName, targetMps.created_at);
        if(!targetSchema && targetMps.parent_id){
            let nextParent = targetMps.parent_id;
            let nextFile = fileName+'Shared.schema';
            for(let sharedSchemaFolderName of sharedSchemaFolderNames){
                if(sharedSchemaFolderName == vfs.folders[nextParent].name){
                    nextFile = sharedSchemaFolderName+'Shared.schema';
                    break;
                }
            }
            let iterations = 0;
            while(nextParent){
                targetSchema = vfs.findFile(nextFile, vfs.buildPath(nextParent), targetMps.created_at);
                if(targetSchema) break;

                nextParent = vfs.folders[nextParent].parent_id;
                
                iterations++;
                if(iterations > 255) throw new Error(`Too many levels deep in folder id ${targetMps.parent_id}`);
            }
        }
        if(!targetSchema) throw new Error(`No suitable .schema found for .mps: ${dirName + '/' + fileName}`);
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
                result = mpsReader(targetMps.blob.content, targetSchema.blob.content, globalData, dataMode);
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
    throw new Error(`${dirName + '/' + fileName} was not found in virtual filesystem`);
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