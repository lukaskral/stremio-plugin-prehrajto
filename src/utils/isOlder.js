function isOlder(maxAge, snapshotTime, nowTime = Date.now()) {
  if (!snapshotTime) return true;
  const snapshotAge = nowTime - new Date(snapshotTime).getTime();
  return snapshotAge > maxAge;
}

module.exports = { isOlder };
