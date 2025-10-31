'use strict';

const fs = require('fs');
const path = require('path');

const BrzParser = require('./brz_parser').BrzParser;
const BrdbParser = require('./brdb_parser').BrdbParser;

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
        saveFile = new BrdbParser(targetFile);
        break;
    case '.brz':
        saveFile = new BrzParser(targetFile);
        break;
    default:
        console.log(`Incorrect filetype, must be .brdb or .brz:\n${targetFile}`);
        process.exit();
}

let revRegex = /revision=\d+/
let revisionNumber = null;
for(let operation of operations){
    if(revRegex.test(operation)){
        revisionNumber = Number.parseInt(operation.split('=')[1]);
        break;
    }
}

for(let operation of operations){
    switch(operation){
        case 'stats':
            saveFile.printStats();
            break;
        case 'dump':
            console.log('Dumping filesystem...');
            saveFile.dump(revisionNumber);
            console.log('Dumped filesystem');
            break;
        case 'listowners':
            console.log(saveFile.vfs.readMps('World/0/Owners.mps', revisionNumber, true));
            break;
        case 'test':
            //saveFile.vfs.readMps('World/0/Entities/Chunks/0_0_0.mps');
            //saveFile.vfs.readMps('World/0/GlobalData.mps');
            //saveFile.vfs.readMps('World/0/Bricks/Grids/1/Components/-1_0_1.mps');
            //saveFile.vfs.readMps('World/0/Owners.mps');
            //saveFile.vfs.readMps('World/0/Bricks/Grids/1/Chunks/0_0_0.mps');
            //saveFile.vfs.readMps('World/0/Bricks/Grids/1/ChunkIndex.mps');
            saveFile.vfs.readMps('World/0/Entities/ChunkIndex.mps');
            break;
        /*case 'mps':
            let testFilename = 'GlobalData';
            let testPath = null;
            let testMps = vfs.findFile(testFilename+'.mps', revisionNumber, testPath);
            let testSchema = vfs.findFile(testFilename+'.schema', revisionNumber, testPath);
            //if(testMps && testSchema){
            if(testSchema){
                mpsRead(testMps?.blob.content, testSchema.blob.content);
            }
            break;*/
    }
}