import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import { protect, requireRole } from '../middleware/auth.js';
import { badRequest } from '../utils/ApiError.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = join(__dirname, '../../uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true }); // create on boot so writes never ENOENT

export const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;          // 8 MB
export const MAX_TRAILER_SECONDS = 180;           // 3 minutes

const MIME_EXT = {
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/x-m4v': '.m4v', 'video/webm': '.webm',
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic',
};
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname || '') || MIME_EXT[file.mimetype] || '';
    cb(null, `${Date.now()}_${nanoid(8)}${ext}`);
  },
});

// Accept by mimetype OR by file extension — some Android content URIs arrive as
// application/octet-stream even though the file is a real video/image.
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i;
const IMAGE_EXT = /\.(jpg|jpeg|png|webp|heic|heif)$/i;
const okVideo = (f) => f.mimetype.startsWith('video/') || VIDEO_EXT.test(f.originalname || '');
const okImage = (f) => f.mimetype.startsWith('image/') || IMAGE_EXT.test(f.originalname || '');

const videoUpload = multer({
  storage,
  limits: { fileSize: MAX_VIDEO_BYTES },
  fileFilter: (_req, file, cb) => (okVideo(file) ? cb(null, true) : cb(new Error('Only video files are allowed'))),
}).single('file');

const imageUpload = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => (okImage(file) ? cb(null, true) : cb(new Error('Only image files are allowed'))),
}).single('file');

// Wrap a multer middleware so its errors become clean 400s.
const run = (mw) => (req, res, next) =>
  mw(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(badRequest('File is too large'));
      return next(badRequest(err.message || 'Upload failed'));
    }
    if (!req.file) return next(badRequest('No file received (field name must be "file")'));
    next();
  });

const r = Router();

// Only creators upload media.
r.post('/video', protect(), requireRole('creator'), run(videoUpload), (req, res) => {
  const durationSec = Number(req.body?.durationSec) || null;
  if (durationSec && durationSec > MAX_TRAILER_SECONDS) {
    return res.status(400).json({ error: `Trailer must be ${MAX_TRAILER_SECONDS} seconds (3 min) or shorter` });
  }
  res.status(201).json({
    url: `/uploads/${req.file.filename}`,
    sizeBytes: req.file.size,
    durationSec,
    maxBytes: MAX_VIDEO_BYTES,
    maxSeconds: MAX_TRAILER_SECONDS,
  });
});

r.post('/image', protect(), run(imageUpload), (req, res) => {
  res.status(201).json({ url: `/uploads/${req.file.filename}`, sizeBytes: req.file.size });
});

export default r;
