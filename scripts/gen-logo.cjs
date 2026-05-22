const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

// Minimal 64x64 blue PNG
const width = 64
const height = 64
const raw = Buffer.alloc((width * 4 + 1) * height)
for (let y = 0; y < height; y++) {
  const row = y * (width * 4 + 1)
  raw[row] = 0
  for (let x = 0; x < width; x++) {
    const i = row + 1 + x * 4
    raw[i] = 47
    raw[i + 1] = 124
    raw[i + 2] = 246
    raw[i + 3] = 255
  }
}
const compressed = zlib.deflateSync(raw)

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type)
  const crcBuf = Buffer.concat([t, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcBuf))
  return Buffer.concat([len, t, data, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(width, 0)
ihdr.writeUInt32BE(height, 4)
ihdr[8] = 8
ihdr[9] = 6
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', compressed),
  chunk('IEND', Buffer.alloc(0))
])

const out = path.join(__dirname, '..', 'public', 'logo.png')
fs.writeFileSync(out, png)
console.log('logo written:', out)
