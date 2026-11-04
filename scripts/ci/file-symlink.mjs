// Test helper: create a FILE symlink for a self-test, or report that this machine cannot.
// Windows refuses file symlinks to ordinary users (EPERM) unless Developer Mode is on, so the
// guard cases that need one cannot run on a contributor's Windows laptop. Those cases are skipped
// THERE only. In CI (CI is set on every GitHub Actions runner, Windows included) and on every
// other platform, the error is rethrown, so the cases still run on every PR.
// Returns true when the link was created, false when the caller must skip its symlink cases.
import { symlinkSync } from 'node:fs'

export function fileSymlinkOrSkip(target, path, {
  platform = process.platform,
  env = process.env,
  symlink = symlinkSync,
  log = console.log,
} = {}) {
  try {
    symlink(target, path)
    return true
  } catch (e) {
    if (e?.code === 'EPERM' && platform === 'win32' && !env.CI) {
      log(`  SKIP file-symlink cases: Windows refused a symlink (EPERM). Turn on Developer Mode to run them; CI always runs them.`)
      return false
    }
    throw e
  }
}
