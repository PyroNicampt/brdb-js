'use strict';

import fs from 'node:fs';
import path from 'node:path';
import {Encoder, Decoder} from '@toondepauw/node-zstd';
import {hash as blakeHash} from 'blake3';
const zstdEncoder = new Encoder(10);
const zstdDecoder = new Decoder();
import { VirtualFilesystem } from './virtual_filesystem.js';

export function read(targetFile){
    let vfs = new VirtualFilesystem();
    vfs.name = path.basename(targetFile, '.brz');

    let fileData = fs.readFileSync(targetFile);
    if(fileData.toString('utf-8', 0, 3) != 'BRZ')
        throw new Error('This file is not a BRZ Archive: Magic number did not match');

    let header = {
        formatVersion : fileData.readUInt8(3),
        compressionMethod : fileData.readUInt8(4),
        indexDecompressedLength : fileData.readInt32LE(5),
        indexCompressedLength : fileData.readInt32LE(9),
        indexHash : fileData.subarray(0xD, 0x2D),
    };

    // Read Index
    let indexData = fileData.subarray(
        0x2D,
        0x2D+header.indexCompressedLength
    );
    if(header.compressionMethod == 1)
        indexData = zstdDecoder.decodeSync(indexData);

    if(!doesHashMatch(header.indexHash, indexData))
        console.log('brz index hash did not match');

    let index = {
        folderCount : indexData.readInt32LE(0x0),
        fileCount : indexData.readInt32LE(0x4),
        blobCount : indexData.readInt32LE(0x8),
    }
    // Read Folders
    let parentIdsOffset = 0xC;
    let nameLengthsOffset = parentIdsOffset + 4 * index.folderCount;
    let nameTableOffset = nameLengthsOffset + 2 * index.folderCount;
    for(let i=0; i<index.folderCount; i++){
        let nameLength = indexData.readUInt16LE(nameLengthsOffset + 2 * i);
        let newFolder = {
            folder_id: i+1,
            parent_id: indexData.readInt32LE(parentIdsOffset + 4 * i) + 1,
            name: indexData.toString('utf-8', nameTableOffset, nameTableOffset + nameLength),
            created_at: 0,
        };
        if(newFolder.parent_id == 0) newFolder.parent_id = null;
        nameTableOffset += nameLength;
        vfs.addFolder(newFolder);
    }
    // Read Files
    parentIdsOffset = nameTableOffset;
    let contentIdsOffset = parentIdsOffset + 4 * index.fileCount;
    nameLengthsOffset = contentIdsOffset + 4 * index.fileCount;
    nameTableOffset = nameLengthsOffset + 2 * index.fileCount;
    for(let i=0; i<index.fileCount; i++){
        let nameLength = indexData.readUInt16LE(nameLengthsOffset + 2 * i);
        let newFile = {
            file_id: i+1,
            parent_id: indexData.readInt32LE(parentIdsOffset + 4 * i) + 1,
            content_id: indexData.readInt32LE(contentIdsOffset + 4 * i) + 1,
            name: indexData.toString('utf-8', nameTableOffset, nameTableOffset + nameLength),
            created_at: 0,
        };
        if(newFile.parent_id == 0) newFile.parent_id = null;
        nameTableOffset += nameLength;
        vfs.addFile(newFile);
    }

    // Read Blobs
    let blobs = [];
    let compressionMethodOffset = nameTableOffset;
    let decompressedLengthsOffset = compressionMethodOffset + index.blobCount;
    let compressedLengthsOffset = decompressedLengthsOffset + 4 * index.blobCount;
    let hashesOffset = compressedLengthsOffset + 4 * index.blobCount;
    let blobDataOffset = 0x2D + header.indexCompressedLength;
    for(let i=0; i<index.blobCount; i++){
        let newBlob = {
            compression: indexData.readUInt8(compressionMethodOffset + i),
            size_uncompressed: indexData.readInt32LE(decompressedLengthsOffset + 4 * i),
            size_compressed: indexData.readInt32LE(compressedLengthsOffset + 4 * i),
            hash: indexData.subarray(hashesOffset + 32 * i, hashesOffset + 32 * (i + 1)),
        }
        newBlob.content = fileData.subarray(blobDataOffset, blobDataOffset + newBlob.size_compressed);
        blobDataOffset += newBlob.size_compressed;
        let lastBlob = blobs.push(vfs.processBlob(newBlob)) - 1;

        if(!doesHashMatch(blobs[lastBlob].hash, blobs[lastBlob].content))
            blobs[lastBlob].badHashIndex = i;
    }
    for(let file of vfs.files){
        if(!file) continue;
        file.blob = blobs[file.content_id-1];
        if(file.blob.badHashIndex != null){
            console.log(`WARNING: Hash didn't match on blob ${file.blob.badHashIndex}\nFile: ${vfs.buildPath(file.parent_id, file.name)}`);
        }
    }

    vfs.loadBlobs = () => {
        //console.log('TODO: Selective loading of blobs in .brz not yet implemented.');
    }
    vfs.addRevision({
        revision_id: 1,
        description: 'Initial Revision',
        created_at: 0
    });

    return vfs;
}

/**
 * Writes a brz to the specified path.
 * 
 * WARNING: Will NOT work with revisioned data. Strip revisions and fast forward data and schemas if using with brdb.
 * @param {String} targetPath 
 * @param {VirtualFilesystem} vfs 
 */
export function write(targetPath, vfs){
    let folderNames = [];
    let totalFolderNameLength = 0;
    let folderParentIds = [];

    let fileNames = [];
    let totalFileNameLength = 0;
    let fileParentIds = [];
    let fileContentIds = [];
    let compressionMethods = [];
    let decompressedLengths = [];
    let compressedLengths = [];
    let blobHashes = [];
    let blobs = [];
    let totalBlobSize = 0;

    for(let i=1; i<vfs.folders.length; i++){
        folderNames[i-1] = vfs.folders[i].name;
        totalFolderNameLength += vfs.folders[i].name.length;
        folderParentIds[i-1] = vfs.folders[i].parent_id - 1;
    }
    for(let i=1; i<vfs.files.length; i++){
        fileNames[i-1] = vfs.files[i].name;
        totalFileNameLength += vfs.files[i].name.length;
        fileParentIds[i-1] = vfs.files[i].parent_id - 1;
        vfs.files[i].blob.hash = blakeHash(vfs.files[i].blob.content);
        let b;
        for(b=0; b<blobs.length; b++)
            if(Buffer.compare(blobHashes[b], vfs.files[i].blob.hash) == 0) break;
        fileContentIds[i-1] = b;
        if(!blobs[b]){
            compressionMethods[b] = vfs.files[i].blob.compression;
            decompressedLengths[b] = vfs.files[i].blob.content.length;
            blobHashes[b] = vfs.files[i].blob.hash;
            if(compressionMethods[b] == 1){
                blobs[b] = zstdEncoder.encodeSync(vfs.files[i].blob.content);
                compressedLengths[b] = blobs[b].length;
            }else{
                blobs[b] = vfs.files[i].blob.content;
                compressedLengths[b] = decompressedLengths[b];
            }
            totalBlobSize += blobs[b].length;
        }
    }

    let index = Buffer.alloc(
        12 // folder, file, and blob counts
        + 4 * folderParentIds.length
        + 2 * folderNames.length
        + totalFolderNameLength
        + 4 * fileParentIds.length
        + 4 * fileContentIds.length
        + 2 * fileNames.length
        + totalFileNameLength
        + compressionMethods.length
        + 4 * decompressedLengths.length
        + 4 * compressedLengths.length
        + 32 * blobHashes.length
    );
    index.writeInt32LE(folderNames.length, 0);
    index.writeInt32LE(fileNames.length, 4);
    index.writeInt32LE(blobs.length, 8);
    let ptr = 12;
    let i;
    for(i=0; i<folderParentIds.length; i++){
        index.writeInt32LE(folderParentIds[i], ptr);
        ptr += 4;
    }
    for(i=0; i<folderNames.length; i++){
        index.writeUInt16LE(folderNames[i].length, ptr);
        ptr += 2;
    }
    for(i=0; i<folderNames.length; i++){
        index.write(folderNames[i], ptr, 'utf8');
        ptr += folderNames[i].length;
    }

    for(i=0; i<fileParentIds.length; i++){
        index.writeInt32LE(fileParentIds[i], ptr);
        ptr += 4;
    }
    for(i=0; i<fileContentIds.length; i++){
        index.writeInt32LE(fileContentIds[i], ptr);
        ptr += 4;
    }
    for(i=0; i<fileNames.length; i++){
        index.writeUInt16LE(fileNames[i].length, ptr);
        ptr += 2;
    }
    for(i=0; i<fileNames.length; i++){
        index.write(fileNames[i], ptr, 'utf8');
        ptr += fileNames[i].length;
    }
    
    for(i=0; i<compressionMethods.length; i++){
        index.writeUInt8(compressionMethods[i], ptr);
        ptr++;
    }
    for(i=0; i<decompressedLengths.length; i++){
        index.writeInt32LE(decompressedLengths[i], ptr);
        ptr += 4;
    }
    for(i=0; i<compressedLengths.length; i++){
        index.writeInt32LE(compressedLengths[i], ptr);
        ptr += 4;
    }
    for(i=0; i<blobHashes.length; i++){
        blobHashes[i].copy(index, ptr);
        ptr += 32;
    }

    let indexDecompressedLength = index.length;
    let indexCompressedLength = index.length;
    let indexHash = blakeHash(index);
    let compressIndex = 1;
    if(compressIndex == 1){
        index = zstdEncoder.encodeSync(index);
        indexCompressedLength = index.length;
    }
    
    let header = Buffer.alloc(0x2D);
    header.write('BRZ', 0, 'utf8');
    header.writeUInt8(0, 3); // format version
    header.writeUInt8(compressIndex, 4); // compression method
    header.writeUInt32LE(indexDecompressedLength, 5); // index decompressed length
    header.writeUInt32LE(indexCompressedLength, 9); // index compressed length
    indexHash.copy(header, 13);

    let finalFile = Buffer.alloc(header.length + index.length + totalBlobSize);
    header.copy(finalFile);
    index.copy(finalFile, header.length);
    ptr = header.length + index.length;
    
    for(let i=0; i<blobs.length; i++){
        blobs[i].copy(finalFile, ptr);
        ptr += blobs[i].length;
    }
    //finalFile.write('ENDOFFILE', ptr, 'utf8')
    console.log('0x'+ptr.toString(16))
    console.log('0x'+finalFile.length.toString(16))

    fs.writeFileSync(targetPath, finalFile, {encoding:null});
}

function doesHashMatch(hash, data){
    return (Buffer.compare(hash, blakeHash(data)) == 0);
}