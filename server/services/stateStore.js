const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ASSET_MARKER = '__manaStateAsset';

function isStateStoreDisabled() {
  if (process.env.STATE_STORE_DISABLED === '1') return true;
  return process.env.NODE_ENV === 'test' && !process.env.DATA_DIR && !process.env.STATE_FILE;
}

function resolveStateFile() {
  if (process.env.STATE_FILE) return path.resolve(process.env.STATE_FILE);
  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, '..', 'data');
  return path.join(dataDir, 'state.json');
}

function isDataImage(value) {
  return typeof value === 'string' && /^data:image\/(png|jpeg|jpg|webp);base64,/.test(value);
}

function imageExtension(dataUrl) {
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,/);
  if (!match) return 'txt';
  return match[1] === 'jpeg' ? 'jpg' : match[1];
}

function assetRelativePath(dataUrl, prefix = 'image') {
  const hash = crypto.createHash('sha256').update(dataUrl).digest('hex');
  return path.join('assets', `${prefix}-${hash}.${imageExtension(dataUrl)}`).replace(/\\/g, '/');
}

function writeImageAsset(dataUrl, stateFile, prefix) {
  const relativePath = assetRelativePath(dataUrl, prefix);
  const absolutePath = path.join(path.dirname(stateFile), relativePath);

  if (!fs.existsSync(absolutePath)) {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, dataUrl);
  }

  return { [ASSET_MARKER]: relativePath };
}

function hydrateImageAsset(value, stateFile) {
  if (isDataImage(value)) return value;
  if (!value || typeof value !== 'object' || typeof value[ASSET_MARKER] !== 'string') return value;

  const absolutePath = path.join(path.dirname(stateFile), value[ASSET_MARKER]);
  try {
    return fs.readFileSync(absolutePath, 'utf8');
  } catch (error) {
    console.error(`Failed to load state asset ${absolutePath}:`, error);
    return null;
  }
}

function externalizeImageValue(value, stateFile, prefix) {
  return isDataImage(value) ? writeImageAsset(value, stateFile, prefix) : value;
}

function externalizeSnapshotAssets(snapshot, stateFile) {
  const nextSnapshot = { ...snapshot };

  nextSnapshot.rooms = Array.isArray(snapshot.rooms)
    ? snapshot.rooms.map((room) => ({
        ...room,
        resultScreenshot: externalizeImageValue(room.resultScreenshot, stateFile, `room-${room.id || 'unknown'}-result`),
        resultScreenshots: Array.isArray(room.resultScreenshots)
          ? room.resultScreenshots.map((image, index) => externalizeImageValue(image, stateFile, `room-${room.id || 'unknown'}-result-${index}`))
          : room.resultScreenshots,
        chatMessages: Array.isArray(room.chatMessages)
          ? room.chatMessages.map((message) => ({
              ...message,
              image: externalizeImageValue(message.image, stateFile, `room-${room.id || 'unknown'}-chat-${message.id || 'image'}`)
            }))
          : room.chatMessages
      }))
    : snapshot.rooms;

  nextSnapshot.adminMessages = Array.isArray(snapshot.adminMessages)
    ? snapshot.adminMessages.map((message) => ({
        ...message,
        image: externalizeImageValue(message.image, stateFile, `admin-chat-${message.id || 'image'}`)
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
          ? room.resultScreenshots.map((image) => hydrateImageAsset(image, stateFile)).filter(Boolean)
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
      const payload = externalizeSnapshotAssets({
        ...snapshot,
        savedAt: new Date().toISOString()
      }, stateFile);

      fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2));
      fs.renameSync(tempFile, stateFile);
    }
  };
}

module.exports = {
  createStateStore
};
