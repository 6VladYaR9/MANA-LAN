const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isDataImage, parseDataImage } = require('./imageData');

const ASSET_MARKER = '__manaStateAsset';

function isStateStoreDisabled() {
  if (process.env.NODE_ENV === 'production' && process.env.STATE_STORE_DISABLED === '1') {
    throw new Error('STATE_STORE_DISABLED is not allowed in production.');
  }
  if (process.env.STATE_STORE_DISABLED === '1') return true;
  return process.env.NODE_ENV === 'test' && !process.env.DATA_DIR && !process.env.STATE_FILE;
}

function resolveStateFile() {
  if (process.env.NODE_ENV === 'production' && !process.env.DATA_DIR && !process.env.STATE_FILE) {
    throw new Error('Production requires DATA_DIR or STATE_FILE so persistent state is explicit.');
  }

  if (process.env.STATE_FILE) return path.resolve(process.env.STATE_FILE);
  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, '..', 'data');
  return path.join(dataDir, 'state.json');
}

function imageExtension(dataUrl) {
  return parseDataImage(dataUrl, { maxBytes: Number.MAX_SAFE_INTEGER, label: 'State image' }).extension;
}

function isImageDataUrlLike(value) {
  return typeof value === 'string' && /^data:image\//i.test(value);
}

function sanitizeAssetPrefix(prefix) {
  return String(prefix || 'image')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'image';
}

function assetRelativePath(dataUrl, prefix = 'image') {
  const hash = crypto.createHash('sha256').update(dataUrl).digest('hex');
  return path.join('assets', `${sanitizeAssetPrefix(prefix)}-${hash}.${imageExtension(dataUrl)}`).replace(/\\/g, '/');
}

function assertInsideRoot(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`State asset path escapes assets directory: ${absolutePath}`);
  }
}

function resolveAssetPath(stateFile, marker) {
  if (typeof marker !== 'string' || !marker) throw new Error('State asset marker is invalid.');
  if (marker.includes('\0') || path.isAbsolute(marker)) throw new Error('State asset marker must be a relative assets path.');

  const normalizedMarker = marker.replace(/\\/g, '/');
  if (!normalizedMarker.startsWith('assets/')) throw new Error('State asset marker must stay under assets/.');

  const stateDir = path.dirname(stateFile);
  const assetsRoot = path.resolve(stateDir, 'assets');
  const absolutePath = path.resolve(stateDir, normalizedMarker);
  assertInsideRoot(assetsRoot, absolutePath);
  return { assetsRoot, absolutePath };
}

function removeEmptyDirectoriesUpTo(startDir, stopDir) {
  let current = startDir;
  const stop = path.resolve(stopDir);

  while (path.resolve(current).startsWith(stop)) {
    if (path.resolve(current) === stop) {
      try {
        fs.rmdirSync(current);
      } catch {
        // Directory is not empty or already gone.
      }
      return;
    }

    try {
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

function cleanupCreatedAssets(createdAssets, stateFile) {
  const stateDir = path.dirname(stateFile);
  const assetsRoot = path.resolve(stateDir, 'assets');

  for (const assetPath of [...createdAssets].reverse()) {
    try {
      fs.rmSync(assetPath, { force: true });
      removeEmptyDirectoriesUpTo(path.dirname(assetPath), assetsRoot);
    } catch {
      // Best effort cleanup; the original save error is more important.
    }
  }
}

function writeImageAsset(dataUrl, stateFile, prefix, context = null) {
  parseDataImage(dataUrl, { maxBytes: Number.MAX_SAFE_INTEGER, label: 'State image' });
  const relativePath = assetRelativePath(dataUrl, prefix);
  const { assetsRoot, absolutePath } = resolveAssetPath(stateFile, relativePath);

  if (!fs.existsSync(absolutePath)) {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    if (fs.existsSync(assetsRoot)) {
      const realRoot = fs.realpathSync(assetsRoot);
      assertInsideRoot(realRoot, fs.realpathSync(path.dirname(absolutePath)));
    }
    fs.writeFileSync(absolutePath, dataUrl);
    context?.createdAssets?.push(absolutePath);
  }

  return { [ASSET_MARKER]: relativePath };
}

function hydrateImageAsset(value, stateFile) {
  if (isImageDataUrlLike(value)) {
    return parseDataImage(value, { maxBytes: Number.MAX_SAFE_INTEGER, label: 'State image' }).dataUrl;
  }
  if (!value || typeof value !== 'object' || typeof value[ASSET_MARKER] !== 'string') return value;

  const { assetsRoot, absolutePath } = resolveAssetPath(stateFile, value[ASSET_MARKER]);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`State asset is missing: ${absolutePath}`);
  }

  const realRoot = fs.realpathSync(assetsRoot);
  const realAsset = fs.realpathSync(absolutePath);
  assertInsideRoot(realRoot, realAsset);

  const dataUrl = fs.readFileSync(realAsset, 'utf8');
  parseDataImage(dataUrl, { maxBytes: Number.MAX_SAFE_INTEGER, label: 'State asset' });
  return dataUrl;
}

function externalizeImageValue(value, stateFile, prefix, context = null) {
  return isDataImage(value) || isImageDataUrlLike(value) ? writeImageAsset(value, stateFile, prefix, context) : value;
}

function externalizeSnapshotAssets(snapshot, stateFile, context = null) {
  const nextSnapshot = { ...snapshot };

  nextSnapshot.rooms = Array.isArray(snapshot.rooms)
    ? snapshot.rooms.map((room) => ({
        ...room,
        resultScreenshot: externalizeImageValue(room.resultScreenshot, stateFile, `room-${room.id || 'unknown'}-result`, context),
        resultScreenshots: Array.isArray(room.resultScreenshots)
          ? room.resultScreenshots.map((image, index) => externalizeImageValue(image, stateFile, `room-${room.id || 'unknown'}-result-${index}`, context))
          : room.resultScreenshots,
        chatMessages: Array.isArray(room.chatMessages)
          ? room.chatMessages.map((message) => ({
              ...message,
              image: externalizeImageValue(message.image, stateFile, `room-${room.id || 'unknown'}-chat-${message.id || 'image'}`, context)
            }))
          : room.chatMessages
      }))
    : snapshot.rooms;

  nextSnapshot.adminMessages = Array.isArray(snapshot.adminMessages)
    ? snapshot.adminMessages.map((message) => ({
        ...message,
        image: externalizeImageValue(message.image, stateFile, `admin-chat-${message.id || 'image'}`, context)
      }))
    : snapshot.adminMessages;

  return nextSnapshot;
}

function hydrateSnapshotAssets(snapshot, stateFile) {
  const nextSnapshot = { ...snapshot };

  nextSnapshot.rooms = Array.isArray(snapshot.rooms)
    ? snapshot.rooms.map((room) => ({
        ...room,
        resultScreenshot: hydrateImageAsset(room.resultScreenshot, stateFile),
        resultScreenshots: Array.isArray(room.resultScreenshots)
          ? room.resultScreenshots.map((image) => hydrateImageAsset(image, stateFile))
          : room.resultScreenshots,
        chatMessages: Array.isArray(room.chatMessages)
          ? room.chatMessages.map((message) => ({
              ...message,
              image: hydrateImageAsset(message.image, stateFile)
            }))
          : room.chatMessages
      }))
    : snapshot.rooms;

  nextSnapshot.adminMessages = Array.isArray(snapshot.adminMessages)
    ? snapshot.adminMessages.map((message) => ({
        ...message,
        image: hydrateImageAsset(message.image, stateFile)
      }))
    : snapshot.adminMessages;

  return nextSnapshot;
}

function quarantineCorruptStateFile(stateFile, error) {
  const suffix = new Date().toISOString().replace(/[:.]/g, '-');
  const corruptFile = `${stateFile}.corrupt-${suffix}`;

  try {
    fs.renameSync(stateFile, corruptFile);
    console.error(`Corrupt state file moved to ${corruptFile}:`, error);
  } catch (renameError) {
    throw new Error(`State file ${stateFile} is corrupt and could not be quarantined: ${renameError.message}`);
  }
}

function createStateStore() {
  const disabled = isStateStoreDisabled();
  const stateFile = resolveStateFile();

  return {
    stateFile,
    load() {
      if (disabled || !fs.existsSync(stateFile)) return {};

      try {
        return hydrateSnapshotAssets(JSON.parse(fs.readFileSync(stateFile, 'utf8')), stateFile);
      } catch (error) {
        quarantineCorruptStateFile(stateFile, error);
        return {};
      }
    },
    save(snapshot) {
      if (disabled) return;

      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      const tempFile = `${stateFile}.${process.pid}.tmp`;
      const saveContext = { createdAssets: [] };
      const payload = externalizeSnapshotAssets({
        ...snapshot,
        savedAt: new Date().toISOString()
      }, stateFile, saveContext);

      try {
        fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2));
        fs.renameSync(tempFile, stateFile);
      } catch (error) {
        fs.rmSync(tempFile, { force: true });
        cleanupCreatedAssets(saveContext.createdAssets, stateFile);
        throw error;
      }
    }
  };
}

module.exports = {
  createStateStore
};
