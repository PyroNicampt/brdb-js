'use strict';

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {Encoder, Decoder} from '@toondepauw/node-zstd';
//const zstdEncoder = new Encoder(3);
const zstdDecoder = new Decoder();
import { VirtualFilesystem } from './virtual_filesystem.js';

export function read(targetFile){
    let vfs = new VirtualFilesystem();
    vfs.name = path.basename(targetFile, '.brdb');

    const db = new Database(targetFile);
    
    for(let folder_row of db.prepare('SELECT * FROM folders').iterate()){
        vfs.addFolder(folder_row);
    }
    for(let file_row of db.prepare('SELECT * FROM files').iterate()){
        vfs.addFile(file_row);
    }
    for(let revision_row of db.prepare('SELECT * FROM revisions').iterate()){
        vfs.addRevision(revision_row);
    }
    db.close();

    vfs.loadBlobs = targets => {
        if(targets == null || typeof(targets) == 'number'){
            const db = new Database(targetFile);
            let allBlobs = db.prepare('SELECT * FROM blobs').all();
            if(typeof(targets) == 'number'){
                vfs.findFile(null, targets);
                for(let file in vfs.cachedFindmaps[targets]){
                    vfs.cachedFindmaps[targets][file].blob = vfs.processBlob(allBlobs[vfs.cachedFindmaps[targets][file].content_id-1]);
                }
            }else{
                for(let file in vfs.files){
                    vfs.cachedFindmaps[targets][file].blob = vfs.processBlob(allBlobs[vfs.cachedFindmaps[targets][file].content_id-1]);
                }
            }
            return vfs;
        }
        if(typeof(targets) != 'object') throw new Error('Target must be an object or array');

        if(!Array.isArray(targets)){
            if(targets.blob) return vfs;
            targets = [targets];
        }
        let needsBlobs = false;
        for(let target of targets){
            if(!target.blob){
                needsBlobs = true;
                break;
            }
        }

        if(!needsBlobs) return vfs;

        const db = new Database(targetFile);
        let blobQuery = db.prepare('SELECT * FROM blobs WHERE blob_id=?');
        for(let target of targets){
            if(!target || target.blob) continue;
            let queryRes = blobQuery.get(target.content_id)
            target.blob = vfs.processBlob(queryRes);
        }
        db.close();
    };

    return vfs;
}