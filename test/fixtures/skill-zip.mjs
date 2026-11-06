import { deflateRawSync } from 'node:zlib';
const crcTable = Array.from({length:256}, (_, i) => {
  let c=i; for(let bit=0;bit<8;bit++) c=(c&1)?0xedb88320^(c>>>1):c>>>1; return c>>>0;
});
export function zipCrc32(bytes) {
  let crc=0xffffffff; for(const byte of bytes) crc=crcTable[(crc^byte)&255]^(crc>>>8); return (crc^0xffffffff)>>>0;
}
function invalid(message) { throw new Error(`ZIP_INVALID: ${message}`); }
// Stable UTF-8 names, regular-file mode, fixed DOS date and DEFLATE encoding.
export function writeSkillZip(files) {
  const parts=[], central=[]; let offset=0;
  for(const [name,value] of files) {
    const path=Buffer.from(name), body=Buffer.from(value), packed=deflateRawSync(body,{level:9}), crc=zipCrc32(body);
    if(path.length>65535) invalid('name too long');
    const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(0x800,6);
    local.writeUInt16LE(8,8); local.writeUInt16LE(33,12); local.writeUInt32LE(crc,14); local.writeUInt32LE(packed.length,18);
    local.writeUInt32LE(body.length,22); local.writeUInt16LE(path.length,26);
    const header=Buffer.alloc(46); header.writeUInt32LE(0x02014b50); header.writeUInt16LE(0x0314,4); header.writeUInt16LE(20,6);
    header.writeUInt16LE(0x800,8); header.writeUInt16LE(8,10); header.writeUInt16LE(33,14); header.writeUInt32LE(crc,16);
    header.writeUInt32LE(packed.length,20); header.writeUInt32LE(body.length,24); header.writeUInt16LE(path.length,28);
    header.writeUInt32LE((0o100600*65536)>>>0,38); header.writeUInt32LE(offset,42);
    parts.push(local,path,packed); central.push(header,path); offset+=local.length+path.length+packed.length;
  }
  const directory=Buffer.concat(central), end=Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length/2,8); end.writeUInt16LE(central.length/2,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...parts,directory,end]);
}
