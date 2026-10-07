import {spawn} from 'node:child_process';
const binary = process.platform === 'win32' ? '.tools/pocketbase.exe' : '.tools/pocketbase';
const child = spawn(binary, ['serve', '--http=127.0.0.1:8090', '--dir=pb_data', '--hooksDir=pb_hooks', '--migrationsDir=pb_migrations', '--publicDir=pb_public', '--origins=http://127.0.0.1:8090,http://localhost:8090'], {stdio: 'inherit'});
child.on('error', error => {console.error(error.message, 'Run npm run setup first.'); process.exitCode = 1;});
child.on('exit', code => {process.exitCode = code ?? 1;});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
