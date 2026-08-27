function getHourBucket(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), 0, 0, 0));
}

function getDayBucket(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

const BUCKET_FNS = {
  hour: getHourBucket,
  day: getDayBucket,
};

export function getBucket(date, granularity) {
  const fn = BUCKET_FNS[granularity];
  if (!fn) {
    throw new Error(`Unsupported analytics granularity: ${granularity}`);
  }
  return fn(date);
}
