// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy was not distributed with this file, see https://mozilla.org/MPL/2.0/.
import { inflateRawSync } from "node:zlib";
import { TextDecoder } from "node:util";
const decoder = new TextDecoder("utf-8", { fatal: true });
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let bit = 0; bit < 8; bit++)
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function zipCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function invalid(message) {
  throw new Error(`ZIP_INVALID: ${message}`);
}
// Parse in memory only. No extraction, execution, ZIP64, encryption or links.
export function readSkillZip(bytes, limits) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 22 ||
    bytes.length > limits.compressed
  )
    invalid("compressed size limit");
  const end = bytes.length - 22;
  if (
    bytes.readUInt32LE(end) !== 0x06054b50 ||
    bytes.readUInt16LE(end + 20) !== 0
  )
    invalid("end record or archive comment");
  const count = bytes.readUInt16LE(end + 10),
    start = bytes.readUInt32LE(end + 16),
    size = bytes.readUInt32LE(end + 12);
  if (
    bytes.readUInt16LE(end + 4) ||
    bytes.readUInt16LE(end + 6) ||
    bytes.readUInt16LE(end + 8) !== count ||
    count === 65535 ||
    count < 1 ||
    count > limits.entries ||
    start + size !== end
  )
    invalid("directory bounds or entry count");
  const entries = [],
    files = new Map(),
    paths = new Set(),
    ranges = [];
  let cursor = start,
    expanded = 0;
  const extra = (at, length, name) => {
    const stop = at + length;
    while (at < stop) {
      if (at + 4 > stop) invalid("extra field bounds");
      const tag = bytes.readUInt16LE(at),
        n = bytes.readUInt16LE(at + 2);
      at += 4;
      if (at + n > stop || [1, 0x6375, 0x9901].includes(tag))
        invalid("unsupported extra field");
      if (
        tag === 0x7075 &&
        (n < 5 ||
          bytes[at] !== 1 ||
          bytes.readUInt32LE(at + 1) !== zipCrc32(name) ||
          !bytes.subarray(at + 5, at + n).equals(name))
      )
        invalid("Unicode path override");
      at += n;
    }
  };
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50)
      invalid("central header");
    const flags = bytes.readUInt16LE(cursor + 8),
      method = bytes.readUInt16LE(cursor + 10),
      crc = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20),
      length = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28),
      extraLength = bytes.readUInt16LE(cursor + 30),
      comment = bytes.readUInt16LE(cursor + 32);
    const local = bytes.readUInt32LE(cursor + 42),
      attributes = bytes.readUInt32LE(cursor + 38);
    if (
      cursor + 46 + nameLength + extraLength + comment > end ||
      !nameLength ||
      comment ||
      bytes.readUInt16LE(cursor + 34) ||
      flags & ~0x080e ||
      (method !== 8 && flags & 6) ||
      ![0, 8].includes(method) ||
      bytes.readUInt16LE(cursor + 6) > 20
    )
      invalid("unsupported entry");
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    let name;
    try {
      name = decoder.decode(rawName);
    } catch {
      invalid("names must use UTF-8");
    }
    const directory = name.endsWith("/"),
      path = directory ? name.slice(0, -1) : name;
    if (
      !path ||
      path.length > 240 ||
      /[\\:\x00-\x1f\x7f]/.test(path) ||
      path.startsWith("/") ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
      invalid("paths must be relative without traversal");
    if (paths.has(path)) invalid("duplicate archive path");
    const mode = attributes >>> 16,
      type = mode & 0o170000;
    if (
      mode & 0o7000 ||
      (type && type !== (directory ? 0o040000 : 0o100000)) ||
      ((attributes & 16) !== 0 && !directory)
    )
      invalid("links, special files or privileged modes");
    if (length > limits.file || (directory && length !== 0))
      invalid("file size limit");
    expanded += length;
    if (expanded > limits.expanded) invalid("expanded size limit");
    extra(cursor + 46 + nameLength, extraLength, rawName);
    if (
      local + 30 > start ||
      bytes.readUInt32LE(local) !== 0x04034b50 ||
      bytes.readUInt16LE(local + 4) > 20 ||
      bytes.readUInt16LE(local + 6) !== flags ||
      bytes.readUInt16LE(local + 8) !== method
    )
      invalid("local header mismatch");
    const localName = bytes.readUInt16LE(local + 26),
      localExtra = bytes.readUInt16LE(local + 28);
    const data = local + 30 + localName + localExtra,
      stop = data + compressed;
    if (
      data > start ||
      stop > start ||
      !bytes.subarray(local + 30, local + 30 + localName).equals(rawName)
    )
      invalid("local name or data bounds");
    extra(local + 30 + localName, localExtra, rawName);
    const localCrc = bytes.readUInt32LE(local + 14),
      localCompressed = bytes.readUInt32LE(local + 18),
      localLength = bytes.readUInt32LE(local + 22);
    let rangeEnd = stop;
    if (flags & 8) {
      if (
        (localCrc && localCrc !== crc) ||
        (localCompressed && localCompressed !== compressed) ||
        (localLength && localLength !== length)
      )
        invalid("local descriptor mismatch");
      if (stop + 12 > start) invalid("missing descriptor");
      const descriptor =
        bytes.readUInt32LE(stop) === 0x08074b50 ? stop + 4 : stop;
      if (
        descriptor + 12 > start ||
        bytes.readUInt32LE(descriptor) !== crc ||
        bytes.readUInt32LE(descriptor + 4) !== compressed ||
        bytes.readUInt32LE(descriptor + 8) !== length
      )
        invalid("descriptor mismatch");
      rangeEnd = descriptor + 12;
    } else if (
      localCrc !== crc ||
      localCompressed !== compressed ||
      localLength !== length
    )
      invalid("local size or checksum mismatch");
    let content;
    if (method === 0) {
      if (compressed !== length) invalid("stored size mismatch");
      content = Buffer.from(bytes.subarray(data, stop));
    } else {
      try {
        const result = inflateRawSync(bytes.subarray(data, stop), {
          maxOutputLength: Math.max(1, length),
          info: true,
        });
        if (result.engine.bytesWritten !== compressed)
          invalid("hidden compressed data");
        content = result.buffer;
      } catch {
        invalid("invalid deflate data or expanded size");
      }
    }
    if (content.length !== length || zipCrc32(content) !== crc)
      invalid("size or CRC mismatch");
    paths.add(path);
    entries.push({
      path,
      byteLength: length,
      kind: directory ? "directory" : "file",
    });
    if (!directory) files.set(path, content);
    ranges.push([local, rangeEnd]);
    cursor += 46 + nameLength + extraLength + comment;
  }
  if (cursor !== end) invalid("central directory trailing data");
  ranges.sort((a, b) => a[0] - b[0]);
  let next = 0;
  for (const [begin, stop] of ranges) {
    if (begin !== next) invalid("overlap or hidden archive bytes");
    next = stop;
  }
  if (next !== start) invalid("hidden data before directory");
  for (const path of paths) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++)
      if (files.has(parts.slice(0, i).join("/")))
        invalid("file/directory path conflict");
  }
  return { entries, files, expandedByteLength: expanded };
}
