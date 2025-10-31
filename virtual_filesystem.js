'use strict';

const {Encoder, Decoder} = require('@toondepauw/node-zstd');
const fs = require('fs');
const path = require('path');
//const zstdEncoder = new Encoder(3);
const zstdDecoder = new Decoder();
const mpsReader = require('./msgpack_schema').readFile;

// .mps files in these folders usually are named by coordinates, and their .schema are named after the folder.
const sharedSchemaFolderNames = [
    'Chunks',
    'Components',
    'Wires',
];

class VirtualFilesystem{
    folders = [];
    files = [];
    revisions = [];
    latestRevision = 0;

    addFile(fileData){
        this.files[fileData.file_id] = fileData;
    }
    addFolder(folderData){
        this.folders[folderData.folder_id] = folderData;
    }
    addRevision(revisionData){
        this.revisions[revisionData.revision_id] = revisionData;
        this.latestRevision = Math.max(revisionData.revision_id, this.latestRevision);
    }
    findFile(query, revision, path){
        revision = this.validateRevision(revision);
        let timestamp = this.revisions[revision].created_at;
        //If any of these checks return true, skip this file
        let commonSkipConditions = file => {
            if(!file) return true;
            if(file.deleted_at != null && file.deleted_at <= timestamp) return true;
            if(file.created_at != null && file.created_at > timestamp) return true;
            if(path === '' && file.parent_id != null) return true;
            if(path){
                if(this.buildPath(file.parent_id) !== path) return true;
            }
        }
        switch(typeof(query)){
            case 'string':
                for(let file of this.files){
                    if(commonSkipConditions(file)) continue;
                    if(file.name == query) return file;
                }
                break;
            case 'number':
                for(let file of this.files){
                    if(commonSkipConditions(file)) continue;
                    if(file.file_id = query) return file;
                }
                break;
        }
        return null;
    }
    processBlob(blob){
        if(blob.compression == 0) return blob;
        blob.content = zstdDecoder.decodeSync(blob.content);
        return blob;
    }
    dump(name = 'world', revision){
        revision = this.validateRevision(revision);

        let timestamp = this.revisions[revision].created_at;

        let worldFolder = `./dump/${name}`;
        if(fs.existsSync(worldFolder)) fs.rmSync(worldFolder, {recursive:true});
        for(let folder of this.folders){
            if(!folder) continue;
            if(folder.deleted_at != null && folder.deleted_at <= timestamp) continue;
            if(folder.created_at != null && folder.created_at > timestamp) continue;
            fs.mkdirSync(worldFolder + '/' + this.buildPath(folder.parent_id, folder.name), {recursive:true});
        }
        for(let file of this.files){
            if(!file) continue;
            if(file.deleted_at != null && file.deleted_at <= timestamp) continue;
            if(file.created_at != null && file.created_at > timestamp) continue;
            let path = this.buildPath(file.parent_id, file.name);
            fs.writeFileSync(worldFolder + '/' + path, file.blob.content, {encoding: null, flag: 'w'});
        }
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
        for(let file of this.files){
            if(!file) continue;
            if(file.name.endsWith('.schema')){
                console.log('\n\n',file.name,'\n');
                mpsReader(null, file.blob.content);
            }
        }
    }
    readMps(mpsFile, revision, rotateArrays = false){
        if(!mpsFile.endsWith('.mps'))
            throw new Error(`${mpsFile} is not a .mps file`);
        const dirName = path.dirname(mpsFile);
        const fileName = path.basename(mpsFile, '.mps');
        
        let targetMps = this.findFile(fileName+'.mps', revision, dirName);
        if(targetMps){
            let targetSchema = this.findFile(fileName+'.schema', revision, dirName);
            if(!targetSchema && targetMps.parent_id){
                let nextParent = targetMps.parent_id;
                let nextFile = fileName+'Shared.schema';
                for(let sharedSchemaFolderName of sharedSchemaFolderNames){
                    if(sharedSchemaFolderName == this.folders[nextParent].name){
                        nextFile = sharedSchemaFolderName+'Shared.schema';
                        break;
                    }
                }
                let iterations = 0;
                while(nextParent){
                    targetSchema = this.findFile(nextFile, revision, this.buildPath(nextParent));
                    if(targetSchema) break;

                    nextParent = this.folders[nextParent].parent_id;
                    
                    iterations++;
                    if(iterations > 255) throw new Error(`Too many levels deep in folder id ${targetMps.parent_id}`);
                }
            }
            
            if(!targetSchema) throw new Error(`No suitable .schema found for .mps: ${mpsFile}`);
            console.log(`Found ${this.buildPath(targetMps.parent_id, targetMps.name)} and ${this.buildPath(targetSchema.parent_id, targetSchema.name)}\nReading...`)
            let output = mpsReader(targetMps.blob.content, targetSchema.blob.content);
            if(rotateArrays) output = rotateSoA(output);
            return output;
        }
        throw new Error(`${mpsFile} was not found in virtual filesystem`);
    }
    validateRevision(revision){
        if(revision == null || revision <= 0 || revision > this.latestRevision)
            return this.latestRevision;
        return revision;
    }
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