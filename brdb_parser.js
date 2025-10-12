'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {Encoder, Decoder} = require('@toondepauw/node-zstd');
//const zstdEncoder = new Encoder(3);
const zstdDecoder = new Decoder();
const VirtualFilesystem = require('./virtual_filesystem').VirtualFilesystem;

class BrdbParser {
    fileName = '';
    vfs = new VirtualFilesystem();

    constructor (targetFile){
        this.fileName = path.basename(targetFile, '.brdb');
        const db = new Database(targetFile);

        for(let folder_row of db.prepare('SELECT * FROM folders').iterate()){
            this.vfs.addFolder(folder_row);
        }
        for(let file_row of db.prepare('SELECT * FROM files').iterate()){
            this.vfs.addFile(file_row);
        }
        for(let revision_row of db.prepare('SELECT * FROM revisions').iterate()){
            this.vfs.addRevision(revision_row);
        }
        let blobQuery = db.prepare('SELECT * FROM blobs WHERE blob_id=?');
        for(let file of this.vfs.files){
            if(!file) continue;
            file.blob = this.vfs.processBlob(blobQuery.get(file.content_id));
        }
        db.close();
    }

    printStats(){
        let stats = {
            fileName: this.fileName,
            fileCount: this.vfs.files.length-1,
            folderCount: this.vfs.folders.length-1,
            revisions: this.vfs.revisions.length-1,
        }
        console.log('Base brdb stats\n', stats);
    }

    dump(revision){
        this.vfs.dump(this.fileName, revision);
    }
}

exports.BrdbParser = BrdbParser;