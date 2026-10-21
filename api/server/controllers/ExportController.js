const mongoose = require('mongoose');
const { runUserExport, createFileAccess } = require('@librechat/api');

const MAX_CONCURRENT_EXPORTS = 3;

/**
 * Builds the `GET /api/user/export` handler (SPEC-020). At most one export per user and
 * `maxConcurrent` server-wide; the slot is released exactly once, on completion, error or
 * client disconnect. Dependencies are injectable for tests.
 */
function createExportController({
  run = runUserExport,
  fileAccess = createFileAccess,
  getModels = () => mongoose.models,
  maxConcurrent = MAX_CONCURRENT_EXPORTS,
} = {}) {
  const active = new Set();

  return async function exportUserDataController(req, res) {
    const userId = req.user.id;
    if (active.has(userId)) {
      return res.status(429).json({ error: 'export_in_progress' });
    }
    if (active.size >= maxConcurrent) {
      return res.status(429).json({ error: 'export_busy' });
    }

    active.add(userId);
    let released = false;
    let closed = false;
    const release = () => {
      if (!released) {
        released = true;
        active.delete(userId);
      }
    };
    res.once('close', () => {
      closed = true;
      release();
    });

    try {
      await run({
        user: { id: userId, email: req.user.email },
        models: getModels(),
        files: fileAccess(),
        output: res,
        isAborted: () => closed,
        onReady: (prepared) => {
          res.status(200);
          res.setHeader('Content-Type', 'application/zip');
          res.setHeader('Content-Disposition', `attachment; filename="${prepared.filename}"`);
          res.setHeader('Cache-Control', 'no-store');
        },
      });
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ error: 'export_failed' });
      }
    } finally {
      release();
    }
  };
}

module.exports = {
  createExportController,
  exportUserDataController: createExportController(),
};
