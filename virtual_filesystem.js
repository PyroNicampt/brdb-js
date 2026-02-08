'use strict';

const {Encoder, Decoder} = require('@toondepauw/node-zstd');
const fs = require('fs');
const path = require('path');
//const zstdEncoder = new Encoder(3);
const zstdDecoder = new Decoder();
const mpsReader = require('./msgpack_schema').readFile;
const mpsReaderRaw = require('./msgpack_schema').readFileRaw;

// .mps files in these folders usually are named by coordinates, and their .schema are named after the folder.
const sharedSchemaFolderNames = [
    'Chunks',
    'Components',
    'Wires',
];

class VirtualFilesystem{
    name = '';
    folders = [];
    files = [];
    revisions = [];
    latestRevision = 0;

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
        if(!timestamp) timestamp = this.revisions[this.latestRevision].created_at;

        for(let i=results.length-1; i>=0; i--){
            if((results[i].deleted_at == null || results[i].deleted_at > timestamp) && results[i].created_at <= timestamp){
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
            case 'number':
                for(let file of this.files){
                    if(commonSkipConditions(file)) continue;
                    if(file.file_id == query) results.push(file);
                }
        }
        results.sort((a, b) => {
            a.created_at - b.created_at;
        });
        return results;
    }
    processBlob(blob){
        if(blob.compression == 0) return blob;
        blob.content = zstdDecoder.decodeSync(blob.content);
        return blob;
    }
    dump(name, timestamp){
        if(!name) name = this.name;

        let worldFolder = `./dump/${name}`;
        if(fs.existsSync(worldFolder)) fs.rmSync(worldFolder, {recursive:true});
        for(let folder of this.folders){
            if(!folder) continue;
            if(folder.deleted_at != null && folder.deleted_at <= timestamp) continue;
            if(folder.created_at != null && folder.created_at > timestamp) continue;
            fs.mkdirSync(worldFolder + '/' + this.buildPath(folder.parent_id, folder.name), {recursive:true});
        }
        let dumpFiles = [];
        for(let file of this.files){
            if(!file) continue;
            if(file.deleted_at != null && file.deleted_at <= timestamp) continue;
            if(file.created_at != null && file.created_at > timestamp) continue;
            dumpFiles.push(file);
        }
        this.loadBlobs(dumpFiles);
        for(let file of dumpFiles){            
            let path = this.buildPath(file.parent_id, file.name);
            fs.writeFileSync(worldFolder + '/' + path, file.blob.content, {encoding: null, flag: 'w'});
        }
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
    dumpSchema(){
        let schemaFiles = [];
        for(let file of this.files){
            if(!file) continue;
            if(file.name.endsWith('.schema')){
                schemaFiles.push(file);
            }
        }
        this.loadBlobs(schemaFiles);
        for(let file of schemaFiles){
            console.log('\n\n',file.name,'\n');
            console.log(JSON.stringify(mpsReaderRaw(null, file.blob.content).schema, null, 2));
        }
    }

    readMps(mpsFile, timestamp){
        return grabMpsSchema(this, mpsFile, timestamp).data;
    }

    readSchema(mpsFile, timestamp){
        return grabMpsSchema(this, mpsFile, timestamp, false).schema;
    }

    readMpsAndSchema(mpsFile, timestamp){
        return grabMpsSchema(this, mpsFile, timestamp, true);
    }

    getTimestampFromRevision(revision){
        return this.revisions[validateRevision(this, revision)].created_at;
    }
}

function grabMpsSchema(vfs, mpsFile, timestamp, getMps = true){
    if(!mpsFile.endsWith('.mps'))
        throw new Error(`${mpsFile} is not an .mps file`);
    const dirName = path.dirname(mpsFile);
    const fileName = path.basename(mpsFile, '.mps');

    let targetMps = vfs.findFile(fileName+'.mps', dirName, timestamp);
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
        if(!targetSchema) throw new Error(`No suitable .schema found for .mps: ${mpsFile}`);
        console.log(`Found ${vfs.buildPath(targetMps.parent_id, targetMps.name)} and ${vfs.buildPath(targetSchema.parent_id, targetSchema.name)}\nReading...`);
        try{
            if(getMps){
                vfs.loadBlobs([targetMps, targetSchema]);
                return mpsReader(targetMps.blob.content, targetSchema.blob.content);
            }else{
                vfs.loadBlobs([targetSchema]);
                return mpsReader(null, targetSchema.blob.content);
            }
        }catch(e){
            console.warn(`Failed to read ${mpsFile}`);
            throw e;
        }
    }
    throw new Error(`${mpsFile} was not found in virtual filesystem`);
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

exports.VirtualFilesystem = VirtualFilesystem;