'use strict';

const sqlite3 = require('sqlite3');
const sqlite = require('sqlite');
const fs = require('fs');
const path = require('path');

//const VirtualFilesystem = require('virtual_filesystem.js');
const VirtualFilesystem = require('./virtual_filesystem').VirtualFilesystem;
const mpsRead = require('./msgpack_schema').readFile;

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
if(targetExtension != '.brdb'){
    console.log(`Incorrect filetype, must be .brdb:\n${targetFile}`);
    process.exit();
}

//let db = new sqlite3.Database('./world.brdb');
(async () => {
    let vfs = new VirtualFilesystem();

    const db = await sqlite.open({
        filename: targetFile,
        driver: sqlite3.Database,
    });
    await db.each('SELECT * FROM folders', (err, folder_row) => {
        vfs.addFolder(folder_row);
    });
    await db.each('SELECT * FROM files', async (err, file_row) => {
        vfs.addFile(file_row);
    });
    await db.each('SELECT * FROM revisions', async (err, revision_row) => {
        vfs.addRevision(revision_row);
    });
    for(let file of vfs.files){
        if(!file) continue;
        file.blob = vfs.processBlob(await db.get(`SELECT * FROM blobs WHERE blob_id=${file.content_id}`));
    }
    db.close();
    let revRegex = /revision=\d+/
    let revisionNumber = null;
    for(let operation of operations){
        if(revRegex.test(operation)){
            revisionNumber = Number.parseInt(operation.split('=')[1]);
            if(revisionNumber <= 0 || revisionNumber >= vfs.revisions.length) revisionNumber = null;
            break;
        }
    }
    for(let operation of operations){
        switch(operation){
            case 'stats':
                console.log(`files: ${vfs.files.length-1}\nfolders: ${vfs.folders.length-1}\nrevisions: ${vfs.revisions.length-1}`);
                break;
            case 'dump':
                console.log('Dumping filesystem...');
                vfs.dump(path.basename(targetFile).replaceAll(/\.(brdb|brz)/g, ''), revisionNumber);
                console.log('Dumped filesystem');
                break;
            case 'mps':
                let testFilename = 'GlobalData';
                let testPath = null;
                let testMps = vfs.findFile(testFilename+'.mps', revisionNumber, testPath);
                let testSchema = vfs.findFile(testFilename+'.schema', revisionNumber, testPath);
                //if(testMps && testSchema){
                if(testSchema){
                    mpsRead(testMps?.blob.content, testSchema.blob.content);
                }
                break;
        }
    }
})();