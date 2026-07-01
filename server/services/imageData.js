const DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

function normalizeImageType(type) {
  return type === 'jpg' ? 'jpeg' : type;
}

function hasValidPngStructure(buffer) {
  if (buffer.length < 20) return false;
  if (!(buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a)) {
    return false;
  }

  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const nextOffset = offset + 8 + length + 4;
    if (nextOffset > buffer.length) return false;
    offset = nextOffset;
    if (type === 'IEND') return offset === buffer.length;
  }

  return false;
}

function hasValidJpegStructure(buffer) {
  return buffer.length >= 4
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[buffer.length - 2] === 0xff
    && buffer[buffer.length - 1] === 0xd9;
}

function hasValidWebpStructure(buffer) {
  if (buffer.length < 16) return false;
  if (buffer.subarray(0, 4).toString('ascii') !== 'RIFF') return false;
  if (buffer.subarray(8, 12).toString('ascii') !== 'WEBP') return false;
  return buffer.readUInt32LE(4) + 8 === buffer.length;
}

function hasValidImageStructure(buffer, type) {
  const normalized = normalizeImageType(type);

  if (normalized === 'png') {
    return hasValidPngStructure(buffer);
  }

  if (normalized === 'jpeg') {
    return hasValidJpegStructure(buffer);
  }

  if (normalized === 'webp') {
    return hasValidWebpStructure(buffer);
  }

  return false;
}

function parseDataImage(value, options = {}) {
  const { maxBytes = 4_000_000, label = 'Image' } = options;
  const text = String(value || '');
  const match = text.match(DATA_IMAGE_RE);
  if (!match) {
    throw new Error(`${label} must be a PNG, JPG, or WEBP data URL with strict base64 bytes.`);
  }

  const type = normalizeImageType(match[1]);
  const base64 = match[2];
  if (!base64 || base64.length % 4 !== 0) {
    throw new Error(`${label} has invalid base64 data.`);
  }

  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) {
    throw new Error(`${label} is empty.`);
  }
  if (buffer.length > maxBytes) {
    throw new Error(`${label} is too large. Compress the image and try again.`);
  }
  if (!hasValidImageStructure(buffer, type)) {
    throw new Error(`${label} bytes do not match a valid PNG, JPG, or WEBP structure.`);
  }

  return {
    type,
    extension: type === 'jpeg' ? 'jpg' : type,
    buffer,
    dataUrl: `data:image/${match[1]};base64,${base64}`
  };
}

function isDataImage(value) {
  if (typeof value !== 'string') return false;
  try {
    parseDataImage(value, { maxBytes: Number.MAX_SAFE_INTEGER, label: 'State image' });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  isDataImage,
  parseDataImage
};
