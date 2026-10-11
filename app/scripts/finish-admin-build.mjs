import { renameSync, rmdirSync } from 'node:fs';
renameSync('dist-admin/admin/index.html','dist-admin/index.html');
rmdirSync('dist-admin/admin');
