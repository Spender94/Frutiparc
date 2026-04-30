#!/usr/bin/env node
// Patches loader_bouille.swf to replace its hard-coded URL prefix
// "/source/swf/frutibouille/famille" with "/fbouille/famille" so it loads
// our local famille*.swf files instead of fetching from frutiparc.com.
//
// The URL is embedded as an inline string in an ActionPush instruction
// inside the main DoAction tag. Replacing it with a shorter string requires
// updating:
//   - the ActionPush instruction's payload length
//   - the DoAction tag's outer length
//
// (Also patches the constant pool entry C[25] which contains the legacy URL,
// in case it's referenced elsewhere.)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ORIGINAL_INLINE_URL = '/source/swf/frutibouille/famille';
const ORIGINAL_CP_URL = 'http://swf.frutiparc.com/fbouille/famille';
const NEW_URL = '/fbouille/famille';

function patchInlineUrl(bodyBuf) {
  // Find the URL bytes in the body
  const urlBytes = Buffer.from(ORIGINAL_INLINE_URL + '\0', 'ascii');
  const urlOff = bodyBuf.indexOf(urlBytes);
  if (urlOff < 0) {
    throw new Error('Inline URL not found');
  }

  // Walk back to find the ActionPush opcode (0x96) preceding the string.
  // The ActionPush format is: 0x96, len(UI16), payload_bytes.
  // The payload starts with type byte 0x00 (string) immediately followed
  // by the URL's bytes. So the type byte is at urlOff - 1, and the
  // payload starts at urlOff - 1.
  const typeByteOff = urlOff - 1;
  if (bodyBuf[typeByteOff] !== 0x00) {
    throw new Error('Expected string type byte (0x00) before URL');
  }
  // The ActionPush opcode should be at typeByteOff - 3 (opcode + 2 length bytes)
  const opOff = typeByteOff - 3;
  if (bodyBuf[opOff] !== 0x96) {
    throw new Error('ActionPush opcode (0x96) not found at expected position');
  }

  const oldOpLen = bodyBuf.readUInt16LE(opOff + 1);
  const oldUrlLen = ORIGINAL_INLINE_URL.length;
  const newUrlLen = NEW_URL.length;
  const lengthDelta = newUrlLen - oldUrlLen; // negative since shorter
  const newOpLen = oldOpLen + lengthDelta;

  // Build the new body: bytes before URL + new URL + null + bytes after URL+null
  const beforeUrl = bodyBuf.slice(0, urlOff);
  const afterUrl = bodyBuf.slice(urlOff + oldUrlLen + 1); // skip URL and its null
  const newUrlBuf = Buffer.from(NEW_URL + '\0', 'ascii');
  const newBody = Buffer.concat([beforeUrl, newUrlBuf, afterUrl]);

  // Update the ActionPush length field in newBody
  newBody.writeUInt16LE(newOpLen, opOff + 1);

  console.log(`  Inline URL: ActionPush at ${opOff}, payload ${oldOpLen} -> ${newOpLen}`);
  return { body: newBody, delta: lengthDelta };
}

function patchConstantPoolUrl(bodyBuf) {
  // Find the legacy URL in the constant pool blob
  const urlBytes = Buffer.from(ORIGINAL_CP_URL + '\0', 'ascii');
  const urlOff = bodyBuf.indexOf(urlBytes);
  if (urlOff < 0) {
    return { body: bodyBuf, delta: 0 }; // not found, skip
  }

  const oldUrlLen = ORIGINAL_CP_URL.length;
  const newUrlLen = NEW_URL.length;
  const lengthDelta = newUrlLen - oldUrlLen;

  const beforeUrl = bodyBuf.slice(0, urlOff);
  const afterUrl = bodyBuf.slice(urlOff + oldUrlLen + 1);
  const newUrlBuf = Buffer.from(NEW_URL + '\0', 'ascii');
  const newBody = Buffer.concat([beforeUrl, newUrlBuf, afterUrl]);

  // Update ActionConstantPool tag's payload length (at offset 1, UI16)
  // The ConstantPool tag is at offset 0 of the DoAction body.
  if (newBody[0] === 0x88) {
    const oldCpLen = newBody.readUInt16LE(1);
    newBody.writeUInt16LE(oldCpLen + lengthDelta, 1);
    console.log(`  CP URL: payload ${oldCpLen} -> ${oldCpLen + lengthDelta}`);
  }

  return { body: newBody, delta: lengthDelta };
}

function patchSwf(inputPath, outputPath) {
  const buf = fs.readFileSync(inputPath);
  const sig = buf.slice(0, 3).toString('ascii');
  if (sig !== 'CWS') throw new Error(`Not a CWS SWF: ${inputPath}`);
  const version = buf[3];

  const body = zlib.inflateSync(buf.slice(8));

  // Skip RECT
  const nbits = (body[0] >> 3) & 0x1f;
  const rectBytes = Math.ceil((5 + nbits * 4) / 8);
  let off = rectBytes + 4;

  // Find the main DoAction tag (the big one at offset 131 in this SWF)
  // We scan for the FIRST DoAction tag.
  let doActionOff = -1, doActionHeaderSize = 0, doActionBodyLen = 0;
  while (off < body.length) {
    const tagHeader = body.readUInt16LE(off);
    const tagCode = tagHeader >> 6;
    let tagLen = tagHeader & 0x3f;
    let headerSize = 2;
    if (tagLen === 0x3f) {
      tagLen = body.readUInt32LE(off + 2);
      headerSize = 6;
    }
    if (tagCode === 0) break;
    if (tagCode === 12) {
      doActionOff = off;
      doActionHeaderSize = headerSize;
      doActionBodyLen = tagLen;
      break;
    }
    off += headerSize + tagLen;
  }
  if (doActionOff < 0) throw new Error('No DoAction tag found');

  console.log(`DoAction at ${doActionOff}, body length ${doActionBodyLen}`);

  // Extract the DoAction body
  const tagBodyStart = doActionOff + doActionHeaderSize;
  const tagBodyEnd = tagBodyStart + doActionBodyLen;
  let tagBody = body.slice(tagBodyStart, tagBodyEnd);

  // Patch the constant pool URL first (it changes offsets for downstream pushes)
  const cpResult = patchConstantPoolUrl(tagBody);
  tagBody = cpResult.body;

  // Patch the inline URL
  const inlineResult = patchInlineUrl(tagBody);
  tagBody = inlineResult.body;

  const totalDelta = cpResult.delta + inlineResult.delta;
  const newDoActionBodyLen = doActionBodyLen + totalDelta;

  // Rebuild the body: bytes before DoAction + DoAction header (with new length)
  // + new tag body + bytes after DoAction
  const newDoActionHeader = Buffer.alloc(doActionHeaderSize);
  if (doActionHeaderSize === 6) {
    newDoActionHeader.writeUInt16LE((12 << 6) | 0x3f, 0);
    newDoActionHeader.writeUInt32LE(newDoActionBodyLen, 2);
  } else {
    if (newDoActionBodyLen >= 0x3f) {
      throw new Error('Need to convert short-form DoAction to long-form (not implemented)');
    }
    newDoActionHeader.writeUInt16LE((12 << 6) | newDoActionBodyLen, 0);
  }

  const beforeTag = body.slice(0, doActionOff);
  const afterTag = body.slice(tagBodyEnd);
  const newBody = Buffer.concat([beforeTag, newDoActionHeader, tagBody, afterTag]);

  console.log(`  DoAction body: ${doActionBodyLen} -> ${newDoActionBodyLen} (delta ${totalDelta})`);

  // Reassemble SWF (CWS - compressed)
  const newFileLen = 8 + newBody.length;
  const compressed = zlib.deflateSync(newBody);
  const out = Buffer.alloc(8 + compressed.length);
  out.write('CWS', 0, 'ascii');
  out.writeUInt8(version, 3);
  out.writeUInt32LE(newFileLen, 4);
  compressed.copy(out, 8);

  fs.writeFileSync(outputPath, out);
  console.log(`  Wrote ${outputPath} (${out.length} bytes)`);
}

// CLI
const inputPath = path.resolve(__dirname, '..', 'public', 'loader_bouille.swf');
const outputPath = path.resolve(__dirname, '..', 'public', 'loader_bouille_local.swf');
patchSwf(inputPath, outputPath);
