'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {Encoder, Decoder} = require('@toondepauw/node-zstd');
//const zstdEncoder = new Encoder(3);
const zstdDecoder = new Decoder();
const VirtualFilesystem = require('./virtual_filesystem').VirtualFilesystem;

function read(targetFile){
    let vfs = new VirtualFilesystem();
    vfs.name = path.basename(targetFile, '.brdb');

    const db = new Database(targetFile);

    //TEMP SHIT
    /*
    let files = [];
    let blobs = [];

    for(let file_row of db.prepare('SELECT * FROM files').iterate()){
        files.push(file_row);
    }

    for(let blob_row of db.prepare('SELECT blob_id, size_uncompressed, size_compressed FROM blobs').iterate()){
        blobs.push(blob_row);
    }

    console.log('File Count: ', files.length);
    console.log('Blob Count: ', blobs.length);

    let usedBlobCount = 0;

    for(let thisFile of files){
        //if(thisFile.deleted_at) continue;
        let thisBlob = blobs[thisFile.content_id-1];
        if(thisBlob.isUsed) continue;
        thisBlob.isUsed = true;
        usedBlobCount++;
    }

    console.log('Used Blobs: ', usedBlobCount);*/
    // END OF TEMP SHIT

    
    for(let folder_row of db.prepare('SELECT * FROM folders').iterate()){
        vfs.addFolder(folder_row);
    }
    for(let file_row of db.prepare('SELECT * FROM files').iterate()){
        vfs.addFile(file_row);
    }
    for(let revision_row of db.prepare('SELECT * FROM revisions').iterate()){
        vfs.addRevision(revision_row);
    }
    let blobQuery = db.prepare('SELECT * FROM blobs WHERE blob_id=?');
    for(let file of vfs.files){
        if(!file) continue;
        file.blob = vfs.processBlob(blobQuery.get(file.content_id));
    }
    db.close();

    return vfs;
}

exports.read = read;