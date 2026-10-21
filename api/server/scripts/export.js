#!/usr/bin/env node
/**
 * Operator fallback for the per-user data export (SPEC-020 REQ-024).
 * Runs the same export as `GET /api/user/export` and writes the zip to a directory.
 *
 * Prod: docker exec LibreChat node api/server/scripts/export.js <email> /app/logs/exports
 *       → the zip appears on the host under ./logs/exports/
 */
const fs = require('fs');
const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..', '..') });
const mongoose = require('mongoose');
const { prepareUserExport, writeExportArchive, createFileAccess } = require('@librechat/api');

/** Exports one user, found by email, into `outDir`. Returns the written path and counts. */
async function exportUser({ email, outDir, models, files }) {
  const user = await models.User.findOne({ email: email.trim().toLowerCase() })
    .select('_id email')
    .lean();
  if (!user) {
    throw new Error('No user with that email');
  }

  const prepared = await prepareUserExport({
    user: { id: user._id.toString(), email: user.email },
    models,
    files,
  });
  fs.mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, prepared.filename);
  const outcome = await writeExportArchive(prepared, files, fs.createWriteStream(target));
  if (outcome !== 'success') {
    fs.rmSync(target, { force: true });
    throw new Error(`Export ${outcome}`);
  }
  return { path: target, counts: prepared.counts };
}

async function main() {
  const [email, outDir] = process.argv.slice(2);
  if (!email || !outDir) {
    console.error('Usage: node api/server/scripts/export.js <email> <outDir>');
    process.exit(2);
  }

  const { connectDb } = require('~/db');
  await connectDb();
  try {
    const result = await exportUser({
      email,
      outDir,
      models: mongoose.models,
      files: createFileAccess(),
    });
    console.error(`Wrote ${result.path}`);
    console.error(JSON.stringify(result.counts));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Export failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { exportUser };
