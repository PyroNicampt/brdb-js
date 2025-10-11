'use strict';

const {Encoder, Decoder} = require('@toondepauw/node-zstd');
const fs = require('fs');
const { start } = require('repl');
//const zstdEncoder = new Encoder(3);
const zstdDecoder = new Decoder();

class VirtualFilesystem{
    folders = [];
    files = [];
    revisions = [];

    addFile(fileData){
        this.files[fileData.file_id] = fileData;
    }
    addFolder(folderData){
        this.folders[folderData.folder_id] = folderData;
    }
    addRevision(revisionData){
        this.revisions[revisionData.revision_id] = revisionData;
    }
    findFile(query, revision, path){
        if(revision == null) revision = this.revisions.length-1;
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
        if(revision == null) revision = this.revisions.length-1;
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
}

exports.VirtualFilesystem = VirtualFilesystem;