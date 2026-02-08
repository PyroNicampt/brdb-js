***[This Library is not recommended for public use yet, please use this instead:](https://github.com/brickadia-community/brdb/blob/main/crates/brdb)***

A pure node.js implementation of brickadia .brz/.brdb save file reader/writer.

**Currently only reading is implemented.**

# Installation
Make sure you have node 20 or later installed, then clone the repo and run `npm install` in the root directory.

# Usage
`node .\main.js <path to .brdb/.brz> <operation> <operation> <op....`

## Current Operations:

- `revision=<number>`
selects a specific revision to perform operations on.
- `stats`
shows the filesystem statistics of the save
- `dump`
dumps the contents of the save to a folder.
- `owners`
lists statistics saved per-user like brick count, entity count, components, and wires, in order of most to least
- `bundle`
Outputs the bundle data of a .brz, showing description, version number, dates, etc.
Only works on .brz, will fail on .brdb.
- `description`
outputs the description from a .brz bundle in a plain-formatted manner.
- `mps=<path>`
Will dump the specified mps into a json file next to where it would be dumped to.
- `mpsschema=<path>`
Will dump the selected mps file's schema next to where the schema would be dumped to.
- `mapper`
Dumps specific data out to a .json for usage in the brickadia mapper webpage.

# Convenience links for myself:
- [BRDB Spec](https://github.com/brickadia-community/brdb/)
- [Msgpack-Schema](https://gist.github.com/Zeblote/053d54cc820df3bccad57df676202895)
- [Msgpack Spec](https://github.com/msgpack/msgpack/blob/master/spec.md)