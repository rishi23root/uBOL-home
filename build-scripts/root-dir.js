/**
 * Repository root (parent of build-scripts/) for path resolution in Node build tooling.
 */
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');
