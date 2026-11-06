#!/usr/bin/env node
// Local review CLI. Also: npm run review -- <run|dispose> ...  See scripts/review/runner.mjs for the flags.
import { runCli } from './runner.mjs'

process.exitCode = await runCli(process.argv.slice(2))
