
import 'dotenv/config';
import fs from 'node:fs';
import mongoose from 'mongoose';

const APPLY = process.argv.includes('--apply');
const BACKUP_PATH = 'migrations/backups/websites-legacy-trackingId-backup.json';
const STALE_INDEX = 'trackingId_1';
const TARGET_INDEX = 'websiteId_1';

function log(step, msg) {
  console.log(`[${APPLY ? 'APPLY' : 'DRY-RUN'}] ${step}: ${msg}`);
}

await mongoose.connect(process.env.MONGODB_URI);
const col = mongoose.connection.collection('websites');

try {
  const legacyFilter = { websiteId: { $exists: false } };
  const legacyCount = await col.countDocuments(legacyFilter);
  log('precheck', `${legacyCount} legacy doc(s) without a websiteId field`);

  if (legacyCount > 0) {
    if (!fs.existsSync(BACKUP_PATH)) {
      throw new Error(`Refusing to proceed: backup file missing at ${BACKUP_PATH}`);
    }
    const backup = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
    if (backup.length < legacyCount) {
      throw new Error(`Refusing to proceed: backup has ${backup.length} docs but ${legacyCount} would be deleted`);
    }
    log('precheck', `backup verified at ${BACKUP_PATH} (${backup.length} docs)`);

    const reachable = await col.countDocuments({ ...legacyFilter, ownerId: { $exists: true, $ne: null } });
    if (reachable > 0) {
      throw new Error(`Refusing to proceed: ${reachable} legacy doc(s) have an ownerId and may be real user data`);
    }
    log('precheck', 'confirmed: no legacy doc has an ownerId (all unreachable)');
  }

  const dupes = await col
    .aggregate([
      { $match: { websiteId: { $exists: true } } },
      { $group: { _id: '$websiteId', n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ])
    .toArray();
  if (dupes.length > 0) {
    throw new Error(`Refusing to proceed: duplicate websiteId values exist: ${JSON.stringify(dupes)}`);
  }
  log('precheck', 'no duplicate websiteId values — unique index can be built safely');

  if (legacyCount > 0) {
    if (APPLY) {
      const res = await col.deleteMany(legacyFilter);
      log('step 1', `deleted ${res.deletedCount} legacy doc(s)`);
    } else {
      log('step 1', `would delete ${legacyCount} legacy doc(s)`);
    }
  } else {
    log('step 1', 'nothing to delete (already clean)');
  }

  const indexes = await col.indexes();
  if (indexes.some((ix) => ix.name === STALE_INDEX)) {
    if (APPLY) {
      await col.dropIndex(STALE_INDEX);
      log('step 2', `dropped stale index ${STALE_INDEX}`);
    } else {
      log('step 2', `would drop stale index ${STALE_INDEX}`);
    }
  } else {
    log('step 2', `${STALE_INDEX} not present (already dropped)`);
  }

  if (indexes.some((ix) => ix.name === TARGET_INDEX)) {
    log('step 3', `${TARGET_INDEX} already exists`);
  } else if (APPLY) {
    await col.createIndex({ websiteId: 1 }, { unique: true, name: TARGET_INDEX });
    log('step 3', `created unique index ${TARGET_INDEX}`);
  } else {
    log('step 3', `would create unique index ${TARGET_INDEX}`);
  }

  console.log('\nFinal indexes on `websites`:');
  for (const ix of await col.indexes()) {
    console.log(`  ${ix.name.padEnd(28)} key=${JSON.stringify(ix.key).padEnd(34)} unique=${!!ix.unique}`);
  }
  console.log(`\nRemaining website docs: ${await col.countDocuments()}`);
  if (!APPLY) console.log('\nDRY RUN — nothing was changed. Re-run with --apply to execute.');
} finally {
  await mongoose.disconnect();
}
