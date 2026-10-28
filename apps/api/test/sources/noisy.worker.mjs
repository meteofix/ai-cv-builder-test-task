// A stand-in for the PDF worker that writes a marker to stderr, as PDF.js does with a warning, and answers.
import { parentPort } from 'node:worker_threads';

console.warn('PRIVATE-CV-MARKER');
parentPort.postMessage({ ok: true, text: '' });
