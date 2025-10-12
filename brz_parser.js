'use strict';

const fs = require('fs');
const path = require('path');
const {Encoder, Decoder} = require('@toondepauw/node-zstd');
//const zstdEncoder = new Encoder(3);
const zstdDecoder = new Decoder();
const VirtualFilesystem = require('./virtual_filesystem').VirtualFilesystem;

class BrzParser {
    fileName = '';
    header = null;
    index = null;
    vfs = new VirtualFilesystem();


    constructor (targetFile){
        this.fileName = path.basename(targetFile, '.brz');
        let fileData = fs.readFileSync(targetFile);
        if(fileData.toString('utf-8', 0, 3) != 'BRZ')
            throw new Error('This file is not a BRZ Archive: Magic number did not match');

        this.header = {
            formatVersion : fileData.readUInt8(3),
            compressionMethod : fileData.readUInt8(4),
            indexDecompressedLength : fileData.readInt32LE(5),
            indexCompressedLength : fileData.readInt32LE(9),
            indexHash : fileData.subarray(0xD, 0x2D),
        };

        // Read Index
        let indexData = fileData.subarray(
            0x2D,
            0x2D+this.header.indexCompressedLength
        );
        if(this.header.compressionMethod == 1)
            indexData = zstdDecoder.decodeSync(indexData);

        //fs.writeFileSync(`./dump/${this.fileName}`, indexData);

        this.index = {
            folderCount : indexData.readInt32LE(0x0),
            fileCount : indexData.readInt32LE(0x4),
            blobCount : indexData.readInt32LE(0x8),
        }
        // Read Folders
        let parentIdsOffset = 0xC;
        let nameLengthsOffset = parentIdsOffset + 4 * this.index.folderCount;
        let nameTableOffset = nameLengthsOffset + 2 * this.index.folderCount;
        for(let i=0; i<this.index.folderCount; i++){
            let nameLength = indexData.readUInt16LE(nameLengthsOffset + 2 * i);
            let newFolder = {
                folder_id: i+1,
                parent_id: indexData.readInt32LE(parentIdsOffset + 4 * i) + 1,
                name: indexData.toString('utf-8', nameTableOffset, nameTableOffset + nameLength),
            };
            if(newFolder.parent_id == 0) newFolder.parent_id = null;
            nameTableOffset += nameLength;
            this.vfs.addFolder(newFolder);
        }
        // Read Files
        parentIdsOffset = nameTableOffset;
        let contentIdsOffset = parentIdsOffset + 4 * this.index.fileCount;
        nameLengthsOffset = contentIdsOffset + 4 * this.index.fileCount;
        nameTableOffset = nameLengthsOffset + 2 * this.index.fileCount;
        for(let i=0; i<this.index.fileCount; i++){
            let nameLength = indexData.readUInt16LE(nameLengthsOffset + 2 * i);
            let newFile = {
                file_id: i+1,
                parent_id: indexData.readInt32LE(parentIdsOffset + 4 * i) + 1,
                content_id: indexData.readInt32LE(contentIdsOffset + 4 * i) + 1,
                name: indexData.toString('utf-8', nameTableOffset, nameTableOffset + nameLength),
            };
            if(newFile.parent_id == 0) newFile.parent_id = null;
            nameTableOffset += nameLength;
            this.vfs.addFile(newFile);
        }

        // Read Blobs
        let blobs = [];
        let compressionMethodOffset = nameTableOffset;
        let decompressedLengthsOffset = compressionMethodOffset + this.index.blobCount;
        let compressedLengthsOffset = decompressedLengthsOffset + 4 * this.index.fileCount;
        let hashesOffset = compressedLengthsOffset + 4 * this.index.fileCount;
        let blobDataOffset = 0x2D + this.header.indexCompressedLength;
        for(let i=0; i<this.index.blobCount; i++){
            let newBlob = {
                compression: indexData.readUInt8(compressionMethodOffset + i),
                size_uncompressed: indexData.readInt32LE(decompressedLengthsOffset + 4 * i),
                size_compressed: indexData.readInt32LE(compressedLengthsOffset + 4 * i),
                hash: indexData.subarray(hashesOffset + 32 * i, hashesOffset + 32 * (i + 1)),
            }
            //console.log(newBlob);
            newBlob.content = fileData.subarray(blobDataOffset, blobDataOffset + newBlob.size_compressed);
            blobDataOffset += newBlob.size_compressed;
            blobs.push(this.vfs.processBlob(newBlob));
        }
        for(let file of this.vfs.files){
            if(!file) continue;
            file.blob = blobs[file.content_id-1];
        }
        this.vfs.addRevision({
            revision_id: 1,
            description: 'Initial Revision',
            created_at: 0
        });
    }

    printStats(){
        let stats = {
            fileName: this.fileName,
            fileCount: this.vfs.files.length-1,
            folderCount: this.vfs.folders.length-1,
            revisions: this.vfs.revisions.length-1,
        }
        console.log('header:\n', this.header);
        console.log('index:\n', this.index);
        console.log('filesystem:\n', stats);
    }

    dump(){
        this.vfs.dump(this.fileName, 1);
    }
}

exports.BrzParser = BrzParser;