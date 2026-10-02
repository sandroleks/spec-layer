import type { Io } from './commands';
import { main } from './main';

const io: Io = {
  out: (l) => console.log(l),
  err: (l) => console.error(l),
  write: (t) => { process.stdout.write(t); },
};

// `spec-layer show foundation | head` closes stdout early. That is not an
// error worth a stack trace; exit quietly with the code the command chose.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(process.exitCode ?? 0);
  throw err;
});

process.exitCode = await main(process.argv.slice(2), { cwd: process.cwd(), env: process.env, stdin: process.stdin, io });
