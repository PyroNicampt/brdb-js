'use strict';

const fs = require('fs');
const path = require('path');

const BrzRead = require('./brz').read;
const BrdbRead = require('./brdb').read;

const Brs = require('brs-js');

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
    case '.brs':
        console.log('Reading BRS...');
        saveFile = Brs.read(fs.readFileSync(targetFile));
        fs.writeFileSync(`./dump/${path.basename(targetFile, '.brs')}.json`, JSON.stringify(saveFile, null, 4));
        process.exit();
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
            console.log('Stats Dump:\n', saveFile.getStats());
            break;
        case 'dump':
            console.log('Dumping filesystem...');
            saveFile.dump(null, revisionNumber);
            console.log('Dumped filesystem');
            break;
        case 'listowners':
            //console.log('Owners:\n', saveFile.readMps('World/0/Owners.mps', revisionNumber, true));
            saveFile.readMps('World/0/Owners.mps');
            break;
        case 'test':
            //saveFile.readMps('World/0/Entities/Chunks/0_0_0.mps');
            //saveFile.readMps('World/0/GlobalData.mps');
            //saveFile.readMps('World/0/Bricks/Grids/1/Components/-1_0_1.mps');
            saveFile.readMps('World/0/Owners.mps');
            //saveFile.readMps('World/0/Bricks/Grids/1/Chunks/0_0_0.mps');
            //saveFile.readMps('World/0/Bricks/Grids/1/ChunkIndex.mps');
            //saveFile.readMps('World/0/Entities/ChunkIndex.mps');
            //saveFile.readMps('World/0/Bricks/Grids/6/ChunkIndex.mps');
            //saveFile.readMps('World/0/Bricks/Grids/1/ChunkIndex.mps');
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