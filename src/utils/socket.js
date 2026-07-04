let ioInstance = null;

function setIO(io) {
  ioInstance = io;
}

function getIO() {
  return ioInstance;
}

function emitEvent(event, data) {
  if (ioInstance) {
    ioInstance.emit(event, data);
    return true;
  }
  console.warn(`Socket.io not initialized; skipped emit: ${event}`);
  return false;
}

module.exports = { setIO, getIO, emitEvent };
