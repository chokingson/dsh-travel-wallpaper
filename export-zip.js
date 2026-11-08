import{createReadStream}from'node:fs';import{stat}from'node:fs/promises';import{Readable}from'node:stream';
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc=(value,bytes)=>{for(const b of bytes)value=table[(value^b)&255]^(value>>>8);return value>>>0;};
export async function wallpaperZip(files){
 if(!files.length||files.length>65535)throw Error('没有可导出的壁纸，或文件过多');
 let estimate=0;for(const f of files){const s=await stat(f.path);estimate+=s.size+Buffer.byteLength(f.name)*2+160;if(estimate>=0xffffffff)throw Error('本次导出超过4GB，请分世界导出');}
 async function* bytes(){let offset=0;const central=[];
  for(const file of files){if(/[\\/\x00]/.test(file.name))throw Error('导出文件名无效');const name=Buffer.from(file.name),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x808,6);header.writeUInt16LE(name.length,26);const start=offset;yield header;yield name;offset+=header.length+name.length;let checksum=0xffffffff,size=0;
   for await(const chunk of createReadStream(file.path)){checksum=crc(checksum,chunk);size+=chunk.length;offset+=chunk.length;yield chunk;}
   checksum=(checksum^0xffffffff)>>>0;const descriptor=Buffer.alloc(16);descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(checksum,4);descriptor.writeUInt32LE(size,8);descriptor.writeUInt32LE(size,12);yield descriptor;offset+=16;
   const item=Buffer.alloc(46);item.writeUInt32LE(0x02014b50);item.writeUInt16LE(20,4);item.writeUInt16LE(20,6);item.writeUInt16LE(0x808,8);item.writeUInt32LE(checksum,16);item.writeUInt32LE(size,20);item.writeUInt32LE(size,24);item.writeUInt16LE(name.length,28);item.writeUInt32LE(start,42);central.push(item,name);
  }
  const centralStart=offset;for(const b of central){yield b;offset+=b.length;}const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(offset-centralStart,12);end.writeUInt32LE(centralStart,16);yield end;
 }
 return Readable.from(bytes());
}
